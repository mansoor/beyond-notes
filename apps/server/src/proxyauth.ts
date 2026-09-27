/**
 * Forward-auth: sign-in handled by a reverse proxy in front of the app.
 *
 * Authelia, Authentik's proxy outpost, oauth2-proxy and Caddy/Traefik
 * forward_auth all authenticate the person before the request reaches us and
 * pass who it is in a header (Remote-Email, X-authentik-email, ...). We accept
 * that header ONLY from the proxy's own address (AUTH_PROXY_TRUSTED_IPS). Any
 * other client could send the same header, so from anywhere else it is ignored
 * and normal cookie sign-in applies.
 *
 * A trusted header is turned into an ordinary session (cookie and all), so
 * everything keyed to a session, such as unlocked notebooks, keeps working.
 * Sessions are cached per email so clients that drop cookies (scripts, some
 * webviews) don't mint a new session row on every request.
 */
import { BlockList, isIP } from 'node:net'
import type { AuthService } from './auth'
import type { Config } from './config'
import type { Repo, UserRow } from './repo'

export type ProxyAuthSettings = {
  emailHeader: string
  nameHeader: string
  groupsHeader: string
  trusted: string[]
  autoCreate: boolean
  adminGroup: string
  logoutUrl: string
}

export function proxyAuthSettings(config: Config): ProxyAuthSettings | null {
  const trusted = config.AUTH_PROXY_TRUSTED_IPS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // a header without a trusted source would let anyone claim to be anyone
  if (!config.AUTH_PROXY_EMAIL_HEADER || trusted.length === 0) return null
  return {
    emailHeader: config.AUTH_PROXY_EMAIL_HEADER.toLowerCase(),
    nameHeader: config.AUTH_PROXY_NAME_HEADER.toLowerCase(),
    groupsHeader: config.AUTH_PROXY_GROUPS_HEADER.toLowerCase(),
    trusted,
    autoCreate: config.AUTH_PROXY_AUTO_CREATE,
    adminGroup: config.AUTH_PROXY_ADMIN_GROUP,
    logoutUrl: config.AUTH_PROXY_LOGOUT_URL,
  }
}

/** Build a matcher for "10.0.0.5", "172.18.0.0/16", "::1", "fd00::/8". */
export function trustedMatcher(entries: string[]): (ip: string) => boolean {
  const list = new BlockList()
  for (const entry of entries) {
    const [addr = '', bits] = entry.split('/')
    const type = isIP(addr) === 6 ? 'ipv6' : isIP(addr) === 4 ? 'ipv4' : null
    if (!type) throw new Error(`AUTH_PROXY_TRUSTED_IPS: "${entry}" is not an IP address or CIDR`)
    if (bits === undefined) list.addAddress(addr, type)
    else list.addSubnet(addr, Number(bits), type)
  }
  return (raw: string) => {
    // "::ffff:172.18.0.3" is an IPv4 client on a dual-stack socket
    const ip = raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4 ? raw.slice(7) : raw
    const type = isIP(ip) === 6 ? 'ipv6' : isIP(ip) === 4 ? 'ipv4' : null
    return type ? list.check(ip, type) : false
  }
}

type RequestLike = {
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

function header(req: RequestLike, name: string): string | null {
  if (!name) return null
  const v = req.headers[name]
  const s = Array.isArray(v) ? v[0] : v
  return s?.trim() ? s.trim() : null
}

export function createProxyAuth(deps: {
  settings: ProxyAuthSettings | null
  repo: Repo
  auth: AuthService
  log?: (msg: string) => void
}) {
  const cfg = deps.settings
  const isTrusted = cfg ? trustedMatcher(cfg.trusted) : () => false
  const cache = new Map<string, { token: string; expiresAt: Date }>()

  async function userFor(email: string, name: string | null, groups: string[]) {
    if (!cfg) return null
    let user: UserRow | null = await deps.repo.getUserByEmail(email)
    const firstUser = await deps.auth.needsSetup()
    const inAdminGroup = Boolean(cfg.adminGroup) && groups.includes(cfg.adminGroup)
    if (!user) {
      if (!firstUser && !cfg.autoCreate) {
        deps.log?.(`proxy sign-in: no account for ${email} (AUTH_PROXY_AUTO_CREATE is off)`)
        return null
      }
      user = await deps.auth.createSsoUser({
        email,
        name: name ?? email.split('@')[0] ?? email,
        role: firstUser || inAdminGroup ? 'admin' : 'member',
      })
    } else if (cfg.adminGroup) {
      const want = inAdminGroup ? 'admin' : 'member'
      if (want !== user.role) {
        const admins = (await deps.repo.listUsers()).filter((u) => u.role === 'admin')
        if (want === 'admin' || admins.length > 1) {
          await deps.repo.updateUser(user.id, { role: want })
          user = { ...user, role: want }
        }
      }
    }
    return user
  }

  return {
    enabled: cfg !== null,
    logoutUrl: cfg?.logoutUrl ?? '',

    /**
     * Who the proxy says this is, as a session. Returns null when forward-auth
     * doesn't apply to this request (off, untrusted source, or no header); the
     * caller then falls back to the cookie.
     */
    async resolve(
      req: RequestLike,
      cookieToken: string | null,
    ): Promise<{
      user: UserRow | null
      token: string | null
      /** set when the token is not the one the cookie already holds */
      fresh: boolean
      expiresAt: Date | null
    } | null> {
      if (!cfg) return null
      const email = header(req, cfg.emailHeader)?.toLowerCase() ?? null
      if (!email) return null
      if (!isTrusted(req.socket?.remoteAddress ?? '')) return null

      // the cookie's session is fine as long as it belongs to the same person
      if (cookieToken) {
        const current = await deps.auth.userForToken(cookieToken)
        if (current && current.email.toLowerCase() === email) {
          return { user: current, token: cookieToken, fresh: false, expiresAt: null }
        }
      }
      const cached = cache.get(email)
      if (cached && cached.expiresAt.getTime() > Date.now()) {
        const user = await deps.auth.userForToken(cached.token)
        if (user && user.email.toLowerCase() === email) {
          return { user, token: cached.token, fresh: true, expiresAt: cached.expiresAt }
        }
      }

      const groups = (header(req, cfg.groupsHeader) ?? '')
        .split(/[,|]/)
        .map((g) => g.trim())
        .filter(Boolean)
      const user = await userFor(email, header(req, cfg.nameHeader), groups)
      // the proxy vouched for someone with no account here: signed out, and
      // deliberately not falling back to whatever the cookie says
      if (!user) return { user: null, token: null, fresh: false, expiresAt: null }
      const session = await deps.auth.sessionFor(user.id)
      cache.set(email, session)
      return { user, token: session.token, fresh: true, expiresAt: session.expiresAt }
    },

    /** Signing out drops the cached session so the next request starts over. */
    forget(email: string) {
      cache.delete(email.toLowerCase())
    },
  }
}

export type ProxyAuth = ReturnType<typeof createProxyAuth>
