import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { oidcSettings } from '@bn/schema'
import type { CustomFetch } from 'openid-client'
import { describe, expect, it } from 'vitest'
import { AuthError, createAuthService } from './auth'
import { loadConfig } from './config'
import { createDb } from './db'
import { createRepo } from './repo'
import { createSettingsService } from './settings'
import { SsoError, createSsoService, safeNext } from './sso'

// A tiny in-memory OpenID provider, reached through openid-client's customFetch
// hook, so the real library does the real checks (signature, issuer, audience,
// nonce, PKCE plumbing) against tokens we mint here.
const ISSUER = 'https://idp.test'
const CLIENT_ID = 'beyond-notes'

function makeIdp() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, { nonce: string; claims: Record<string, unknown> }>()
  let userinfo: Record<string, unknown> = {}

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  function sign(payload: Record<string, unknown>) {
    const input = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(payload)}`
    const sig = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')
    return `${input}.${sig}`
  }
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    )
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body ?? ''))
      const entry = codes.get(body.get('code') ?? '')
      if (!entry) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
      const nowS = Math.floor(Date.now() / 1000)
      return json({
        access_token: 'access',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: sign({
          iss: ISSUER,
          aud: CLIENT_ID,
          iat: nowS,
          exp: nowS + 300,
          nonce: entry.nonce,
          ...entry.claims,
        }),
      })
    }
    if (url.pathname === '/userinfo') return json(userinfo)
    return new Response('not found', { status: 404 })
  }) as unknown as CustomFetch

  return {
    fetch: fetchImpl,
    /** the provider "authenticates" someone and issues a code for them */
    issue(code: string, nonce: string, claims: Record<string, unknown>) {
      codes.set(code, { nonce, claims })
    },
    setUserinfo(info: Record<string, unknown>) {
      userinfo = info
    },
  }
}

async function makeWorld(oidc: Partial<ReturnType<typeof oidcSettings.parse>> = {}) {
  const appDb = createDb('file::memory:')
  await appDb.migrate('./drizzle')
  const repo = createRepo(appDb)
  const config = loadConfig({ BASE_URL: 'https://app.test', NODE_ENV: 'test' })
  const settings = createSettingsService(repo, config, { secretsKey: randomBytes(32) })
  await settings.load()
  await settings.saveOidc(
    oidcSettings.parse({
      enabled: true,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: 's3cret',
      ...oidc,
    }),
  )
  const auth = createAuthService(repo, {
    passwordLoginEnabled: () => settings.passwordLoginEnabled(),
  })
  const idp = makeIdp()
  const sso = createSsoService({
    repo,
    auth,
    settings,
    baseUrl: 'https://app.test',
    fetch: idp.fetch,
  })
  let n = 0

  /** Run one whole browser round trip and return what the callback produced. */
  async function signIn(
    claims: Record<string, unknown>,
    opts: { next?: string; mode?: 'login' | 'link'; userId?: string; tamperState?: boolean } = {},
  ) {
    const { url, state } = await sso.begin({
      next: opts.next ?? '/',
      mode: opts.mode,
      userId: opts.userId,
    })
    const nonce = new URL(url).searchParams.get('nonce') ?? ''
    const code = `code-${++n}`
    idp.issue(code, nonce, claims)
    const cb = new URL(`https://app.test/auth/oidc/callback?code=${code}&state=${state}`)
    return sso.complete(cb, opts.tamperState ? 'someone-elses-state' : state)
  }

  return { appDb, repo, settings, auth, sso, idp, signIn }
}

const alice = { sub: 'alice-1', email: 'alice@home.lan', email_verified: true, name: 'Alice' }

