import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuthService, newUserRow } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import {
  COMMUNITY,
  type EditionInfo,
  type ServerEdition,
  loadEdition,
  toImportSpecifier,
} from './edition'
import { createRepo } from './repo'
import { buildServer } from './server'

describe('editions', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await appDb?.close()
  })

  async function boot(edition?: ServerEdition) {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-ed-')),
      }),
      appDb,
      edition ? { edition } : {},
    )
    const repo = createRepo(appDb)
    const auth = createAuthService(repo)
    const { user: owner, session } = await auth.setup({
      name: 'Owner',
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    const member = newUserRow({
      id: 'member-1',
      email: 'member@home.lan',
      name: 'Member',
      passwordHash: 'x',
      role: 'member',
      createdAt: new Date(),
    })
    await repo.insertUser(member)
    const memberSession = await auth.sessionFor(member.id)
    return { owner, adminCookie: session.token, memberCookie: memberSession.token }
  }

  async function editionAs(cookie: string): Promise<EditionInfo> {
    if (!server) throw new Error('boot first')
    const res = await server.inject({
      method: 'GET',
      url: '/api/trpc/system.edition',
      headers: { cookie: `bn_session=${cookie}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json().result.data
  }

  it('runs as Community when no module is named', async () => {
    expect(await loadEdition('')).toBe(COMMUNITY)
    const { adminCookie } = await boot()
    expect(await editionAs(adminCookie)).toMatchObject({ name: 'community', features: [] })
  })

  it('refuses to start with a module that is missing or is not an edition', async () => {
    await expect(loadEdition('@bn/no-such-edition')).rejects.toThrow(/could not be loaded/)
    await expect(loadEdition('x', async () => ({ default: { name: 'x' } }))).rejects.toThrow(
      /does not export an edition/,
    )
  })

  it('loads an edition from a file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bn-ed-mod-'))
    const file = join(dir, 'edition.mjs')
    writeFileSync(
      file,
      "export default { name: 'file', register() {}, info: () => ({ name: 'file', label: 'File', features: [], status: null, attention: false }) }\n",
    )
    expect(toImportSpecifier(file)).toMatch(/^file:\/\//)
    expect(toImportSpecifier('@acme/edition')).toBe('@acme/edition')
    expect((await loadEdition(file)).name).toBe('file')
  })

  it('lets an edition add routes that know who is signed in, and report features', async () => {
    const info: EditionInfo = {
      name: 'pro',
      label: 'Pro',
      features: ['sites.no-footer'],
      status: 'Licensed to Home Lab until 2027-01-01',
      attention: false,
    }
    const edition: ServerEdition = {
      name: 'pro',
      register(app, deps) {
        app.get('/api/ee/whoami', async (req) => {
          const { user } = await deps.resolveSession(req)
          return { user: user?.email ?? null, version: deps.version }
        })
      },
      info: () => info,
    }
    const { adminCookie, memberCookie } = await boot(edition)
    if (!server) throw new Error('boot first')

    const anon = await server.inject({ method: 'GET', url: '/api/ee/whoami' })
    expect(anon.json()).toMatchObject({ user: null })
    const signedIn = await server.inject({
      method: 'GET',
      url: '/api/ee/whoami',
      headers: { cookie: `bn_session=${adminCookie}` },
    })
    expect(signedIn.json().user).toBe('owner@home.lan')

    // admins see the licence line; members only see which edition it is
    expect(await editionAs(adminCookie)).toEqual(info)
    expect(await editionAs(memberCookie)).toMatchObject({
      name: 'pro',
      label: 'Pro',
      status: null,
      attention: false,
    })
  })
})
