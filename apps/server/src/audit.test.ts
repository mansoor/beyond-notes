import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuditService } from './audit'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { createRepo } from './repo'
import { buildServer } from './server'

describe('audit log through the real server', () => {
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
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-audit-')),
        ...env,
      }),
      appDb,
    )
    const auth = createAuthService(createRepo(appDb))
    const { user: owner } = await auth.setup({
      name: 'Owner',
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    return { auth, owner }
  }

  async function call(
    path: string,
    body: unknown,
    opts: { cookie?: string; ip?: string; headers?: Record<string, string> } = {},
  ) {
    if (!server) throw new Error('boot first')
    const res = await server.inject({
      method: 'POST',
      url: `/api/trpc/${path}`,
      remoteAddress: opts.ip ?? '192.0.2.10',
      headers: {
        'content-type': 'application/json',
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...opts.headers,
      },
      payload: JSON.stringify(body),
    })
    const set = res.headers['set-cookie']
    return { res, cookie: (Array.isArray(set) ? set[0] : set)?.split(';')[0] }
  }

  async function events(cookie: string, family = 'all', before?: string) {
    if (!server) throw new Error('boot first')
    const input = encodeURIComponent(JSON.stringify({ family, limit: 50, before }))
    const res = await server.inject({
      method: 'GET',
      url: `/api/trpc/settings.audit?input=${input}`,
      headers: { cookie },
    })
    return { status: res.statusCode, rows: res.json().result?.data as Array<Record<string, any>> }
  }

  it('records failed and successful sign-ins with who and from where', async () => {
    await boot()
    const bad = await call('auth.login', { email: 'owner@home.lan', password: 'wrong-password' })
    expect(bad.res.statusCode).toBe(401)
    const good = await call('auth.login', { email: 'owner@home.lan', password: 'longpassword1' })
    if (!good.cookie) throw new Error('no session')

    const { rows } = await events(good.cookie, 'auth')
    expect(rows.map((r) => r.action)).toEqual(['auth.login', 'auth.login_failed'])
    expect(rows[1]).toMatchObject({
      actorId: null,
      actorEmail: 'owner@home.lan',
      ip: '192.0.2.10',
      detail: { reason: 'BAD_CREDENTIALS' },
    })
    expect(rows[0]?.actorEmail).toBe('owner@home.lan')
  })

  it('records admin actions, and only admins can read the log', async () => {
    const { auth, owner } = await boot()
    const { cookie } = await call('auth.login', {
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    if (!cookie) throw new Error('no session')
    await call('users.createInvite', { suggestedEmail: 'kid@home.lan', role: 'member' }, { cookie })
    await call('settings.saveNtfy', { url: 'https://ntfy.sh', topic: 'x' }, { cookie })

    const admin = await events(cookie, 'all')
    expect(admin.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['user.invited', 'settings.saved', 'auth.login']),
    )
    expect(admin.rows.find((r) => r.action === 'user.invited')).toMatchObject({
      target: 'kid@home.lan',
      detail: { role: 'member' },
    })
    expect((await events(cookie, 'settings')).rows.map((r) => r.action)).toEqual(['settings.saved'])

    // a member gets FORBIDDEN, not the log
    const invite = await auth.createInvite(owner.id, { role: 'member' })
    await auth.acceptInvite({
      token: invite.token,
      name: 'Kid',
      email: 'kid@home.lan',
      password: 'longpassword1',
    })
    const member = await call('auth.login', { email: 'kid@home.lan', password: 'longpassword1' })
    if (!member.cookie) throw new Error('no session')
    expect((await events(member.cookie)).status).toBe(403)
  })

  it('takes the client address from X-Forwarded-For only when the hop is trusted', async () => {
    await boot({ TRUST_PROXY: '10.0.0.5' })
    await call(
      'auth.login',
      { email: 'owner@home.lan', password: 'nope-nope-nope' },
      { ip: '10.0.0.5', headers: { 'x-forwarded-for': '198.51.100.7' } },
    )
    await call(
      'auth.login',
      { email: 'owner@home.lan', password: 'nope-nope-nope' },
      { ip: '203.0.113.9', headers: { 'x-forwarded-for': '198.51.100.99' } },
    )
    const { cookie } = await call('auth.login', {
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    if (!cookie) throw new Error('no session')
    const failed = (await events(cookie, 'auth')).rows.filter(
      (r) => r.action === 'auth.login_failed',
    )
    // newest first: the untrusted hop's claim is ignored, the trusted one's is used
    expect(failed.map((r) => r.ip)).toEqual(['203.0.113.9', '198.51.100.7'])
  })

  it('pages backwards and prunes past the retention window', async () => {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const repo = createRepo(appDb)
    let clock = new Date('2026-01-01T00:00:00Z')
    const audit = createAuditService({ repo, now: () => clock })
    for (let i = 0; i < 5; i++) {
      await audit.record({ action: 'auth.logout', actorEmail: `u${i}@x.dev` })
      clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000)
    }
    const first = await repo.listAuditEvents({ limit: 2 })
    expect(first.map((r) => r.actorEmail)).toEqual(['u4@x.dev', 'u3@x.dev'])
    const next = await repo.listAuditEvents({ limit: 2, before: first[1]?.at })
    expect(next.map((r) => r.actorEmail)).toEqual(['u2@x.dev', 'u1@x.dev'])

    // clock is now Jan 6; keep 3 days → Jan 3, 4, 5 survive
    expect(await audit.prune(3)).toBe(2)
    expect((await repo.listAuditEvents({ limit: 10 })).length).toBe(3)
    expect(await audit.prune(0)).toBe(0) // 0 = keep forever
  })
})
