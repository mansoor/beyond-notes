/**
 * OpenID Connect single sign-on.
 *
 * The flow is the standard authorization-code one with PKCE: `begin` builds the
 * provider URL and remembers the verifier and nonce under a random `state`;
 * the browser comes back to /auth/oidc/callback, where `complete` swaps the
 * code for tokens (openid-client checks the ID token's signature, issuer,
 * audience, expiry and nonce), then maps the person to a local account.
 *
 * Pending logins live in memory. That is correct for a single-process app
 * (see TECH-PLAN); a restart mid-login just means "sign-in expired, try again".
 * The state is also set as a cookie and compared on return, so a callback URL
 * can't be replayed in someone else's browser.
 *
 * Who gets in (`resolveUser`):
 *   1. an identity already linked to an account signs in as that account;
 *   2. otherwise an account with the same email is linked, but only when the
 *      provider says the email is verified, since anyone can put any address
 *      on an account at a provider that doesn't check;
 *   3. otherwise, on a brand-new instance the first person becomes the admin
 *      (the same trust as the open setup page), or, with auto-create on, a
 *      member account is made.
 * The required-group and allowed-domain rules apply before any of that.
 */
import type { OidcSettings } from '@bn/schema'
import { nanoid } from 'nanoid'
import * as oidc from 'openid-client'
import type { AuthService } from './auth'
import type { Repo, UserRow } from './repo'
import type { SettingsService } from './settings'

const PENDING_TTL_MS = 10 * 60 * 1000
const DISCOVERY_TTL_MS = 60 * 60 * 1000

export class SsoError extends Error {
  constructor(
    public code:
      | 'NOT_CONFIGURED'
      | 'EXPIRED'
      | 'PROVIDER'
      | 'NOT_ALLOWED'
      | 'NO_ACCOUNT'
      | 'NO_EMAIL'
      | 'EMAIL_UNVERIFIED'
      | 'ALREADY_LINKED',
    message: string,
  ) {
    super(message)
  }
}

/** What we keep from the provider's claims. */
export type SsoProfile = {
  issuer: string
  subject: string
  email: string | null
  emailVerified: boolean
  name: string | null
  groups: string[]
}

type Pending = {
  verifier: string
  nonce: string
  next: string
  mode: 'login' | 'link'
  userId: string | null
  createdAt: number
}

export type SsoResult =
  | {
      kind: 'login'
      user: UserRow
      session: { token: string; expiresAt: Date }
      next: string
    }
  | { kind: 'link'; user: UserRow }

/** Only same-origin paths survive; anything else lands on the home page. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/'
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw.slice(0, 500)
}

/** Groups arrive as an array, a single string, or not at all. Keycloak prefixes
 *  full paths with "/", so both spellings are kept. */
