import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAttachmentsService, extractAttachmentIds } from './attachments'
import { createAuthService } from './auth'
import { createFsBlobStore } from './blobstore'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import type { createPagesService } from './pages'
import type { createPublishingService } from './publishing'
import { createRepo } from './repo'
import type { UserRow } from './repo'
import { buildServer } from './server'

// SQLite is sufficient here: the storage layer is dialect-independent and the
// SQL involved is already covered by the dual-dialect suites.

describe('attachments processing (fs blob store)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bn-blobs-'))
  const blobs = createFsBlobStore(dir)
  let appDb: AppDb
  let user: UserRow
  let service: ReturnType<typeof createAttachmentsService>
  let repo: ReturnType<typeof createRepo>

  beforeAll(async () => {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    repo = createRepo(appDb)
    const auth = createAuthService(repo)
    const res = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
    user = res.user
    service = createAttachmentsService(repo, blobs)
  })

  afterAll(async () => {
    await appDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('recompresses oversized images to webp, capped at 2560, with a thumbnail', async () => {
    const big = await sharp({
      create: { width: 4000, height: 2000, channels: 3, background: { r: 180, g: 90, b: 40 } },
    })
      .jpeg()
      .toBuffer()

    const attachment = await service.upload(user, {
      filename: 'photo.jpg',
      mime: 'image/jpeg',
      data: big,
    })
    expect(attachment.mime).toBe('image/webp')
    expect(attachment.width).toBe(2560)
    expect(attachment.height).toBe(1280)

    const stored = await blobs.read(attachment.hash)
    const meta = await sharp(stored).metadata()
    expect(meta.format).toBe('webp')
    // metadata (EXIF & friends) is gone after re-encode
    expect(meta.exif).toBeUndefined()

    const thumb = await blobs.read(`${attachment.hash}.t`)
    const thumbMeta = await sharp(thumb).metadata()
    expect(thumbMeta.width).toBeLessThanOrEqual(480)
  })

  it('deduplicates identical bytes via content addressing', async () => {
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer()
    const a = await service.upload(user, { filename: 'a.png', mime: 'image/png', data: img })
    const b = await service.upload(user, { filename: 'b.png', mime: 'image/png', data: img })
    expect(a.id).not.toBe(b.id) // two logical attachments
    expect(a.hash).toBe(b.hash) // one blob
  })

  it('stores non-images as-is', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake')
    const attachment = await service.upload(user, {
      filename: 'doc.pdf',
      mime: 'application/pdf',
      data: pdf,
    })
    expect(attachment.mime).toBe('application/pdf')
    expect((await blobs.read(attachment.hash)).equals(pdf)).toBe(true)
  })

  it('extractAttachmentIds finds file references in documents', () => {
    const content = JSON.stringify([
      {
        id: 'x',
        type: 'image',
        props: { url: '/api/files/abc123def456' },
        content: [],
        children: [],
      },
      { id: 'y', type: 'paragraph', content: [{ type: 'text', text: 'no refs', styles: {} }] },
    ])
    expect(extractAttachmentIds(content)).toEqual(['abc123def456'])
  })
})

describe('public file access follows the visibility rule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bn-blobs2-'))
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>>
  let user: UserRow
  let publishing: ReturnType<typeof createPublishingService>
  let pagesSvc: ReturnType<typeof createPagesService>
  let attachmentId: string
  let pageId: string
  const HOST = 'gallery.example.test'

  beforeAll(async () => {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const config = loadConfig({
      NODE_ENV: 'test',
      BASE_URL: 'http://app.example.test',
      DATABASE_URL: 'unused',
      UPLOADS_DIR: dir,
    } as any)
    server = await buildServer(config, appDb)
    // use the server's own service instances so publish-state caches are shared
    const services = (server as any).bnServices
    const repo = services.repo as ReturnType<typeof createRepo>
    const auth = createAuthService(repo)
    pagesSvc = services.pages
    publishing = services.publishing
    const res = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
    user = res.user

    const svc = services.attachments as ReturnType<typeof createAttachmentsService>
    const img = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer()
    const attachment = await svc.upload(user, { filename: 'p.png', mime: 'image/png', data: img })
    attachmentId = attachment.id

    const space = await pagesSvc.createSpace(user, {
      name: 'gallery site',
      category: 'site',
      personal: false,
    })
    const page = await pagesSvc.createPage(user, {
      spaceId: space.id,
      parentId: null,
      title: 'Photos',
    })
    pageId = page.id
    await pagesSvc.setPageType(user, page.id, 'gallery')
    await svc.addToGallery(page.id, attachmentId)
    await publishing.updateSpacePublishing(user, {
      spaceId: space.id,
      enabled: true,
      host: HOST,
      title: 'Photos',
      footer: '',
      theme: 'paper',
    })
  }, 30000)

  afterAll(async () => {
    await server.close()
    await appDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('unpublished: anonymous file access is 404; gallery page is 404', async () => {
    const file = await server.inject({ method: 'GET', url: `/api/files/${attachmentId}` })
    expect(file.statusCode).toBe(404)
    const page = await server.inject({ method: 'GET', url: '/photos', headers: { host: HOST } })
    expect(page.statusCode).toBe(404)
  })

  it('published: the gallery page renders the grid and its images become public', async () => {
    await publishing.publish(user, pageId)

    const page = await server.inject({ method: 'GET', url: '/photos', headers: { host: HOST } })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('class="gallery')
    expect(page.body).toContain(`/api/files/${attachmentId}/thumb`)

    const file = await server.inject({ method: 'GET', url: `/api/files/${attachmentId}` })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toContain('image/webp')
    const thumb = await server.inject({ method: 'GET', url: `/api/files/${attachmentId}/thumb` })
    expect(thumb.statusCode).toBe(200)
  })

  it('retire takes the images private again (cache window aside)', async () => {
    await publishing.retire(user, pageId)
    // the public-id cache holds for up to 15s; the service-level truth is immediate
    const ids = await publishing.publicAttachmentIds()
    expect(ids.has(attachmentId)).toBe(false)
  })
})