describe('single sign-on', () => {
  it('the first SSO sign-in on an empty instance becomes the admin, then signs in as them', async () => {
    const { signIn, repo, appDb } = await makeWorld()
    const first = await signIn(alice, { next: '/p/abc' })
    expect(first.kind).toBe('login')
    if (first.kind !== 'login') throw new Error('unreachable')
    expect(first.user.role).toBe('admin')
    expect(first.user.passwordSet).toBe(false)
    expect(first.next).toBe('/p/abc')
    expect(first.session.token).toMatch(/^[0-9a-f]{64}$/)

    const again = await signIn(alice)
    if (again.kind !== 'login') throw new Error('unreachable')
    expect(again.user.id).toBe(first.user.id)
    expect(await repo.countUsers()).toBe(1)
    const ids = await repo.listIdentitiesForUser(first.user.id)
    expect(ids).toHaveLength(1)
    expect(ids[0]?.issuer).toBe(ISSUER)
    await appDb.close()
  })

  it('refuses a stranger unless auto-create is on, then makes them a member', async () => {
    const off = await makeWorld()
    await off.auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    await expect(off.signIn(alice)).rejects.toMatchObject({ code: 'NO_ACCOUNT' })
    await off.appDb.close()

    const on = await makeWorld({ autoCreate: true })
    await on.auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const r = await on.signIn(alice)
    expect(r.user.role).toBe('member')
    expect(r.user.email).toBe('alice@home.lan')
    await on.appDb.close()
  })

  it('links an existing account by email only when the provider verified it', async () => {
    const { signIn, auth, appDb } = await makeWorld()
    const { user: owner } = await auth.setup({
      name: 'Alice',
      email: 'alice@home.lan',
      password: 'longpassword1',
    })
    await expect(signIn({ ...alice, email_verified: false })).rejects.toMatchObject({
      code: 'EMAIL_UNVERIFIED',
    })
    const r = await signIn(alice)
    expect(r.user.id).toBe(owner.id)
    // linked now: a later sign-in matches on the identity, even with a new email
    const later = await signIn({ ...alice, email: 'alice@new.lan', email_verified: false })
    expect(later.user.id).toBe(owner.id)
    await appDb.close()
  })

  it('enforces the required group and allowed domains', async () => {
    const grp = await makeWorld({ requiredGroup: 'notes-users' })
    await expect(grp.signIn({ ...alice, groups: ['other'] })).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
    const ok = await grp.signIn({ ...alice, groups: ['notes-users'] })
    expect(ok.user.email).toBe('alice@home.lan')
    await grp.appDb.close()

    const dom = await makeWorld({ allowedDomains: 'example.com, @corp.test' })
    await expect(dom.signIn(alice)).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    const corp = await dom.signIn({ ...alice, email: 'alice@corp.test' })
    expect(corp.user.email).toBe('alice@corp.test')
    await dom.appDb.close()
  })

  it('maps the admin group to roles, but never demotes the last admin', async () => {
    const { signIn, auth, repo, appDb } = await makeWorld({
      adminGroup: '/admins',
      autoCreate: true,
    })
    await auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const promoted = await signIn({ ...alice, groups: ['/admins'] })
    expect(promoted.user.role).toBe('admin')

    // two admins now, so leaving the group demotes Alice
    const demoted = await signIn({ ...alice, groups: [] })
    expect(demoted.user.role).toBe('member')

    // the owner is the only admin left and isn't in the group: stays admin
    const owner = await repo.getUserByEmail('owner@home.lan')
    if (!owner) throw new Error('unreachable')
    await signIn({ sub: 'owner-1', email: 'owner@home.lan', email_verified: true, groups: [] })
    expect((await repo.getUserById(owner.id))?.role).toBe('admin')
    await appDb.close()
  })

  it('reads email and groups from userinfo when the ID token leaves them out', async () => {
    const { signIn, idp, appDb } = await makeWorld({ adminGroup: 'admins' })
    idp.setUserinfo({
      sub: 'alice-1',
      email: 'alice@home.lan',
      email_verified: true,
      groups: ['admins'],
    })
    const r = await signIn({ sub: 'alice-1' })
    expect(r.user.email).toBe('alice@home.lan')
    await appDb.close()
  })

  it('rejects a callback whose state cookie does not match, and a replayed state', async () => {
    const { signIn, sso, idp, appDb } = await makeWorld()
    await expect(signIn(alice, { tamperState: true })).rejects.toMatchObject({ code: 'EXPIRED' })

    const { url, state } = await sso.begin({ next: '/' })
    idp.issue('once', new URL(url).searchParams.get('nonce') ?? '', alice)
    const cb = new URL(`https://app.test/auth/oidc/callback?code=once&state=${state}`)
    await sso.complete(cb, state)
    await expect(sso.complete(cb, state)).rejects.toBeInstanceOf(SsoError)
    await appDb.close()
  })

  it('passes a provider error through as a readable message', async () => {
    const { sso, appDb } = await makeWorld()
    const { state } = await sso.begin({ next: '/' })
    const cb = new URL(
      `https://app.test/auth/oidc/callback?error=access_denied&error_description=User+cancelled&state=${state}`,
    )
    await expect(sso.complete(cb, state)).rejects.toThrow(/User cancelled/)
    await appDb.close()
  })

  it('links an identity to a signed-in account, and not to two accounts', async () => {
    const { signIn, auth, repo, appDb } = await makeWorld({ autoCreate: true })
    const { user: owner } = await auth.setup({
      name: 'Owner',
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    const r = await signIn(
      { sub: 'x-9', email: 'someone@else.lan' },
      { mode: 'link', userId: owner.id },
    )
    expect(r.kind).toBe('link')
    expect(await repo.listIdentitiesForUser(owner.id)).toHaveLength(1)

    // Bob exists separately; linking owner's identity to Bob must fail
    const bob = await signIn({ sub: 'bob-1', email: 'bob@home.lan', email_verified: true })
    await expect(
      signIn({ sub: 'x-9' }, { mode: 'link', userId: bob.user.id }),
    ).rejects.toMatchObject({ code: 'ALREADY_LINKED' })
    await appDb.close()
  })

  it('SSO-only mode blocks member passwords but keeps the admin way in', async () => {
    const { auth, settings, appDb } = await makeWorld({ autoCreate: true })
    const { user: owner } = await auth.setup({
      name: 'Owner',
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    const invite = await auth.createInvite(owner.id, { role: 'member' })
    await auth.acceptInvite({
      token: invite.token,
      name: 'Bob',
      email: 'bob@home.lan',
      password: 'longpassword1',
    })
    const cfg = settings.oidc()
    if (!cfg) throw new Error('unreachable')
    await settings.saveOidc({ ...cfg, passwordLogin: false })

    await expect(
      auth.login({ email: 'bob@home.lan', password: 'longpassword1' }),
    ).rejects.toMatchObject({
      code: 'PASSWORD_LOGIN_DISABLED',
    })
    const admin = await auth.login({ email: 'owner@home.lan', password: 'longpassword1' })
    expect(admin.user.role).toBe('admin')

    // switching SSO off brings password sign-in back for everyone
    await settings.saveOidc({ ...cfg, enabled: false, passwordLogin: false })
    const bob = await auth.login({ email: 'bob@home.lan', password: 'longpassword1' })
    expect(bob.user.email).toBe('bob@home.lan')
    await appDb.close()
  })

  it('an SSO-made account sets its first password without a current one', async () => {
    const { signIn, auth, repo, appDb } = await makeWorld()
    const r = await signIn(alice)
    expect(await auth.checkPassword(r.user, '')).toBe(false)
    await auth.changePassword(r.user, '', 'a-brand-new-password')
    const fresh = await repo.getUserById(r.user.id)
    if (!fresh) throw new Error('unreachable')
    expect(fresh.passwordSet).toBe(true)
    expect(await auth.checkPassword(fresh, 'a-brand-new-password')).toBe(true)
    // from now on the current password is required
    await expect(auth.changePassword(fresh, '', 'another-password-1')).rejects.toBeInstanceOf(
      AuthError,
    )
    await appDb.close()
  })

  it('env config turns SSO on; a saved, disabled DB group turns it back off', async () => {
    const appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const repo = createRepo(appDb)
    const config = loadConfig({
      BASE_URL: 'https://app.test',
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_PASSWORD_LOGIN: 'false',
    })
    const settings = createSettingsService(repo, config, { secretsKey: randomBytes(32) })
    await settings.load()
    expect(settings.effectiveOidc()?.source).toBe('env')
    expect(settings.passwordLoginEnabled()).toBe(false)
    expect(settings.view().oidcRedirectUri).toBe('https://app.test/auth/oidc/callback')

    const env = settings.envOidc()
    if (!env) throw new Error('unreachable')
    await settings.saveOidc({ ...env, enabled: false, passwordLogin: true })
    expect(settings.effectiveOidc()).toBeNull()
    expect(settings.passwordLoginEnabled()).toBe(true)
    expect(settings.view().oidcSource).toBe('off')
    await appDb.close()
  })

  it('keeps redirects on this site', () => {
    expect(safeNext('/p/abc?x=1')).toBe('/p/abc?x=1')
    expect(safeNext('https://evil.test')).toBe('/')
    expect(safeNext('//evil.test')).toBe('/')
    expect(safeNext('/\\evil.test')).toBe('/')
    expect(safeNext(undefined)).toBe('/')
  })
})
