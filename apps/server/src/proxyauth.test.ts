import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { trustedMatcher } from './proxyauth'
import { createRepo } from './repo'
import { buildServer } from './server'

describe('trusted proxy addresses', () => {
  it('matches single IPs, CIDRs, IPv6, and IPv4-mapped IPv6', () => {
    const trusted = trustedMatcher(['10.0.0.5', '172.18.0.0/16', '::1', 'fd00::/8'])
    expect(trusted('10.0.0.5')).toBe(true)
    expect(trusted('10.0.0.6')).toBe(false)
    expect(trusted('172.18.44.2')).toBe(true)
    expect(trusted('::ffff:172.18.0.3')).toBe(true)
    expect(trusted('172.19.0.1')).toBe(false)
    expect(trusted('::1')).toBe(true)
    expect(trusted('fd12:3456::1')).toBe(true)
    expect(trusted('')).toBe(false)
    expect(trusted('not-an-ip')).toBe(false)
  })

  it('refuses a malformed entry instead of trusting nothing silently', () => {
    expect(() => trustedMatcher(['proxy.lan'])).toThrow(/not an IP/)
  })
})

describe('forward-auth through the real server', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await appDb?.close()
  })

  async function boot(env: Record<string, string> = {}) {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const config = loadConfig({
      NODE_ENV: 'test',
      BASE_URL: 'http://app.test',
      UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-proxy-')),
      AUTH_PROXY_EMAIL_HEADER: 'Remote-Email',
      AUTH_PROXY_NAME_HEADER: 'Remote-Name',
      AUTH_PROXY_GROUPS_HEADER: 'Remote-Groups',
      AUTH_PROXY_TRUSTED_IPS: '10.0.0.5',
      ...env,
    })
    server = await buildServer(config, appDb)
    return createAuthService(createRepo(appDb))
  }

  async function status(opts: { ip: string; headers?: Record<string, string>; cookie?: string }) {
    if (!server) throw new Error('boot first')
    const res = await server.inject({
      method: 'GET',
      url: '/api/trpc/auth.status',
      remoteAddress: opts.ip,
      headers: { ...opts.headers, ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    })
    const body = res.json() as { result: { data: { me: { email: string; role: string } | null } } }
    const setCookie = res.headers['set-cookie']
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0]
    return { me: body.result.data.me, cookie }
  }

  it('signs in whoever the trusted proxy names, and hands out a session cookie', async () => {
    const auth = await boot()
    await auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const r = await status({ ip: '10.0.0.5', headers: { 'remote-email': 'Owner@Home.lan' } })
    expect(r.me?.email).toBe('owner@home.lan')
    expect(r.cookie).toMatch(/^bn_session=/)

    // the cookie is reused on the next request instead of minting another session
    const again = await status({
      ip: '10.0.0.5',
      headers: { 'remote-email': 'owner@home.lan' },
      cookie: r.cookie,
    })
    expect(again.me?.email).toBe('owner@home.lan')
    expect(again.cookie).toBeUndefined()
  })

  it('ignores the header from anywhere but the trusted proxy', async () => {
    const auth = await boot()
    await auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const r = await status({ ip: '203.0.113.9', headers: { 'remote-email': 'owner@home.lan' } })
    expect(r.me).toBeNull()
    expect(r.cookie).toBeUndefined()
  })

  it('does not let a cookie for one person stand in for a different proxy identity', async () => {
    const auth = await boot()
    await auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const { session } = await auth.login({ email: 'owner@home.lan', password: 'longpassword1' })
    const r = await status({
      ip: '10.0.0.5',
      headers: { 'remote-email': 'stranger@home.lan' },
      cookie: `bn_session=${session.token}`,
    })
    // stranger has no account and auto-create is off: signed out, not "owner"
    expect(r.me).toBeNull()
  })

  it('creates accounts when allowed, with the admin group mapped to a role', async () => {
    const auth = await boot({ AUTH_PROXY_AUTO_CREATE: 'true', AUTH_PROXY_ADMIN_GROUP: 'admins' })
    await auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const member = await status({
      ip: '10.0.0.5',
      headers: { 'remote-email': 'kid@home.lan', 'remote-name': 'Kid', 'remote-groups': 'family' },
    })
    expect(member.me).toMatchObject({ email: 'kid@home.lan', role: 'member' })
    const admin = await status({
      ip: '10.0.0.5',
      headers: { 'remote-email': 'partner@home.lan', 'remote-groups': 'family,admins' },
    })
    expect(admin.me).toMatchObject({ email: 'partner@home.lan', role: 'admin' })
  })

  it('stays off when no trusted address is configured', async () => {
    const auth = await boot({ AUTH_PROXY_TRUSTED_IPS: '' })
    await auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const r = await status({ ip: '10.0.0.5', headers: { 'remote-email': 'owner@home.lan' } })
    expect(r.me).toBeNull()
  })

  it('sign-out points at the proxy logout so the proxy does not sign you straight back in', async () => {
    const auth = await boot({ AUTH_PROXY_LOGOUT_URL: 'https://auth.home.lan/logout' })
    await auth.setup({ name: 'Owner', email: 'owner@home.lan', password: 'longpassword1' })
    const r = await status({ ip: '10.0.0.5', headers: { 'remote-email': 'owner@home.lan' } })
    if (!server || !r.cookie) throw new Error('unreachable')
    const res = await server.inject({
      method: 'POST',
      url: '/api/trpc/auth.logout',
      remoteAddress: '10.0.0.5',
      headers: {
        'remote-email': 'owner@home.lan',
        cookie: r.cookie,
        'content-type': 'application/json',
      },
      payload: '{}',
    })
    expect(res.json().result.data).toEqual({ ok: true, redirect: 'https://auth.home.lan/logout' })
  })
})
