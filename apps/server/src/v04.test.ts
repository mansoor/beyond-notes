import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { extractPageLinks } from './links'
import { createPagesService } from './pages'
import { createPublishingService } from './publishing'
import { createRepo } from './repo'
import type { UserRow } from './repo'
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

const para = (text: string, extra: object[] = []) =>
  JSON.stringify([
    {
      id: `b${text.replace(/\W/g, '').slice(0, 10)}`,
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text, styles: {} }, ...extra],
      children: [],
    },
  ])

describe('page link extraction', () => {
  it('finds /p/<id> links, ignores external hrefs, dedupes', () => {
    const content = para('see ', [
      { type: 'link', href: '/p/abcdefghij1234', content: [{ type: 'text', text: 'That page' }] },
      { type: 'link', href: 'https://x.dev/p/nothanks12345', content: [] },
      { type: 'link', href: '/p/abcdefghij1234', content: [] },
    ])
    expect(extractPageLinks(content)).toEqual(['abcdefghij1234'])
    expect(extractPageLinks('not json')).toEqual([])
    expect(extractPageLinks(para('plain text'))).toEqual([])
  })
})

for (const dialect of dialects) {
  describe(`v0.4 core (${dialect.name})`, () => {
    let appDb: AppDb
    let server: Awaited<ReturnType<typeof buildServer>>
    let user: UserRow
    let repo: ReturnType<typeof createRepo>
    let pagesSvc: ReturnType<typeof createPagesService>
    let publishing: ReturnType<typeof createPublishingService>

    const HOST = 'v04.example.test'
    let spaceId: string

    async function makePage(parentId: string | null, title: string, body: string) {
      const page = await pagesSvc.createPage(user, { spaceId, parentId, title })
      const { doc } = await pagesSvc.getPage(user, page.id)
      await pagesSvc.saveDocument(user, {
        pageId: page.id,
        content: para(body),
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })
      return page
    }

    const get = (url: string) => server.inject({ method: 'GET', url, headers: { host: HOST } })

    beforeAll(async () => {
      appDb = await dialect.make()
      const config = loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.example.test',
        DATABASE_URL: 'unused',
      } as never)
      server = await buildServer(config, appDb)
      repo = createRepo(appDb)
      const auth = createAuthService(repo)
      pagesSvc = createPagesService(repo)
      publishing = createPublishingService(repo)
      user = (await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })).user
      const space = await pagesSvc.createSpace(user, {
        name: 'Site',
        category: 'site',
        personal: false,
      })
      spaceId = space.id
      await publishing.updateSpacePublishing(user, {
        spaceId,
        enabled: true,
        host: HOST,
        title: null,
        footer: null,
        theme: 'paper',
      })
    })

    afterAll(async () => {
      await server.close()
      await appDb.close()
    })

    it('renaming a published page re-slugs it and 301s the old URL', async () => {
      const page = await makePage(null, 'Original Name', 'hello world')
      await publishing.publish(user, page.id)
      expect((await get('/original-name')).statusCode).toBe(200)

      await pagesSvc.renamePage(user, page.id, 'Better Name')
      await publishing.publish(user, page.id)

      expect((await get('/better-name')).statusCode).toBe(200)
      const redirect = await get('/original-name')
      expect(redirect.statusCode).toBe(301)
      expect(redirect.headers.location).toBe('/better-name')
      // unknown paths still 404
      expect((await get('/never-existed')).statusCode).toBe(404)
    })

    it('internal /p/<id> links rewrite to public paths at serve time', async () => {
      const target = await makePage(null, 'Link Target', 'the target')
      const source = await pagesSvc.createPage(user, { spaceId, parentId: null, title: 'Source' })
      const { doc } = await pagesSvc.getPage(user, source.id)
      await pagesSvc.saveDocument(user, {
        pageId: source.id,
        content: para('go to ', [
          { type: 'link', href: `/p/${target.id}`, content: [{ type: 'text', text: 'Target' }] },
        ]),
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })
      // the link index picked it up on save
      expect(await repo.listBacklinks(target.id)).toEqual([source.id])

      // publish source BEFORE target: link stays app-relative (target not live)
      await publishing.publish(user, source.id)
      expect((await get('/source')).body).toContain(`href="/p/${target.id}"`)

      // once the target is live, the SAME snapshot serves a real site URL
      await publishing.publish(user, target.id)
      expect((await get('/source')).body).toContain('href="/link-target"')
    })

    it('trash pulls a published subtree off the site; restore brings it back', async () => {
      const parent = await makePage(null, 'Trash Parent', 'parent body')
      const child = await makePage(parent.id, 'Trash Child', 'child body')
      await publishing.publish(user, parent.id)
      await publishing.publish(user, child.id)
      expect((await get('/trash-parent/trash-child')).statusCode).toBe(200)

      await pagesSvc.trashPage(user, parent.id)
      expect((await get('/trash-parent')).statusCode).toBe(404)
      expect((await get('/trash-parent/trash-child')).statusCode).toBe(404)
      // gone from the tree, listed in trash
      const tree = await pagesSvc.tree(user, spaceId)
      expect(tree.map((p) => p.id)).not.toContain(parent.id)
      const trashed = await pagesSvc.listTrashed(user)
      expect(trashed.map((t) => t.page.id)).toEqual(
        expect.arrayContaining([parent.id]), // child is under the trashed root, not a root itself
      )
      expect(trashed.map((t) => t.page.id)).not.toContain(child.id)

      await pagesSvc.restoreTrashedPage(user, parent.id)
      expect((await get('/trash-parent/trash-child')).statusCode).toBe(200)
      expect((await pagesSvc.tree(user, spaceId)).map((p) => p.id)).toContain(child.id)
    })

    it('deleteForever only works from the trash; purge removes expired subtrees', async () => {
      const page = await makePage(null, 'Doomed', 'doomed body')
      await expect(pagesSvc.deleteForever(user, page.id)).rejects.toThrow('Only trashed')

      await pagesSvc.trashPage(user, page.id)
      // not yet expired — a purge with a cutoff in the past leaves it alone
      expect(await pagesSvc.purgeExpiredTrash(new Date(Date.now() - 1000))).toBe(0)
      expect(await repo.getPage(page.id)).not.toBeNull()
      // expired — cutoff after the trashing moment
      expect(await pagesSvc.purgeExpiredTrash(new Date(Date.now() + 1000))).toBe(1)
      expect(await repo.getPage(page.id)).toBeNull()
    })

    it('duplicate copies content and settings but starts unpublished', async () => {
      const original = await makePage(null, 'Dup Me', 'unique-dup-body')
      await publishing.publish(user, original.id)
      const copy = await pagesSvc.duplicatePage(user, original.id)
      expect(copy.title).toBe('Dup Me (copy)')
      expect(copy.liveVersionId).toBeNull()
      const { doc } = await pagesSvc.getPage(user, copy.id)
      expect(doc.content).toContain('unique-dup-body')
    })

    it('templates snapshot content and are immutable to later edits', async () => {
      const page = await makePage(null, 'Tpl Source', 'template body v1')
      const { doc } = await pagesSvc.getPage(user, page.id)
      await repo.insertTemplate({
        id: 'tpl1',
        name: 'Meeting notes',
        content: doc.content,
        createdBy: user.id,
        createdAt: new Date(),
      })
      // later edits to the source do not touch the template
      await pagesSvc.saveDocument(user, {
        pageId: page.id,
        content: para('template body v2'),
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })
      const tpl = await repo.getTemplate('tpl1')
      expect(tpl?.content).toContain('template body v1')
    })
  })
}
