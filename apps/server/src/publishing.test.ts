import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'
import { buildServer } from './server'

const dialects: Array<{ name: string; make: () => Promise<AppDb> }> = [
  {
    name: 'sqlite',
    make: async () => {
      const db = createDb('file::memory:')
      await db.migrate('./drizzle')
      return db
    },
  },
]

if (process.env.TEST_PG_URL) {
  dialects.push({
    name: 'pg',
    make: async () => {
      const db = createDb(process.env.TEST_PG_URL as string)
      await db.db.execute(sql.raw('drop schema public cascade'))
      await db.db.execute(sql.raw('create schema public'))
      await db.db.execute(sql.raw('drop schema if exists drizzle cascade'))
      await db.migrate('./drizzle')
      return db
    },
  })
}

for (const dialect of dialects) {
  describe(`publishing + public visibility (${dialect.name})`, () => {
    // Full-stack fixture: real fastify server, real HTTP via inject, cookies included.
    let appDb: AppDb
    let server: Awaited<ReturnType<typeof buildServer>>
    let cookie: string

    // page ids for the wiki fixture
    let spaceId: string
    let parent: string
    let child: string
    let draft: string

    const HOST = 'docs.example.test'

    const doc = (text: string) =>
      JSON.stringify([
        {
          id: `b-${text.replace(/\W/g, '')}`,
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text, styles: {} }],
          children: [],
        },
      ])

    async function rpcRaw(path: string, input: unknown) {
      const res = await server.inject({
        method: 'POST',
        url: `/api/trpc/${path}`,
        headers: { 'content-type': 'application/json', cookie },
        payload: JSON.stringify(input),
      })
      return res
    }

    async function rpc(path: string, input: unknown) {
      const res = await rpcRaw(path, input)
      const body = res.json() as any
      if (body.error) throw new Error(body.error.message)
      return body.result?.data
    }

    async function get(url: string, host?: string) {
      return server.inject({ method: 'GET', url, headers: host ? { host } : {} })
    }

    beforeAll(async () => {
      appDb = await dialect.make()
      const config = loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.example.test',
        DATABASE_URL: 'unused',
      } as any)
      server = await buildServer(config, appDb)

      // set up the admin over real HTTP so we get a session cookie
      const setup = await server.inject({
        method: 'POST',
        url: '/api/trpc/auth.setup',
        headers: { 'content-type': 'application/json', host: 'app.example.test' },
        payload: JSON.stringify({ name: 'M', email: 'm@x.dev', password: 'longpassword1' }),
      })
      const setCookie = setup.headers['set-cookie']
      cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0] ?? ''
      expect(cookie).toContain('bn_session=')

      // fixture: Guide (parent) > Install (child); Secrets stays draft
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const pagesSvc = createPagesService(repo)
      const user = (await repo.listUsers())[0]
      if (!user) throw new Error('no user')
      const space = await pagesSvc.createSpace(user, {
        name: 'Product wiki',
        category: 'wiki',
        personal: false,
      })
      spaceId = space.id
      const p = await pagesSvc.createPage(user, { spaceId, parentId: null, title: 'Guide' })
      const c = await pagesSvc.createPage(user, { spaceId, parentId: p.id, title: 'Install' })
      const d = await pagesSvc.createPage(user, { spaceId, parentId: null, title: 'Secrets' })
      parent = p.id
      child = c.id
      draft = d.id
      const g = await pagesSvc.getPage(user, parent)
      await pagesSvc.saveDocument(user, {
        pageId: parent,
        content: doc('Welcome to the guide'),
        baseUpdatedAt: g.doc.updatedAt.toISOString(),
      })
      const i = await pagesSvc.getPage(user, child)
      await pagesSvc.saveDocument(user, {
        pageId: child,
        content: doc('Run docker compose up'),
        baseUpdatedAt: i.doc.updatedAt.toISOString(),
      })
      const s = await pagesSvc.getPage(user, draft)
      await pagesSvc.saveDocument(user, {
        pageId: draft,
        content: doc('SECRET-DRAFT-CONTENT'),
        baseUpdatedAt: s.doc.updatedAt.toISOString(),
      })
    }, 30000)

    afterAll(async () => {
      await server.close()
      await appDb.close()
    })

    it('nothing is served before publishing is enabled and pages are live', async () => {
      const res = await get('/', HOST)
      // host not configured yet -> falls through to app routing (no site leak)
      expect(res.statusCode).toBe(404)

      await rpc('publish.updateSpace', {
        spaceId,
        enabled: true,
        host: HOST,
        title: 'Product wiki',
        footer: '(c) test',
      })
      const home = await get('/', HOST)
      expect(home.statusCode).toBe(404) // enabled but zero live pages
    })

    it('publish makes the live lineage reachable; drafts stay invisible everywhere', async () => {
      await rpc('publish.publish', { pageId: parent })
      await rpc('publish.publish', { pageId: child })

      const home = await get('/', HOST)
      expect(home.statusCode).toBe(302)
      expect(home.headers.location).toBe('/guide')

      const guide = await get('/guide', HOST)
      expect(guide.statusCode).toBe(200)
      expect(guide.body).toContain('Welcome to the guide')
      expect(guide.body).toContain('Install') // child in nav

      const install = await get('/guide/install', HOST)
      expect(install.statusCode).toBe(200)
      expect(install.body).toContain('Run docker compose up')
      expect(install.body).toContain('Previous') // prev/next present

      // the draft: not in nav, not at any path, its content nowhere
      expect(guide.body).not.toContain('Secrets')
      expect(guide.body).not.toContain('SECRET-DRAFT-CONTENT')
      const secretDirect = await get('/secrets', HOST)
      expect(secretDirect.statusCode).toBe(404)
      const search = await get('/_search?q=SECRET', HOST)
      expect(search.body).not.toContain('SECRET-DRAFT-CONTENT')
    })

    it('pending edits never leak: live serves the frozen snapshot', async () => {
      // edit the working copy via the service (simpler than tRPC GET encoding)
      const repo = createRepo(appDb)
      const pagesSvc = createPagesService(repo)
      const user = (await repo.listUsers())[0]
      if (!user) throw new Error('no user')
      const g = await pagesSvc.getPage(user, parent)
      await pagesSvc.saveDocument(user, {
        pageId: parent,
        content: doc('UNPUBLISHED-EDIT'),
        baseUpdatedAt: g.doc.updatedAt.toISOString(),
      })

      const guide = await get('/guide', HOST)
      expect(guide.body).toContain('Welcome to the guide')
      expect(guide.body).not.toContain('UNPUBLISHED-EDIT')

      // publish v2 -> now the edit is live
      await rpc('publish.publish', { pageId: parent })
      const guide2 = await get('/guide', HOST)
      expect(guide2.body).toContain('UNPUBLISHED-EDIT')
    })

    it('republish moves the pointer back; retire cuts the subtree', async () => {
      const versions = (await server
        .inject({
          method: 'GET',
          url: `/api/trpc/publish.versions?input=${encodeURIComponent(JSON.stringify({ pageId: parent }))}`,
          headers: { cookie, host: 'app.example.test' },
        })
        .then((r) => (r.json() as any).result?.data)) as Array<{ id: string; version: number }>
      const v1 = versions.find((v) => v.version === 1)
      if (!v1) throw new Error('v1 missing')

      await rpc('publish.republish', { pageId: parent, versionId: v1.id })
      const guide = await get('/guide', HOST)
      expect(guide.body).toContain('Welcome to the guide')
      expect(guide.body).not.toContain('UNPUBLISHED-EDIT')

      // retiring the parent makes the (still-live) child unreachable too
      await rpc('publish.retire', { pageId: parent })
      expect((await get('/guide', HOST)).statusCode).toBe(404)
      expect((await get('/guide/install', HOST)).statusCode).toBe(404)
      // and nothing about it appears in search
      const search = await get('/_search?q=docker', HOST)
      expect(search.body).not.toContain('Install')

      // republishing the parent restores the child as well
      await rpc('publish.publish', { pageId: parent })
      expect((await get('/guide/install', HOST)).statusCode).toBe(200)
    })

    it('search hits live content only, scoped to the site', async () => {
      const hit = await get('/_search?q=docker', HOST)
      expect(hit.statusCode).toBe(200)
      expect(hit.body).toContain('Install')
      const miss = await get('/_search?q=SECRET-DRAFT', HOST)
      expect(miss.body).toContain('No results')
    })

    it('the path-based dev escape enforces the same rules', async () => {
      const install = await get(`/s/${HOST}/guide/install`)
      expect(install.statusCode).toBe(200)
      expect(install.body).toContain('Run docker compose up')
      expect(install.body).toContain(`/s/${HOST}/guide`) // links stay inside the escape
      expect((await get(`/s/${HOST}/secrets`)).statusCode).toBe(404)
      expect((await get('/s/unknown.example/')).statusCode).toBe(404)
    })

    it('disabling publishing takes the whole site down at once', async () => {
      await rpc('publish.updateSpace', {
        spaceId,
        enabled: false,
        host: HOST,
        title: 'Product wiki',
        footer: '',
      })
      expect((await get('/guide', HOST)).statusCode).toBe(404)
      expect((await get(`/s/${HOST}/guide`)).statusCode).toBe(404)
      // re-enable for any later assertions
      await rpc('publish.updateSpace', {
        spaceId,
        enabled: true,
        host: HOST,
        title: 'Product wiki',
        footer: '',
      })
      expect((await get('/guide', HOST)).statusCode).toBe(200)
    })
  })
}
