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
    let sessionToken: string
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
      sessionToken = res.session.token

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

    it('nav nests structural sub-pages; posts stay out of the menu', async () => {
      const services = await makePage(siteSpaceId, null, 'Services', 'What I offer')
      const consulting = await makePage(siteSpaceId, services.id, 'Consulting', 'Hourly')
      const rates = await makePage(siteSpaceId, consulting.id, 'Rates', 'Per project')
      await makePage(siteSpaceId, services.id, 'Secret draft', 'DRAFT-CHILD-CONTENT')
      await publishing.publish(user, services.id)
      await publishing.publish(user, consulting.id)
      await publishing.publish(user, rates.id)

      const home = await get('/')
      // Services became a dropdown with its live subtree, indented by depth
      expect(home.body).toContain('class="navitem"')
      expect(home.body).toContain('class="caret"')
      expect(home.body).toContain('class="lvl1" href="/services/consulting"')
      expect(home.body).toContain('class="lvl2" href="/services/consulting/rates"')
      // drafts and posts never reach the menu
      expect(home.body).not.toContain('Secret draft')
      expect(home.body).not.toContain('Shipping Beyond Notes<')
      // Blog renders as a bare link: no caret, no dropdown wrapper of its own
      expect(home.body).not.toContain('>Blog<span class="caret"')
    })

    it('sub-pages get breadcrumbs and parents get an In-this-section list', async () => {
      const rates = await get('/services/consulting/rates')
      expect(rates.statusCode).toBe(200)
      expect(rates.body).toContain('class="crumbs"')
      expect(rates.body).toContain('href="/services">Services</a>')
      expect(rates.body).toContain('href="/services/consulting">Consulting</a>')

      const services = await get('/services')
      expect(services.body).toContain('In this section')
      expect(services.body).toContain('/services/consulting')
      expect(services.body).not.toContain('Secret draft')
      // root pages carry no breadcrumb trail
      expect(services.body).not.toContain('class="crumbs"')
    })

    it('a gallery lists child galleries as album cards with covers from the published grid', async () => {
      const photos = await makePage(siteSpaceId, null, 'Photos', 'All my photos')
      await pagesSvc.setPageType(user, photos.id, 'gallery')
      const trips = await makePage(siteSpaceId, photos.id, 'Trips', 'On the road')
      await pagesSvc.setPageType(user, trips.id, 'gallery')
      const readme = await makePage(siteSpaceId, photos.id, 'About these photos', 'Shot on film')

      // the child gallery gets two published photos (rows only; files not needed)
      await repo.insertAttachment({
        id: 'photatt111111111111111',
        hash: 'h1',
        filename: 'a.jpg',
        mime: 'image/jpeg',
        size: 1,
        width: 1,
        height: 1,
        createdBy: user.id,
        createdAt: new Date(),
      })
      await repo.insertAttachment({
        id: 'photatt222222222222222',
        hash: 'h2',
        filename: 'b.jpg',
        mime: 'image/jpeg',
        size: 1,
        width: 1,
        height: 1,
        createdBy: user.id,
        createdAt: new Date(),
      })
      await repo.insertGalleryItem({
        id: 'gi1',
        pageId: trips.id,
        attachmentId: 'photatt111111111111111',
        position: 0,
        caption: 'dunes',
      })
      await repo.insertGalleryItem({
        id: 'gi2',
        pageId: trips.id,
        attachmentId: 'photatt222222222222222',
        position: 1,
        caption: '',
      })
      await publishing.publish(user, photos.id)
      await publishing.publish(user, trips.id)
      await publishing.publish(user, readme.id)

      const parent = await get('/photos')
      expect(parent.statusCode).toBe(200)
      expect(parent.body).toContain('class="albums"')
      expect(parent.body).toContain('class="album" href="/photos/trips"')
      expect(parent.body).toContain('src="/api/files/photatt111111111111111/thumb"')
      expect(parent.body).toContain('2 photos')
      // the non-gallery child lands in the section list, not the album grid
      expect(parent.body).toContain('In this section')
      expect(parent.body).toContain('/photos/about-these-photos')

      // publishing composed at serve time: the parent snapshot was never touched
      const child = await get('/photos/trips')
      expect(child.body).toContain('class="crumbs"')
      expect(child.body).toContain('href="/photos">Photos</a>')
    })

    it('a post lists its live sub-pages below the content', async () => {
      const post = await makePage(siteSpaceId, blogId, 'Deep dive', 'The details')
      const appendix = await makePage(siteSpaceId, post.id, 'Appendix', 'Extra data')
      await makePage(siteSpaceId, post.id, 'Hidden appendix', 'NOT-PUBLISHED')
      await publishing.publish(user, post.id)
      await publishing.publish(user, appendix.id)

      const page = await get('/blog/deep-dive')
      expect(page.body).toContain('In this section')
      expect(page.body).toContain('/blog/deep-dive/appendix')
      expect(page.body).not.toContain('Hidden appendix')

      // the sub-page carries breadcrumbs back through the post and blog
      const sub = await get('/blog/deep-dive/appendix')
      expect(sub.statusCode).toBe(200)
      expect(sub.body).toContain('href="/blog/deep-dive">Deep dive</a>')

      // the nav menu still excludes the whole blog subtree
      expect(page.body).not.toContain('class="lvl1" href="/blog/')
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

    it('gallery layout + cover + share + socials flow through publish and serve', async () => {
      // social links on the space land in every page header
      await publishing.updateSpacePublishing(user, {
        spaceId: siteSpaceId,
        enabled: true,
        host: HOST,
        title: 'Mansoor',
        footer: '(c) 2026',
        theme: 'ink',
        social: [{ platform: 'github', url: 'https://github.com/mansoor' }],
      })

      const gallery = await makePage(siteSpaceId, null, 'Shots', 'best of')
      await pagesSvc.setPageType(user, gallery.id, 'gallery')
      await repo.insertAttachment({
        id: 'coverpick111111111111',
        hash: 'ch1',
        filename: 'c.jpg',
        mime: 'image/jpeg',
        size: 1,
        width: 1,
        height: 1,
        createdBy: user.id,
        createdAt: new Date(),
      })
      await repo.insertGalleryItem({
        id: 'sg1',
        pageId: gallery.id,
        attachmentId: 'coverpick111111111111',
        position: 0,
        caption: 'the one',
      })
      await pagesSvc.updatePageOptions(user, {
        pageId: gallery.id,
        galleryLayout: 'filmstrip',
        shareEnabled: true,
        coverAttachmentId: 'coverpick111111111111',
      })
      await publishing.publish(user, gallery.id)

      const page = await get('/shots')
      expect(page.body).toContain('class="gallery filmstrip"')
      expect(page.body).toContain('class="track"')
      expect(page.body).toContain('class="sharebar"')
      expect(page.body).toContain(`https%3A%2F%2F${HOST}%2Fshots`)
      expect(page.body).toContain('class="socials"')
      expect(page.body).toContain('https://github.com/mansoor')
      expect(page.body).toContain('.lightbox') // chrome css+js shipped inline

      // pages without the toggle show no share bar
      const home = await get('/')
      expect(home.body).not.toContain('class="sharebar"')

      // the published cover is servable and rides the version snapshot
      const version = await repo.getVersion(
        (await repo.getPage(gallery.id))?.liveVersionId as string,
      )
      expect(version?.coverAttachmentId).toBe('coverpick111111111111')
      expect(JSON.parse(version?.attachmentIds ?? '[]')).toContain('coverpick111111111111')

      // a blog post with a listing image shows it on the blog index
      const post = await makePage(siteSpaceId, blogId, 'Illustrated post', 'look at this')
      await pagesSvc.updatePageOptions(user, {
        pageId: post.id,
        coverAttachmentId: 'coverpick111111111111',
      })
      await publishing.publish(user, post.id)
      const blog = await get('/blog')
      expect(blog.body).toContain('class="postcover"')
      expect(blog.body).toContain('/api/files/coverpick111111111111/thumb')
    })

    it('branding renders (logo, tagline, header layout) and site search finds live content', async () => {
      await repo.insertAttachment({
        id: 'logoatt1111111111111',
        hash: 'lg1',
        filename: 'logo.png',
        mime: 'image/png',
        size: 1,
        width: 1,
        height: 1,
        createdBy: user.id,
        createdAt: new Date(),
      })
      await publishing.updateSpacePublishing(user, {
        spaceId: siteSpaceId,
        enabled: true,
        host: HOST,
        title: 'Mansoor',
        footer: '(c) 2026',
        theme: 'ink',
        logoAttachmentId: 'logoatt1111111111111',
        tagline: 'Notes from the lab',
        headerLayout: 'centered',
      })

      const home = await get('/')
      expect(home.body).toContain('class="hl-centered"')
      expect(home.body).toContain('/api/files/logoatt1111111111111')
      expect(home.body).toContain('Notes from the lab')
      expect(home.body).toContain('class="sitesearch"')
      // the logo is publicly servable while the site is enabled
      expect(await publishing.publicAttachmentIds()).toContain('logoatt1111111111111')

      // search: finds live content, never drafts
      const hits = await get('/_search?q=container')
      expect(hits.statusCode).toBe(200)
      expect(hits.body).toContain('Shipping Beyond Notes')
      const draft = await get('/_search?q=UNPUBLISHED-POST-CONTENT')
      expect(draft.body).not.toContain('Draft post')
      expect(draft.body).toContain('No results')

      // restore the plain config for later tests
      await publishing.updateSpacePublishing(user, {
        spaceId: siteSpaceId,
        enabled: true,
        host: HOST,
        title: 'Mansoor',
        footer: '(c) 2026',
        theme: 'ink',
      })
    })

    it('appearance pins a palette; bloom theme renders bright', async () => {
      // the assertion is about the PALETTE, so look inside <style> only —
      // page scripts legitimately mention prefers-color-scheme for 'auto'
      const styleOf = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''

      // ink on auto is always dark (its identity)
      let home = await get('/')
      expect(home.body).toContain('--bg:#15161a')
      expect(styleOf(home.body)).not.toContain('prefers-color-scheme')

      // pinning light overrides even ink with its light palette
      const base = {
        spaceId: siteSpaceId,
        enabled: true,
        host: HOST,
        title: 'Mansoor',
        footer: '(c) 2026',
      }
      await publishing.updateSpacePublishing(user, {
        ...base,
        theme: 'ink',
        appearance: 'light',
      })
      home = await get('/')
      expect(home.body).toContain('--bg:#f7f8fb')
      expect(styleOf(home.body)).not.toContain('prefers-color-scheme')
      // and the page tells its scripts which look was pinned
      expect(home.body).toContain('data-appearance="light"')

      // bloom on auto: bright white light palette + a dark variant for dark-OS visitors
      await publishing.updateSpacePublishing(user, {
        ...base,
        theme: 'bloom',
        appearance: 'auto',
      })
      home = await get('/')
      expect(home.body).toContain('--bg:#ffffff')
      expect(home.body).toContain('--accent:#c2318c')
      expect(styleOf(home.body)).toContain('prefers-color-scheme')

      // restore for any later assertions
      await publishing.updateSpacePublishing(user, { ...base, theme: 'ink', appearance: 'auto' })
    })

    it('categories label posts, filter the index, and survive without a republish', async () => {
      const essay = await makePage(siteSpaceId, blogId, 'Slow software', 'It waits for you')
      const build = await makePage(siteSpaceId, blogId, 'Wiring the box', 'Solder and swearing')
      await publishing.publish(user, essay.id)
      await publishing.publish(user, build.id)
      await pagesSvc.updatePageOptions(user, { pageId: essay.id, category: 'Essays' })
      // categorised AFTER publishing: the category is live presentation, so it
      // must show without touching the frozen snapshot
      await pagesSvc.updatePageOptions(user, { pageId: build.id, category: 'Workshop' })

      const blog = await get('/blog')
      expect(blog.body).toContain('class="cfilter"')
      expect(blog.body).toContain('href="/blog?category=essays"')
      expect(blog.body).toContain('href="/blog?category=workshop"')
      expect(blog.body).toContain('Slow software')
      expect(blog.body).toContain('Wiring the box')

      // filtering keeps one and drops the other
      const filtered = await get('/blog?category=essays')
      expect(filtered.statusCode).toBe(200)
      expect(filtered.body).toContain('Slow software')
      expect(filtered.body).not.toContain('Wiring the box')
      // the chip in force is marked, and All still leads back out
      expect(filtered.body).toContain('<a class="on" href="/blog?category=essays">')
      expect(filtered.body).toContain('>All</a>')

      // an unknown category is not a 404 and not an empty page — it is ignored
      const bogus = await get('/blog?category=does-not-exist')
      expect(bogus.statusCode).toBe(200)
      expect(bogus.body).toContain('Slow software')
      expect(bogus.body).toContain('Wiring the box')

      // the post carries its category, linked back to its siblings
      const post = await get('/blog/slow-software')
      expect(post.body).toContain('href="/blog?category=essays"')
      expect(post.body).toContain('>Essays</a>')
    })

    it('a blog page can show its posts as a grid of cards', async () => {
      const list = await get('/blog')
      expect(list.body).toContain('<div class="postlist">')

      await pagesSvc.updatePageOptions(user, { pageId: blogId, blogLayout: 'grid' })
      // no republish: the post list is composed when a reader asks for it
      const grid = await get('/blog')
      expect(grid.body).toContain('<div class="postgrid">')
      expect(grid.body).not.toContain('<div class="postlist">')
      expect(grid.body).toContain('class="ptitle"')
      // covers still come from the published snapshot
      expect(grid.body).toContain('/api/files/coverpick111111111111/thumb')

      await pagesSvc.updatePageOptions(user, { pageId: blogId, blogLayout: 'list' })
    })

    it('maintenance mode serves a 503 holding page and hides the content', async () => {
      const base = {
        spaceId: siteSpaceId,
        enabled: true,
        host: HOST,
        title: 'Mansoor',
        footer: '(c) 2026',
        theme: 'ink' as const,
      }
      // sanity: the content is live before we start
      expect((await get('/')).body).toContain('Welcome to my corner of the web')

      await publishing.updateSpacePublishing(user, {
        ...base,
        maintenance: true,
        social: [{ platform: 'github', url: 'https://github.com/mansoor' }],
      })

      const home = await get('/')
      expect(home.statusCode).toBe(503)
      expect(home.headers['retry-after']).toBe('3600')
      expect(home.body).toContain('Back soon')
      // the configured social links still show under the name
      expect(home.body).toContain('<div class="socials">')
      expect(home.body).toContain('href="https://github.com/mansoor"')
      // none of the real content leaks while it is closed — not the page, not the nav
      expect(home.body).not.toContain('Welcome to my corner of the web')
      expect(home.body).not.toContain('>Blog<')
      // it still looks like the site (its theme), and asks crawlers to stay away
      expect(home.body).toContain('--bg:#15161a')
      expect(home.body).toContain('name="robots" content="noindex"')

      // every path answers the holding page, not just the root
      const deep = await get('/blog')
      expect(deep.statusCode).toBe(503)
      expect(deep.body).toContain('Back soon')

      // turning it off restores the site exactly
      await publishing.updateSpacePublishing(user, { ...base, maintenance: false })
      const back = await get('/')
      expect(back.statusCode).toBe(200)
      expect(back.body).toContain('Welcome to my corner of the web')
    })

    it('draft preview shows the working copy to the owner; the live site does not', async () => {
      // a brand-new page, edited but never published
      await makePage(siteSpaceId, null, 'Sandbox', 'SANDBOX DRAFT BODY')

      const getDraft = (path = '', authed = true) =>
        server.inject({
          method: 'GET',
          url: `/s/draft/${siteSpaceId}${path}`,
          headers: {
            host: 'app.example.test',
            ...(authed ? { cookie: `bn_session=${sessionToken}` } : {}),
          },
        })

      // the live site has never heard of it — publishing is still the only way out
      const live = await get('/')
      expect(live.body).not.toContain('SANDBOX DRAFT BODY')
      expect(live.body).not.toContain('Sandbox')

      // the owner's draft preview renders the current working copy, in the site
      // chrome, with a banner and noindex, and lists the unpublished page in nav
      const draft = await getDraft('/sandbox')
      expect(draft.statusCode).toBe(200)
      expect(draft.body).toContain('SANDBOX DRAFT BODY')
      expect(draft.body).toContain('Draft preview')
      expect(draft.body).toContain('content="noindex"')
      expect(draft.body).toContain('Sandbox')
      // the pages published in beforeAll are part of the same draft nav
      expect(draft.body).toContain('Home')
      // the banner is a bar above the header, not buried in the page content
      expect(draft.body.indexOf('Draft preview')).toBeLessThan(draft.body.indexOf('<header'))
      // and the real site header renders (the draft uses the site chrome)
      expect(draft.body).toContain('<header')

      // the root lands on the first page rather than dead-ending
      expect((await getDraft('')).statusCode).toBe(200)

      // a signed-out visitor is bounced to the app, never shown the draft
      const anon = await getDraft('/sandbox', false)
      expect(anon.statusCode).toBe(302)
      expect(anon.body).not.toContain('SANDBOX DRAFT BODY')
    })
  })
}
