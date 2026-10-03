import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApiTokenService } from './apitokens'
import { AuthError, createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { createRepo } from './repo'
import { buildServer } from './server'

describe('deactivating an account', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await appDb?.close()
  })

  async function boot() {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-deact-')),
      }),
      appDb,
    )
    const repo = createRepo(appDb)
    const auth = createAuthService(repo)
    const { user: admin, session } = await auth.setup({
      name: 'Admin',
      email: 'admin@home.lan',
      password: 'longpassword1',
    })
    const { token: inviteToken } = await auth.createInvite(admin.id, { role: 'member' })
    const { user: ana, session: anaSession } = await auth.acceptInvite({
      token: inviteToken,
      name: 'Ana',
      email: 'ana@home.lan',
      password: 'anapassword1',
    })
    const apiToken = (
      await createApiTokenService({ repo }).create(ana, { name: 'script', scope: 'read' })
    ).token
    return {
      repo,
      auth,
      admin,
      ana,
      adminCookie: `bn_session=${session.token}`,
      anaSession,
      apiToken,
    }
  }

  const s = () => {
    if (!server) throw new Error('boot first')
    return server
  }
  const setActive = (cookie: string, userId: string, active: boolean) =>
    s().inject({
      method: 'POST',
      url: '/api/trpc/users.setActive',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ userId, active }),
    })
  const me = async (cookie: string) =>
    (await s().inject({ method: 'GET', url: '/api/trpc/auth.status', headers: { cookie } })).json()
      .result.data.me

  it('signs the person out everywhere and keeps them out until reactivated', async () => {
    const { auth, repo, ana, adminCookie, anaSession, apiToken } = await boot()
    expect((await me(`bn_session=${anaSession.token}`))?.email).toBe('ana@home.lan')
    expect(
      (
        await s().inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: { authorization: `Bearer ${apiToken}` },
        })
      ).statusCode,
    ).toBe(200)
    expect(await repo.countActiveUsers()).toBe(2)

    const res = await setActive(adminCookie, ana.id, false)
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.find((u: any) => u.id === ana.id)).toMatchObject({
      disabled: true,
    })

    // the open session is gone, the API token stops, and nothing signs them back in
    expect(await me(`bn_session=${anaSession.token}`)).toBeNull()
    expect(
      (
        await s().inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: { authorization: `Bearer ${apiToken}` },
        })
      ).statusCode,
    ).toBe(401)
    await expect(
      auth.login({ email: 'ana@home.lan', password: 'anapassword1' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DISABLED',
    })
    // passkeys, SSO, forward-auth and editions all start sessions through here
    await expect(auth.sessionFor(ana.id)).rejects.toBeInstanceOf(AuthError)
    expect(await repo.countActiveUsers()).toBe(1)

    await setActive(adminCookie, ana.id, true)
    const back = await auth.login({ email: 'ana@home.lan', password: 'anapassword1' })
    expect((await me(`bn_session=${back.session.token}`))?.email).toBe('ana@home.lan')
  })

  it("won't deactivate yourself or the last admin, and members can't do it at all", async () => {
    const { admin, ana, adminCookie, anaSession } = await boot()
    expect((await setActive(adminCookie, admin.id, false)).json().error.message).toMatch(/yourself/)
    expect((await setActive(`bn_session=${anaSession.token}`, admin.id, false)).statusCode).toBe(
      403,
    )
    expect((await setActive(adminCookie, ana.id, false)).statusCode).toBe(200)
  })
})
