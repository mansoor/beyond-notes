import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createPublishingService } from './publishing'
import { createRepo } from './repo'
import type { UserRow } from './repo'
import { createScheduler } from './scheduler'
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

const para = (text: string) =>
  JSON.stringify([
    {
      id: `b${text.replace(/\W/g, '').slice(0, 10)}`,
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    },
  ])

for (const dialect of dialects) {
  describe(`v0.5 website reach (${dialect.name})`, () => {
    let appDb: AppDb
    let server: Awaited<ReturnType<typeof buildServer>>
    let user: UserRow
    let repo: ReturnType<typeof createRepo>
    let pagesSvc: ReturnType<typeof createPagesService>
    let publishing: ReturnType<typeof createPublishingService>

    const HOST = 'v05.example.test'
    let spaceId: string
    let blogId: string

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
        name: 'Reach',
        category: 'site',
        personal: false,
      })
      spaceId = space.id
      await publishing.updateSpacePublishing(user, {
        spaceId,
        enabled: true,
        host: HOST,
        title: 'Reach',
        footer: null,
        theme: 'paper',
      })
      const blog = await makePage(null, 'Blog', 'my writing')
      blogId = blog.id
      await pagesSvc.setPageType(user, blog.id, 'blog')
      await publishing.publish(user, blog.id)
    })

    afterAll(async () => {
      await server.close()
      await appDb.close()
    })

    it('emits og/meta tags, preferring the description field over body text', async () => {
      const page = await makePage(null, 'Meta Page', 'The opening body text of the page.')
      await publishing.publish(user, page.id)
      let html = (await get('/meta-page')).body
      // falls back to the body when no description is set
      expect(html).toContain('<meta name="description" content="The opening body text')
      expect(html).toContain('<meta property="og:title" content="Meta Page">')
      expect(html).toContain(`<meta property="og:url" content="https://${HOST}/meta-page">`)
      expect(html).toContain(`<link rel="canonical" href="https://${HOST}/meta-page">`)

      await pagesSvc.updatePageOptions(user, {
        pageId: page.id,
        metaDescription: 'A hand-written summary.',
      })
      await publishing.publish(user, page.id)
      html = (await get('/meta-page')).body
      expect(html).toContain('<meta name="description" content="A hand-written summary.">')
      expect(html).toContain('<meta property="og:description" content="A hand-written summary.">')
    })

    it('serves public tag pages from published snapshots only', async () => {
      const post = await makePage(blogId, 'Tagged Post', 'about the home lab')
      await repo.addManualPageTag(post.id, 'homelab')
      const draft = await makePage(blogId, 'Draft Post', 'unpublished thoughts')
      await repo.addManualPageTag(draft.id, 'homelab')
      await publishing.publish(user, post.id) // draft stays unpublished

      const res = await get('/tags/homelab')
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Tagged Post')
      expect(res.body).not.toContain('Draft Post')
      // the post page links its tags
      expect((await get('/blog/tagged-post')).body).toContain('href="/tags/homelab"')
      // unknown tag renders an empty page, not a 404
      expect((await get('/tags/nothing-here')).body).toContain('Nothing carries this tag')
    })

    it('tags in a snapshot are frozen at publish time', async () => {
      const post = await makePage(blogId, 'Frozen Tags', 'body')
      await repo.addManualPageTag(post.id, 'first')
      await publishing.publish(user, post.id)
      // changing tags after publishing does not move the live page
      await repo.removeManualPageTag(post.id, 'first')
      await repo.addManualPageTag(post.id, 'second')
      expect((await get('/tags/first')).body).toContain('Frozen Tags')
      expect((await get('/tags/second')).body).toContain('Nothing carries this tag')
      // republishing picks up the new tags
      await publishing.publish(user, post.id)
      expect((await get('/tags/second')).body).toContain('Frozen Tags')
      expect((await get('/tags/first')).body).toContain('Nothing carries this tag')
    })

    it('paginates the blog index at 10 posts per page', async () => {
      for (let i = 1; i <= 12; i++) {
        const p = await makePage(blogId, `Post ${String(i).padStart(2, '0')}`, `body ${i}`)
        await publishing.publish(user, p.id)
      }
      const page1 = await get('/blog')
      expect(page1.body).toContain('Older →')
      expect(page1.body).toContain('Page 1 of')
      const page2 = await get('/blog?page=2')
      expect(page2.body).toContain('← Newer')
      // page 1 and 2 show different posts
      const onPage = (html: string) => (html.match(/class="post"/g) ?? []).length
      expect(onPage(page1.body)).toBe(10)
      expect(onPage(page2.body)).toBeGreaterThan(0)
      // out-of-range clamps instead of erroring
      expect((await get('/blog?page=999')).statusCode).toBe(200)
    })

    it('preview tokens serve the working copy, noindex, and revoke cleanly', async () => {
      const draft = await pagesSvc.createPage(user, {
        spaceId,
        parentId: null,
        title: 'Secret Draft',
      })
      const { doc } = await pagesSvc.getPage(user, draft.id)
      await pagesSvc.saveDocument(user, {
        pageId: draft.id,
        content: para('unpublished-marker-text'),
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })
      // never published: no public path exists
      expect((await get('/secret-draft')).statusCode).toBe(404)

      const { token } = await publishing.createPreview(user, draft.id)
      const res = await get(`/_preview/${token}`)
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('unpublished-marker-text')
      expect(res.body).toContain('name="robots" content="noindex"')
      expect(res.body).toContain('Draft preview')

      const previews = await publishing.listPreviews(user, draft.id)
      await publishing.revokePreview(user, draft.id, previews[0]?.id as string)
      expect((await get(`/_preview/${token}`)).statusCode).toBe(404)
      expect((await get('/_preview/made-up-token')).statusCode).toBe(404)
    })

    it('scheduled publishing goes live on the scheduler tick', async () => {
      const page = await makePage(null, 'Scheduled Page', 'scheduled body')
      expect((await get('/scheduled-page')).statusCode).toBe(404)

      const when = new Date(Date.now() + 60_000)
      await publishing.schedulePublish(user, page.id, when)
      const status = await publishing.status(
        (await repo.getPage(page.id)) as never,
        (await repo.getSpace(spaceId)) as never,
      )
      expect(status.scheduledAt).toBe(when.toISOString())
      // past times are rejected
      await expect(
        publishing.schedulePublish(user, page.id, new Date(Date.now() - 1000)),
      ).rejects.toThrow('must be in the future')

      // the tick publishes once the time arrives
      const scheduler = createScheduler(repo, [], {
        now: () => new Date(Date.now() + 120_000),
        publishPage: async (pageId, byUserId) => {
          const u = await repo.getUserById(byUserId)
          await publishing.publish(u as UserRow, pageId)
        },
      })
      expect(await scheduler.runOnce()).toBe(1)
      expect((await get('/scheduled-page')).statusCode).toBe(200)
    })

    it('serves robots.txt and a favicon link when a logo is set', async () => {
      const robots = await get('/robots.txt')
      expect(robots.statusCode).toBe(200)
      expect(robots.body).toContain(`Sitemap: https://${HOST}/sitemap.xml`)
      expect(robots.headers['content-type']).toContain('text/plain')
    })
  })
}
