import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
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

for (const dialect of dialects) {
  describe(`website renderer (${dialect.name})`, () => {
    let appDb: AppDb
    let server: Awaited<ReturnType<typeof buildServer>>
    let user: UserRow
    let repo: ReturnType<typeof createRepo>
    let pagesSvc: ReturnType<typeof createPagesService>
    let publishing: ReturnType<typeof createPublishingService>

    const HOST = 'site.example.test'
    let siteSpaceId: string
    let blogId: string
    let notebookSpaceId: string

    const doc = (text: string) =>
      JSON.stringify([
        {
          id: `b-${Math.abs(text.length * 7919)}${text.replace(/\W/g, '').slice(0, 8)}`,
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text, styles: {} }],
          children: [],
        },
      ])

    async function makePage(spaceId: string, parentId: string | null, title: string, body: string) {
      const page = await pagesSvc.createPage(user, { spaceId, parentId, title })
      const { doc: d } = await pagesSvc.getPage(user, page.id)
      await pagesSvc.saveDocument(user, {
        pageId: page.id,
        content: doc(body),
        baseUpdatedAt: d.updatedAt.toISOString(),
      })
      return page
    }

    async function get(url: string) {
      return server.inject({ method: 'GET', url, headers: { host: HOST } })
    }

    beforeAll(async () => {
      appDb = await dialect.make()
      const config = loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.example.test',
        DATABASE_URL: 'unused',
      } as any)
      server = await buildServer(config, appDb)
      repo = createRepo(appDb)
      const auth = createAuthService(repo)
      pagesSvc = createPagesService(repo)
      publishing = createPublishingService(repo)
      const res = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      user = res.user

      // site: Home, About, Blog(blog type) with two posts + one draft post
      const site = await pagesSvc.createSpace(user, {
        name: 'mansoor.io',
        category: 'site',
        personal: false,
      })
      siteSpaceId = site.id
      const home = await makePage(site.id, null, 'Home', 'Welcome to my corner of the web')
      const about = await makePage(site.id, null, 'About', 'About me')
      const blog = await makePage(site.id, null, 'Blog', 'Writing about self-hosting')
      blogId = blog.id
      await pagesSvc.setPageType(user, blog.id, 'blog')
      const post1 = await makePage(
        site.id,
        blog.id,
        'Shipping Beyond Notes',
        'It ships in a container',
      )
      const post2 = await makePage(
        site.id,
        blog.id,
        'On attention',
        'Attention is the scarce thing',
      )
      await makePage(site.id, blog.id, 'Draft post', 'UNPUBLISHED-POST-CONTENT')

      await publishing.updateSpacePublishing(user, {
        spaceId: site.id,
        enabled: true,
        host: HOST,
        title: 'Mansoor',
        footer: '(c) 2026',
        theme: 'ink',
      })
      await publishing.publish(user, home.id)
      await publishing.publish(user, about.id)
      await publishing.publish(user, blog.id)
      await publishing.publish(user, post1.id)
      await publishing.publish(user, post2.id)

      // a notebook with a note to promote later
      const notebook = await pagesSvc.createSpace(user, {
        name: 'Notes',
        category: 'notebook',
        personal: false,
      })
      notebookSpaceId = notebook.id
    }, 30000)

    afterAll(async () => {
      await server.close()
      await appDb.close()
    })

    it('renders the home page at / with top nav and the ink theme', async () => {
      const res = await get('/')
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Welcome to my corner of the web')
      expect(res.body).toContain('>Home<')
      expect(res.body).toContain('>About<')
      expect(res.body).toContain('>Blog<')
      // ink theme is always-dark: its bg token is baked in, no media query for it
      expect(res.body).toContain('--bg:#15161a')
    })

    it('blog index lists live posts newest-first with dates; drafts absent', async () => {
      const res = await get('/blog')
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Writing about self-hosting')
      expect(res.body).toContain('Shipping Beyond Notes')
      expect(res.body).toContain('On attention')
      expect(res.body).not.toContain('Draft post')
      expect(res.body).not.toContain('UNPUBLISHED-POST-CONTENT')
      // RSS advertised
      expect(res.body).toContain('rss.xml')
    })

    it('post pages render with date and backlink to the blog', async () => {
      const res = await get('/blog/shipping-beyond-notes')
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('It ships in a container')
      expect(res.body).toContain('← Blog')
      expect(res.body).toMatch(/\d{4}-\d{2}-\d{2}/)
    })

    it('rss.xml carries live posts only; sitemap lists live urls', async () => {
      const rss = await get('/rss.xml')
      expect(rss.statusCode).toBe(200)
      expect(rss.headers['content-type']).toContain('rss')
      expect(rss.body).toContain('Shipping Beyond Notes')
      expect(rss.body).toContain(`https://${HOST}/blog/on-attention`)
      expect(rss.body).not.toContain('Draft post')

      const sitemap = await get('/sitemap.xml')
      expect(sitemap.body).toContain(`https://${HOST}/blog/shipping-beyond-notes`)
      expect(sitemap.body).not.toContain('draft')
    })

    it('note → blog post: cross-space move carries the page, publish makes it a post', async () => {
      const note = await makePage(
        notebookSpaceId,
        null,
        'Why I left my old notes app',
        'It was slow',
      )
      // promote: move into the site space under the blog page
      await pagesSvc.movePage(user, {
        pageId: note.id,
        parentId: blogId,
        index: 9999,
        spaceId: siteSpaceId,
      })
      const moved = await repo.getPage(note.id)
      expect(moved?.spaceId).toBe(siteSpaceId)
      expect(moved?.parentId).toBe(blogId)

      // not on the site until published
      let blogPage = await get('/blog')
      expect(blogPage.body).not.toContain('Why I left my old notes app')

      await publishing.publish(user, note.id)
      blogPage = await get('/blog')
      expect(blogPage.body).toContain('Why I left my old notes app')
      const post = await get('/blog/why-i-left-my-old-notes-app')
      expect(post.statusCode).toBe(200)
      expect(post.body).toContain('It was slow')
      const rss = await get('/rss.xml')
      expect(rss.body).toContain('Why I left my old notes app')
    })

    it('cross-space move resets colliding slugs so publish stays unambiguous', async () => {
      // a note whose slug collides with the existing 'about' slug
      const clash = await makePage(notebookSpaceId, null, 'About', 'A different about note')
      await publishing.publish(user, clash.id) // gives it slug 'about' in the notebook
      const before = await repo.getPage(clash.id)
      expect(before?.slug).toBe('about')

      await pagesSvc.movePage(user, {
        pageId: clash.id,
        parentId: null,
        index: 9999,
        spaceId: siteSpaceId,
      })
      const after = await repo.getPage(clash.id)
      expect(after?.slug).toBeNull() // regenerates uniquely at next publish

      await publishing.publish(user, clash.id)
      const republished = await repo.getPage(clash.id)
      expect(republished?.slug).toBe('about-2')
    })
  })
}
