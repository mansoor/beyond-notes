import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import type { ServerEdition } from './edition'
import { createPagesService } from './pages'
import type { createPublishingService } from './publishing'
import { type Repo, createRepo } from './repo'
import { buildServer } from './server'
import { createVisitRecorder, referrerHost } from './visits'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15'

describe('visit recorder', () => {
  let appDb: AppDb
  afterEach(async () => {
    await appDb?.close()
  })

  async function setup(clock: { now: Date }) {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const repo = createRepo(appDb)
    const { user } = await createAuthService(repo).setup({
      name: 'M',
      email: 'm@x.dev',
      password: 'longpassword1',
    })
    const space = await createPagesService(repo).createSpace(user, {
      name: 'Site',
      category: 'site',
      personal: false,
    })
    const rec = createVisitRecorder({ repo, now: () => clock.now })
    return { repo, rec, spaceId: space.id }
  }

  const rows = async (repo: Repo, spaceId: string) =>
    (await repo.listSiteVisits(spaceId, '2000-01-01')).sort((a, b) =>
      `${a.day}${a.path}`.localeCompare(`${b.day}${b.path}`),
    )

  it('counts views, a visitor once a day, and never a bot', async () => {
    const clock = { now: new Date('2026-10-03T10:00:00Z') }
    const { repo, rec, spaceId } = await setup(clock)

    const visit = (
      path: string,
      ip: string,
      extra: Partial<Parameters<typeof rec.record>[0]> = {},
    ) =>
      rec.record({
        spaceId,
        path,
        ip,
        userAgent: UA,
        referer: null,
        siteHost: 'blog.example.org',
        ...extra,
      })

    expect(visit('/', '10.0.0.1')).toBe(true)
    visit('/', '10.0.0.1')
    visit('/about', '10.0.0.1', { referer: 'https://news.ycombinator.com/item?id=1' })
    visit('/', '10.0.0.2', { referer: 'https://blog.example.org/' }) // internal: not a referrer
    expect(
      visit('/', '10.0.0.3', { userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }),
    ).toBe(false)
    expect(visit('/', '10.0.0.3', { userAgent: '' })).toBe(false)
    await rec.flush()

    expect(await rows(repo, spaceId)).toEqual([
      { spaceId, day: '2026-10-03', path: '', views: 4, visitors: 2 },
      { spaceId, day: '2026-10-03', path: '/', views: 3, visitors: 2 },
      { spaceId, day: '2026-10-03', path: '/about', views: 1, visitors: 1 },
    ])
    expect(await repo.listSiteReferrers(spaceId, '2000-01-01')).toEqual([
      { spaceId, day: '2026-10-03', host: 'news.ycombinator.com', views: 1 },
    ])

    // the same person tomorrow is a new visitor: nothing links the two days
    clock.now = new Date('2026-10-04T09:00:00Z')
    visit('/', '10.0.0.1')
    await rec.flush()
    // and a second flush adds to the day rather than replacing it
    visit('/', '10.0.0.9')
    await rec.flush()
    const tomorrow = (await rows(repo, spaceId)).filter((r) => r.day === '2026-10-04')
    expect(tomorrow.find((r) => r.path === '')).toMatchObject({ views: 2, visitors: 2 })

    clock.now = new Date('2027-12-01T00:00:00Z')
    await rec.prune(400)
    expect(await rows(repo, spaceId)).toEqual([])
  })

  it('reads referrer hosts, ignoring the site itself and odd schemes', () => {
    expect(referrerHost('https://www.Reddit.com/r/selfhosted', 'blog.example.org')).toBe(
      'reddit.com',
    )
    expect(referrerHost('https://www.blog.example.org/x', 'blog.example.org:443')).toBeNull()
    expect(referrerHost('android-app://com.google.android.gm', 'blog.example.org')).toBeNull()
    expect(referrerHost('not a url', 'blog.example.org')).toBeNull()
    expect(referrerHost(null, 'x')).toBeNull()
  })
})

describe('counting while serving', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null
  afterEach(async () => {
    await server?.close()
    server = null
    await appDb?.close()
  })

  async function boot(countThis: boolean) {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const edition: ServerEdition = {
      name: 'test',
      register() {},
      info: () => ({ name: 'test', label: 'Test', features: [], status: null, attention: false }),
      countVisits: () => countThis,
    }
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.example.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-visits-')),
      }),
      appDb,
      { edition },
    )
    const services = (server as any).bnServices
    const pages = services.pages as ReturnType<typeof createPagesService>
    const publishing = services.publishing as ReturnType<typeof createPublishingService>
    const repo = services.repo as Repo
    const { user } = await createAuthService(repo).setup({
      name: 'M',
      email: 'm@x.dev',
      password: 'longpassword1',
    })
    const space = await pages.createSpace(user, { name: 'Blog', category: 'site', personal: false })
    const home = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'Home' })
    await publishing.updateSpacePublishing(user, {
      spaceId: space.id,
      enabled: true,
      host: 'blog.example.org',
      title: 'Blog',
      footer: '',
      theme: 'paper',
    })
    await publishing.publish(user, home.id)
    return { repo, space, flush: () => services.visits.flush() as Promise<void> }
  }

  const get = (url: string, ua = UA) =>
    server?.inject({ method: 'GET', url, headers: { host: 'blog.example.org', 'user-agent': ua } })

  it('counts pages that went out, and nothing else', async () => {
    const { repo, space, flush } = await boot(true)
    expect((await get('/'))?.statusCode).toBe(200)
    await get('/')
    expect((await get('/no-such-page'))?.statusCode).toBe(404)
    await get('/robots.txt')
    await get('/rss.xml')
    await get('/', 'Mozilla/5.0 (compatible; bingbot/2.0)')
    await flush()
    const site = (await repo.listSiteVisits(space.id, '2000-01-01')).find((r) => r.path === '')
    expect(site).toMatchObject({ views: 2, visitors: 1 })
  })

  it("counts nothing for a site the edition doesn't count", async () => {
    const { repo, space, flush } = await boot(false)
    await get('/')
    await flush()
    expect(await repo.listSiteVisits(space.id, '2000-01-01')).toEqual([])
  })
})
