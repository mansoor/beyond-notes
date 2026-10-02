import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { createAttachmentsService } from './attachments'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import type { ServerEdition, SiteGate } from './edition'
import type { createPagesService } from './pages'
import type { createPublishingService } from './publishing'
import type { createRepo } from './repo'
import { buildServer } from './server'

// An edition's gate in front of one site; a second site stays open. The fake
// gate lets a request through when it carries `cookie: gate=open`.
describe('site gate (edition hook for protected sites)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bn-gate-'))
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>>
  let attachmentId: string
  let gatedId: string
  const GATED = 'private.example.test'
  const OPEN = 'open.example.test'
  const checks: string[] = []

  const opened = (req: { headers: Record<string, unknown> }) =>
    String(req.headers.cookie ?? '').includes('gate=open')

  beforeAll(async () => {
    const gate: SiteGate = {
      isGated: (spaceId) => spaceId === gatedId,
      async check(space, req, reply, ctx) {
        checks.push(`${space.id}:${ctx.path}`)
        if (opened(req)) return false
        reply.code(401).type('text/html; charset=utf-8').send('<p>LOCKED</p>')
        return true
      },
      allowsFiles: (_spaceId, req) => opened(req),
    }
    const edition: ServerEdition = {
      name: 'test',
      register() {},
      info: () => ({ name: 'test', label: 'Test', features: [], status: null, attention: false }),
      siteGate: gate,
    }
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.example.test',
        DATABASE_URL: 'unused',
        UPLOADS_DIR: dir,
      } as any),
      appDb,
      { edition },
    )
    const services = (server as any).bnServices
    const repo = services.repo as ReturnType<typeof createRepo>
    const pages = services.pages as ReturnType<typeof createPagesService>
    const publishing = services.publishing as ReturnType<typeof createPublishingService>
    const files = services.attachments as ReturnType<typeof createAttachmentsService>
    const { user } = await createAuthService(repo).setup({
      name: 'M',
      email: 'm@x.dev',
      password: 'longpassword1',
    })
    const img = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer()
    attachmentId = (await files.upload(user, { filename: 'p.png', mime: 'image/png', data: img }))
      .id

    const site = async (name: string, host: string) => {
      const space = await pages.createSpace(user, { name, category: 'site', personal: false })
      const page = await pages.createPage(user, {
        spaceId: space.id,
        parentId: null,
        title: 'Home',
      })
      await publishing.updateSpacePublishing(user, {
        spaceId: space.id,
        enabled: true,
        host,
        title: name,
        footer: '',
        theme: 'paper',
      })
      return { space, page }
    }
    const gated = await site('Family', GATED)
    gatedId = gated.space.id
    await pages.setPageType(user, gated.page.id, 'gallery')
    await files.addToGallery(gated.page.id, attachmentId)
    await publishing.publish(user, gated.page.id)
    const open = await site('Public', OPEN)
    await publishing.publish(user, open.page.id)
  }, 30000)

  afterAll(async () => {
    await server.close()
    await appDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (url: string, host: string, cookie?: string) =>
    server.inject({ method: 'GET', url, headers: { host, ...(cookie ? { cookie } : {}) } })

  it('sends every path of a protected site through the gate', async () => {
    for (const path of ['/', '/home', '/rss.xml', '/sitemap.xml', '/search?q=x', '/nope']) {
      const res = await get(path, GATED)
      expect(res.statusCode, path).toBe(401)
      expect(res.body).toBe('<p>LOCKED</p>')
    }
    expect(checks).toContain(`${gatedId}:/rss.xml`)
    // the dev path reaches the same gate
    expect((await server.inject({ method: 'GET', url: `/s/${GATED}/` })).statusCode).toBe(401)
  })

  it('tells crawlers to stay out without asking the gate', async () => {
    const res = await get('/robots.txt', GATED)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Disallow: /')
  })

  it('serves a let-through visitor privately and unindexed', async () => {
    const res = await get('/', GATED, 'gate=open')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-robots-tag']).toContain('noindex')
  })

  it("holds back a protected site's files until the gate allows them", async () => {
    expect((await get(`/api/files/${attachmentId}`, GATED)).statusCode).toBe(404)
    expect((await get(`/api/files/${attachmentId}/thumb`, GATED)).statusCode).toBe(404)
    expect((await get(`/api/files/${attachmentId}`, GATED, 'gate=open')).statusCode).toBe(200)
  })

  it('leaves open sites alone', async () => {
    const before = checks.length
    const res = await get('/', OPEN)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBeUndefined()
    expect(checks.length).toBe(before)
  })
})