function readGroups(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const out = new Set<string>()
  for (const g of raw) {
    if (typeof g !== 'string' || !g) continue
    out.add(g)
    if (g.startsWith('/')) out.add(g.slice(1))
  }
  return [...out]
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function domainAllowed(email: string, allowed: string): boolean {
  const list = allowed
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  if (list.length === 0) return true
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return list.includes(domain)
}

export function createSsoService(deps: {
  repo: Repo
  auth: AuthService
  settings: SettingsService
  baseUrl: string
  now?: () => Date
  /** tests swap in a fake identity provider here */
  fetch?: oidc.CustomFetch
}) {
  const { repo, auth, settings } = deps
  const now = deps.now ?? (() => new Date())
  const redirectUri = `${deps.baseUrl.replace(/\/+$/, '')}/auth/oidc/callback`
  const pending = new Map<string, Pending>()
  let cached: { key: string; config: oidc.Configuration; at: number } | null = null

  function current(): OidcSettings {
    const cfg = settings.effectiveOidc()
    if (!cfg) throw new SsoError('NOT_CONFIGURED', 'Single sign-on is not set up.')
    return cfg
  }

  async function discover(cfg: OidcSettings): Promise<oidc.Configuration> {
    const options: oidc.DiscoveryRequestOptions = {}
    if (deps.fetch) options[oidc.customFetch] = deps.fetch
    // homelab providers on a private network are sometimes plain http
    if (cfg.issuer.startsWith('http://')) options.execute = [oidc.allowInsecureRequests]
    try {
      return await oidc.discovery(
        new URL(cfg.issuer),
        cfg.clientId,
        cfg.clientSecret || undefined,
        cfg.clientSecret ? undefined : oidc.None(),
        options,
      )
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'no response'
      throw new SsoError('PROVIDER', `Couldn't reach the identity provider (${detail}).`)
    }
  }

  async function clientConfig(cfg: OidcSettings): Promise<oidc.Configuration> {
    const key = `${cfg.issuer}\n${cfg.clientId}\n${cfg.clientSecret}`
    if (cached && cached.key === key && Date.now() - cached.at < DISCOVERY_TTL_MS) {
      return cached.config
    }
    const config = await discover(cfg)
    cached = { key, config, at: Date.now() }
    return config
  }

  function prune() {
    const cutoff = Date.now() - PENDING_TTL_MS
    for (const [state, p] of pending) if (p.createdAt < cutoff) pending.delete(state)
  }

  async function syncRole(user: UserRow, groups: string[], cfg: OidcSettings): Promise<UserRow> {
    if (!cfg.adminGroup) return user
    const want = groups.includes(cfg.adminGroup) ? 'admin' : 'member'
    if (want === user.role) return user
    if (want === 'member') {
      // never demote the last admin: that would leave nobody to fix the config
      const admins = (await repo.listUsers()).filter((u) => u.role === 'admin')
      if (admins.length <= 1) return user
    }
    await repo.updateUser(user.id, { role: want })
    return { ...user, role: want }
  }

  async function link(user: UserRow, profile: SsoProfile) {
    await repo.insertIdentity({
      id: nanoid(),
      userId: user.id,
      issuer: profile.issuer,
      subject: profile.subject,
      email: profile.email,
      createdAt: now(),
      lastLoginAt: now(),
    })
  }

  const service = {
    redirectUri,

    /** Try discovery with settings that may not be saved yet (the Test button). */
    async probe(cfg: OidcSettings): Promise<{ issuer: string }> {
      const config = await discover(cfg)
      return { issuer: config.serverMetadata().issuer }
    },

    async begin(input: {
      next: string
      mode?: 'login' | 'link'
      userId?: string
    }): Promise<{ url: string; state: string }> {
      const cfg = current()
      const config = await clientConfig(cfg)
      prune()
      const verifier = oidc.randomPKCECodeVerifier()
      const state = oidc.randomState()
      const nonce = oidc.randomNonce()
      pending.set(state, {
        verifier,
        nonce,
        next: safeNext(input.next),
        mode: input.mode ?? 'login',
        userId: input.userId ?? null,
        createdAt: Date.now(),
      })
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: cfg.scopes || 'openid email profile',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      })
      return { url: url.href, state }
    },

    /** The callback: `currentUrl` is the full URL the provider sent the browser to. */
    async complete(currentUrl: URL, cookieState: string | undefined): Promise<SsoResult> {
      const cfg = current()
      const providerError = currentUrl.searchParams.get('error')
      if (providerError) {
        const desc = currentUrl.searchParams.get('error_description')
        throw new SsoError('PROVIDER', `The identity provider said no: ${desc || providerError}.`)
      }
      const state = currentUrl.searchParams.get('state') ?? ''
      const p = pending.get(state)
      pending.delete(state)
      if (!state || state !== cookieState || !p || Date.now() - p.createdAt > PENDING_TTL_MS) {
        throw new SsoError('EXPIRED', 'That sign-in expired. Please try again.')
      }

      const config = await clientConfig(cfg)
      let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>
      try {
        tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
          pkceCodeVerifier: p.verifier,
          expectedState: state,
          expectedNonce: p.nonce,
          idTokenExpected: true,
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown error'
        throw new SsoError('PROVIDER', `Sign-in with the identity provider failed (${detail}).`)
      }
      const claims = tokens.claims()
      if (!claims) throw new SsoError('PROVIDER', 'The identity provider sent no ID token.')

      // Many providers keep email and groups out of the ID token and only
      // answer them from the userinfo endpoint.
      let info: Record<string, unknown> = { ...claims }
      const groupsClaim = cfg.groupsClaim || 'groups'
      const missing =
        !info.email || (cfg.requiredGroup || cfg.adminGroup ? !(groupsClaim in info) : false)
      if (missing && config.serverMetadata().userinfo_endpoint) {
        try {
          info = { ...(await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)), ...info }
        } catch {
          // the ID token is still good; carry on with what it has
        }
      }

      const profile: SsoProfile = {
        issuer: config.serverMetadata().issuer,
        subject: claims.sub,
        email: str(info.email)?.toLowerCase() ?? null,
        emailVerified: info.email_verified === true || info.email_verified === 'true',
        name: str(info.name) ?? str(info.preferred_username),
        groups: readGroups(info[groupsClaim]),
      }

      if (p.mode === 'link') {
        const user = p.userId ? await repo.getUserById(p.userId) : null
        if (!user) throw new SsoError('EXPIRED', 'That sign-in expired. Please try again.')
        await service.linkIdentity(user, profile)
        return { kind: 'link', user }
      }

      const user = await service.resolveUser(profile, cfg)
      return { kind: 'login', user, session: await auth.sessionFor(user.id), next: p.next }
    },

    /** Map a provider identity to a local account (see the header comment). */
    async resolveUser(profile: SsoProfile, cfg: OidcSettings): Promise<UserRow> {
      if (cfg.requiredGroup && !profile.groups.includes(cfg.requiredGroup)) {
        throw new SsoError(
          'NOT_ALLOWED',
          'Your account at the identity provider is not allowed here.',
        )
      }
      if (profile.email && !domainAllowed(profile.email, cfg.allowedDomains)) {
        throw new SsoError(
          'NOT_ALLOWED',
          `Accounts from ${profile.email.split('@')[1]} are not allowed here.`,
        )
      }

      const identity = await repo.getIdentity(profile.issuer, profile.subject)
      if (identity) {
        const user = await repo.getUserById(identity.userId)
        if (user) {
          await repo.touchIdentity(identity.id, { lastLoginAt: now(), email: profile.email })
          return syncRole(user, profile.groups, cfg)
        }
      }

      if (!profile.email) {
        throw new SsoError(
          'NO_EMAIL',
          'The identity provider did not share an email address. Add the "email" scope and try again.',
        )
      }

      const existing = await repo.getUserByEmail(profile.email)
      if (existing) {
        if (!profile.emailVerified) {
          throw new SsoError(
            'EMAIL_UNVERIFIED',
            'Your identity provider has not verified this email, so it can’t be matched to your account automatically. Sign in with your password, then link single sign-on in Settings → Account.',
          )
        }
        await link(existing, profile)
        return syncRole(existing, profile.groups, cfg)
      }

      const firstUser = await auth.needsSetup()
      if (!firstUser && !cfg.autoCreate) {
        throw new SsoError(
          'NO_ACCOUNT',
          `There is no account for ${profile.email} here. Ask an admin to invite you.`,
        )
      }
      const inAdminGroup = Boolean(cfg.adminGroup) && profile.groups.includes(cfg.adminGroup)
      const role = firstUser || inAdminGroup ? 'admin' : 'member'
      const user = await auth.createSsoUser({
        email: profile.email,
        name: profile.name ?? profile.email.split('@')[0] ?? profile.email,
        role,
      })
      await link(user, profile)
      return user
    },

    /** Attach a provider identity to an account that is already signed in. */
    async linkIdentity(user: UserRow, profile: SsoProfile): Promise<void> {
      const identity = await repo.getIdentity(profile.issuer, profile.subject)
      if (identity && identity.userId !== user.id) {
        throw new SsoError('ALREADY_LINKED', 'That identity is already linked to another account.')
      }
      if (identity) {
        await repo.touchIdentity(identity.id, { lastLoginAt: now(), email: profile.email })
        return
      }
      await link(user, profile)
    },
  }
  return service
}

export type SsoService = ReturnType<typeof createSsoService>
