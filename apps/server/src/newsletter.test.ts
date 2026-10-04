import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import type { EditionDeps, ServerEdition } from './edition'
import type { createPagesService } from './pages'
import { htmlForEmail } from './public'
import type { PublishedEvent, createPublishingService } from './publishing'
import {
  type NewsletterIssueRow,
  type NewsletterSubscriberRow,
  type Repo,
  type SpaceRow,
  type UserRow,
  createRepo,
} from './repo'
import { buildServer } from './server'

const para = (text: string) => ({
  id: `b${text.length}`,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
})

// The core's part of a site newsletter: the stored list, an unsubscribe link
// that always works, and the hooks an edition builds the rest on.
describe('newsletter plumbing (core)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bn-news-'))
  const HOST = 'blog.example.test'
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>>
  let deps: EditionDeps
  let repo: Repo
  let pages: ReturnType<typeof createPagesService>
  let publishing: ReturnType<typeof createPublishingService>
  let user: UserRow
  let space: SpaceRow
  let postId: string
  const events: PublishedEvent[] = []
  const routed: string[] = []

  const edition: ServerEdition = {
    name: 'test',
    register(_app, d) {
      deps = d
      d.sites.onPublished((e) => {
        events.push(e)
      })
    },
    info: () => ({ name: 'test', label: 'Test', features: [], status: null, attention: false }),
    async siteRoutes(_space, _req, reply, ctx) {
      routed.push(ctx.path)
      if (ctx.path !== '/_bn/hello') return false
      reply.type('text/plain').send(`hello ${String(ctx.query.who ?? '')} at ${ctx.basePath}`)
      return true
    },
    siteHtml: (_space, slot, ctx) =>
      `<aside data-slot="${slot}" data-page="${ctx.pageId}"></aside>`,
  }

  const subscriber = async (
    email: string,
    status: NewsletterSubscriberRow['status'] = 'active',
  ): Promise<NewsletterSubscriberRow> => {
    const row: NewsletterSubscriberRow = {
      id: `s-${email}`,
      spaceId: space.id,
      email,
      status,
      token: `tok-${email.replace(/\W/g, '')}-0123456789`,
      source: 'manual',
      createdAt: new Date(),
      confirmedAt: status === 'active' ? new Date() : null,
      unsubscribedAt: null,
    }
    await repo.insertSubscriber(row)
    return row
  }

  beforeAll(async () => {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.example.test',
        UPLOADS_DIR: dir,
      }),
      appDb,
      { edition },
    )
    const services = (server as any).bnServices
    repo = services.repo
    pages = services.pages
    publishing = services.publishing
    ;({ user } = await createAuthService(repo).setup({
      name: 'M',
      email: 'm@x.dev',
      password: 'longpassword1',
    }))
    space = await pages.createSpace(user, { name: 'Notes', category: 'site', personal: false })
    const blog = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'Blog' })
    await pages.setPageType(user, blog.id, 'blog')
    const post = await pages.createPage(user, {
      spaceId: space.id,
      parentId: blog.id,
      title: 'Spring',
    })
    postId = post.id
    const { doc } = await pages.getPage(user, post.id)
    await pages.saveDocument(user, {
      pageId: post.id,
      content: JSON.stringify([para('The garden is waking up.')]),
      baseUpdatedAt: doc.updatedAt.toISOString(),
    })
    await publishing.updateSpacePublishing(user, {
      spaceId: space.id,
      enabled: true,
      host: HOST,
      title: 'Garden Notes',
      footer: '',
      theme: 'paper',
    })
    await publishing.publish(user, blog.id)
    await publishing.publish(user, post.id)
  }, 30000)

  afterAll(async () => {
    await server.close()
    await appDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (url: string, host = HOST) => server.inject({ method: 'GET', url, headers: { host } })

  it('tells the edition when pages go live, and whether for the first time', async () => {
    expect(events.map((e) => [e.page.title, e.firstTime])).toEqual([
      ['Blog', true],
      ['Spring', true],
    ])
    await publishing.publish(user, postId)
    expect(events.at(-1)?.firstTime).toBe(false)
    expect(events.at(-1)?.space.id).toBe(space.id)
  })

  it("puts the edition's markup on blog and post pages", async () => {
    const blog = await get('/blog')
    expect(blog.body).toContain('data-slot="blog"')
    const post = await get('/blog/spring')
    expect(post.body).toContain(`data-slot="post" data-page="${postId}"`)
  })

  it('offers /_bn/ paths to the edition first, on both ways to reach a site', async () => {
    const res = await get('/_bn/hello?who=ana')
    expect(res.body).toBe('hello ana at ')
    const dev = await get(`/s/${HOST}/_bn/hello?who=bo`, 'app.example.test')
    expect(dev.body).toBe(`hello bo at /s/${HOST}`)
    // what it doesn't answer is the site's 404
    expect((await get('/_bn/other')).statusCode).toBe(404)
    expect(routed).toContain('/_bn/other')
  })

  it('unsubscribes with a button, then says so', async () => {
    const sub = await subscriber('ana@example.com')
    const page = await get(`/_bn/unsubscribe?t=${sub.token}`)
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('Unsubscribe?')
    // the address is masked: a forwarded email shouldn't hand it out
    expect(page.body).toContain('a•••@example.com')
    expect(page.body).not.toContain('ana@example.com')
    // opening the link alone changes nothing (mail scanners open links)
    expect((await repo.getSubscriber(sub.id))?.status).toBe('active')

    const done = await server.inject({
      method: 'POST',
      url: `/_bn/unsubscribe?t=${sub.token}`,
      headers: { host: HOST },
    })
    expect(done.statusCode).toBe(200)
    expect(done.body).toContain("won't get any more emails from Garden Notes")
    const after = await repo.getSubscriber(sub.id)
    expect(after?.status).toBe('unsubscribed')
    expect(after?.unsubscribedAt).toBeInstanceOf(Date)
  })

  it('takes a mail app one-click unsubscribe (RFC 8058)', async () => {
    const sub = await subscriber('bo@example.com')
    const res = await server.inject({
      method: 'POST',
      url: `/s/${HOST}/_bn/unsubscribe?t=${sub.token}`,
      headers: {
        host: 'app.example.test',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'List-Unsubscribe=One-Click',
    })
    expect(res.statusCode).toBe(200)
    expect((await repo.getSubscriber(sub.id))?.status).toBe('unsubscribed')
  })

  it('works on a site that is closed or offline, and only for its own list', async () => {
    const sub = await subscriber('cy@example.com')
    await repo.updateSpacePublishing(space.id, { publicMaintenance: true })
    expect((await get(`/_bn/unsubscribe?t=${sub.token}`)).body).toContain('Unsubscribe?')
    await repo.updateSpacePublishing(space.id, { publicMaintenance: false, publicEnabled: false })
    expect((await get(`/_bn/unsubscribe?t=${sub.token}`)).body).toContain('Unsubscribe?')
    await repo.updateSpacePublishing(space.id, { publicEnabled: true })

    // a token from another site's list is just an expired link here
    const other = await pages.createSpace(user, {
      name: 'Other',
      category: 'site',
      personal: false,
    })
    await publishing.updateSpacePublishing(user, {
      spaceId: other.id,
      enabled: true,
      host: 'other.example.test',
      title: 'Other',
      footer: '',
      theme: 'paper',
    })
    const res = await server.inject({
      method: 'POST',
      url: `/_bn/unsubscribe?t=${sub.token}`,
      headers: { host: 'other.example.test' },
    })
    expect(res.body).toContain('This link has expired')
    expect((await repo.getSubscriber(sub.id))?.status).toBe('active')
    expect((await get('/_bn/unsubscribe?t=nonsense')).body).toContain('This link has expired')
  })

  it('turns a live post into an email with absolute links', async () => {
    space = (await repo.getSpace(space.id)) as SpaceRow
    const mail = await deps.sites.emailFor(space, postId)
    expect(mail?.title).toBe('Spring')
    expect(mail?.html).toContain('The garden is waking up.')
    expect(mail?.text).toContain('The garden is waking up.')
    expect(mail?.url).toBe(`http://${HOST}/blog/spring`)
    expect(deps.sites.urls(space)).toEqual({
      site: `http://${HOST}`,
      origin: `http://${HOST}`,
    })
    // a page that isn't live has no email
    const draft = await pages.createPage(user, {
      spaceId: space.id,
      parentId: null,
      title: 'Draft',
    })
    expect(await deps.sites.emailFor(space, draft.id)).toBeNull()
  })

  it('makes links absolute and drops what only works on the page', () => {
    const out = htmlForEmail(
      [
        '<p><a href="/about">About</a> <a href="https://x.dev/">x</a> <a href="//cdn.dev/a">c</a></p>',
        '<img src="/api/files/abc">',
        '<p>[[form:tbl_123]]</p>',
        '<script>alert(1)</script><style>p{}</style>',
      ].join(''),
      { site: 'https://dev.local/s/blog', origin: 'https://dev.local' },
      'https://dev.local/s/blog/post',
    )
    expect(out).toContain('href="https://dev.local/s/blog/about"')
    expect(out).toContain('href="https://x.dev/"')
    expect(out).toContain('href="//cdn.dev/a"')
    expect(out).toContain('src="https://dev.local/api/files/abc"')
    expect(out).toContain('href="https://dev.local/s/blog/post"')
    expect(out).not.toContain('[[form')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<style')
  })

  it('lists, counts and pages through subscribers', async () => {
    await subscriber('dee@example.com', 'pending')
    const counts = await repo.countSubscribers(space.id)
    expect(counts.pending).toBe(1)
    expect(counts.unsubscribed).toBe(2)
    const active = await repo.listSubscribers(space.id, { status: 'active' })
    expect(active.map((s) => s.email)).toEqual(['cy@example.com'])
    const all = await repo.listSubscribers(space.id)
    const second = await repo.listSubscribers(space.id, { after: all[0]?.id, limit: 1 })
    expect(second[0]?.id).toBe(all[1]?.id)
    expect(await repo.deletePendingSubscribersBefore(new Date(Date.now() + 1000))).toBe(1)
  })
})

// The repo's newsletter queries on every dialect (Postgres when TEST_PG_URL is set).
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
  describe(`newsletter tables (${dialect.name})`, () => {
    it('stores subscribers and issues, and finds what is due', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const { user } = await createAuthService(repo).setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      const space = {
        id: 'sp1',
        name: 'Site',
        kind: 'tree',
        category: 'site',
        ownerId: null,
        createdAt: new Date(),
      }
      await repo.insertSpace(space as never)
      const t0 = new Date('2026-10-01T10:00:00Z')
      const sub = (n: number, status: NewsletterSubscriberRow['status']) =>
        repo.insertSubscriber({
          id: `s${n}`,
          spaceId: 'sp1',
          email: `p${n}@x.dev`,
          status,
          token: `token-${n}-abcdefghijklmnop`,
          source: 'form',
          createdAt: new Date(t0.getTime() + n * 1000),
          confirmedAt: null,
          unsubscribedAt: null,
        })
      await sub(1, 'active')
      await sub(2, 'active')
      await sub(3, 'pending')
      await sub(4, 'unsubscribed')
      expect(await repo.countSubscribers('sp1')).toEqual({ active: 2, pending: 1, unsubscribed: 1 })
      expect((await repo.getSubscriberByToken('token-3-abcdefghijklmnop'))?.email).toBe('p3@x.dev')
      expect((await repo.getSubscriberByEmail('sp1', 'p2@x.dev'))?.id).toBe('s2')
      const page1 = await repo.listSubscribers('sp1', { status: 'active', limit: 1 })
      const page2 = await repo.listSubscribers('sp1', {
        status: 'active',
        after: page1[0]?.id,
        limit: 1,
      })
      expect([page1[0]?.id, page2[0]?.id]).toEqual(['s1', 's2'])
      // one address once per site
      await expect(sub(1, 'active')).rejects.toThrow()

      const issue = (id: string, status: NewsletterIssueRow['status'], at: Date) =>
        repo.insertIssue({
          id,
          spaceId: 'sp1',
          pageId: null,
          subject: id,
          status,
          sendAfter: at,
          cursor: null,
          recipients: 0,
          sent: 0,
          failed: 0,
          error: null,
          createdBy: user.id,
          createdAt: at,
          finishedAt: null,
        })
      await issue('due', 'queued', t0)
      await issue('later', 'queued', new Date(t0.getTime() + 3600_000))
      await issue('midway', 'sending', new Date(t0.getTime() + 7200_000))
      await issue('done', 'sent', t0)
      const due = await repo.listDueIssues(new Date(t0.getTime() + 60_000))
      expect(due.map((i) => i.id).sort()).toEqual(['due', 'midway'])
      await repo.updateIssue('due', { status: 'sent', sent: 2, cursor: 's2', finishedAt: t0 })
      expect(await repo.getIssue('due')).toMatchObject({ status: 'sent', sent: 2, cursor: 's2' })
      expect((await repo.listIssues('sp1')).map((i) => i.id)).toContain('later')

      expect(await repo.deletePendingSubscribersBefore(new Date(t0.getTime() + 3500))).toBe(1)
      await repo.deleteSpace('sp1')
      expect(await repo.listAllSubscribers()).toEqual([])
      expect(await repo.listAllIssues()).toEqual([])
      await appDb.close()
    })
  })
}
