import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import type { BlobStore } from './blobstore'
import { PagesError } from './pages'
import type { AttachmentRow, Repo, UserRow } from './repo'

const MAX_EDGE = 2560 // sharing copies, not primary photo storage (settled decision)
const THUMB_EDGE = 480
const WEBP_QUALITY = 82
const PROCESSED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export function thumbKey(hash: string): string {
  return `${hash}.t`
}

export function createAttachmentsService(
  repo: Repo,
  blobs: BlobStore,
  opts: { now?: () => Date } = {},
) {
  const now = opts.now ?? (() => new Date())

  return {
    /**
     * Ingest an upload. Images are re-encoded (max edge capped, EXIF/GPS
     * stripped, orientation applied first) and get a thumbnail; other files
     * are stored as-is. Blobs are content-addressed, so re-uploading the
     * same bytes costs nothing.
     */
    async upload(
      user: UserRow,
      input: { filename: string; mime: string; data: Buffer },
    ): Promise<AttachmentRow> {
      let data = input.data
      let mime = input.mime
      let width: number | null = null
      let height: number | null = null
      let thumb: Buffer | null = null

      if (PROCESSED_MIMES.has(input.mime)) {
        // .rotate() applies EXIF orientation; re-encoding drops all metadata
        // (including GPS) unless .withMetadata() is called — which it is not.
        const image = sharp(input.data).rotate()
        data = await image
          .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer()
        const meta = await sharp(data).metadata()
        width = meta.width ?? null
        height = meta.height ?? null
        mime = 'image/webp'
        thumb = await sharp(data)
          .resize({
            width: THUMB_EDGE,
            height: THUMB_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 78 })
          .toBuffer()
      }

      const hash = createHash('sha256').update(data).digest('hex')
      await blobs.put(hash, data)
      if (thumb) await blobs.put(thumbKey(hash), thumb)

      const attachment: AttachmentRow = {
        id: nanoid(),
        hash,
        filename: input.filename.slice(0, 200) || 'file',
        mime,
        size: data.length,
        width,
        height,
        createdBy: user.id,
        createdAt: now(),
      }
      await repo.insertAttachment(attachment)
      return attachment
    },

    async get(id: string): Promise<AttachmentRow | null> {
      return repo.getAttachment(id)
    },

    // ---- galleries ----

    async listGallery(pageId: string) {
      const items = await repo.listGalleryItems(pageId)
      return items.sort((a, b) => a.position - b.position)
    },

    async addToGallery(pageId: string, attachmentId: string) {
      const attachment = await repo.getAttachment(attachmentId)
      if (!attachment || !attachment.mime.startsWith('image/')) {
        throw new PagesError('BAD_CONTENT', 'Galleries hold images only.')
      }
      const items = await repo.listGalleryItems(pageId)
      const item = {
        id: nanoid(),
        pageId,
        attachmentId,
        position: items.length,
        caption: '',
      }
      await repo.insertGalleryItem(item)
      return item
    },

    async setCaption(itemId: string, caption: string) {
      await repo.updateGalleryItemCaption(itemId, caption.slice(0, 300))
    },

    async removeFromGallery(itemId: string) {
      await repo.deleteGalleryItem(itemId)
    },
  }
}

export type AttachmentsService = ReturnType<typeof createAttachmentsService>

/** Attachment ids referenced by a document (image blocks pointing at /api/files/<id>). */
export function extractAttachmentIds(content: string): string[] {
  const ids = new Set<string>()
  const re = /\/api\/files\/([A-Za-z0-9_-]{10,});?/g
  for (const match of content.matchAll(re)) {
    const id = match[1]
    if (id) ids.add(id)
  }
  return [...ids]
}
