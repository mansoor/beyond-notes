/**
 * Bringing a README's images along with its words.
 *
 * A GitHub README's images are relative paths (`docs/screenshot.png`) or
 * absolute links to raw.githubusercontent. Left alone, the first kind resolves
 * against *your* site and 404s, and the second hotlinks GitHub forever — which
 * breaks when a repo moves and makes a self-hosted page phone out on every
 * view. So the importer fetches each one and stores it as a normal attachment:
 * re-encoded, EXIF stripped, served from this instance like any other upload.
 *
 * Opt-in, because it is the one part of an import that reaches the network per
 * file and can take a while.
 */

import type { AttachmentsService } from './attachments'
import type { UserRow } from './repo'

/** Markdown image syntax: ![alt](url) — the same shape markdownToBlocks reads. */
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

const MAX_BYTES = 10 * 1024 * 1024
const MAX_IMAGES = 100
const TIMEOUT_MS = 20_000

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/i

export type ImageSource = {
  /** raw.githubusercontent base for the repo+ref, e.g. https://raw.../owner/repo/main */
  rawBase: string | null
}

/** Every distinct image URL a set of markdown documents refers to. */
export function collectImageUrls(markdowns: string[]): string[] {
  const found = new Set<string>()
  for (const md of markdowns) {
    for (const m of md.matchAll(IMAGE_RE)) {
      const url = m[2]
      if (url) found.add(url)
    }
  }
  return [...found]
}

/**
 * Turn a README-relative reference into something fetchable.
 *
 * GitHub's own `?raw=true` and `/blob/` links serve HTML, not bytes, so they
 * are rewritten to the raw host too — otherwise the import would cheerfully
 * store an HTML page as a .png.
 */
export function resolveImageUrl(url: string, source: ImageSource): string | null {
  const trimmed = url.trim()
  if (trimmed === '' || trimmed.startsWith('data:')) return null

  if (/^https?:\/\//i.test(trimmed)) {
    const asBlob = trimmed.match(
      /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/i,
    )
    if (asBlob) {
      return `https://raw.githubusercontent.com/${asBlob[1]}/${asBlob[2]}/${asBlob[3]}/${(asBlob[4] ?? '').split('?')[0]}`
    }
    return trimmed
  }

  if (!source.rawBase) return null
  const clean = trimmed.replace(/^\.\//, '').replace(/^\//, '').split(/[?#]/)[0]
  return clean ? `${source.rawBase}/${clean}` : null
}

function filenameFor(url: string): string {
  const last = url.split(/[?#]/)[0]?.split('/').pop() ?? 'image'
  return last.length > 0 && last.length < 120 ? last : 'image'
}

export type ImportImageResult = {
  /** original markdown url -> the /api/files/… path it became */
  rewrites: Map<string, string>
  warnings: string[]
}

/**
 * Fetch and store every image the markdown refers to. Failures are collected,
 * never thrown: one dead image must not lose the whole import, and the link is
 * left pointing where it was so nothing silently disappears.
 */
export async function importImages(
  deps: { attachments: AttachmentsService; fetcher?: typeof fetch },
  user: UserRow,
  markdowns: string[],
  source: ImageSource,
): Promise<ImportImageResult> {
  const fetcher = deps.fetcher ?? fetch
  const rewrites = new Map<string, string>()
  const warnings: string[] = []

  const urls = collectImageUrls(markdowns)
  const capped = urls.slice(0, MAX_IMAGES)
  if (urls.length > capped.length) {
    warnings.push(`Only the first ${MAX_IMAGES} images were fetched (${urls.length} referenced).`)
  }

  for (const original of capped) {
    const target = resolveImageUrl(original, source)
    if (!target) continue

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const res = await fetcher(target, { signal: controller.signal, redirect: 'follow' })
      clearTimeout(timer)
      if (!res.ok) {
        warnings.push(`Left ${original} alone (fetching it answered ${res.status}).`)
        continue
      }
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
      if (!IMAGE_MIME.test(mime)) {
        warnings.push(`Left ${original} alone (it answered ${mime || 'no content type'}).`)
        continue
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.byteLength > MAX_BYTES) {
        warnings.push(`Left ${original} alone (larger than ${MAX_BYTES / 1024 / 1024} MB).`)
        continue
      }
      const attachment = await deps.attachments.upload(user, {
        filename: filenameFor(target),
        mime,
        data: buffer,
      })
      rewrites.set(original, `/api/files/${attachment.id}`)
    } catch (err) {
      warnings.push(`Left ${original} alone (${(err as Error).message}).`)
    }
  }

  return { rewrites, warnings }
}

/** Point the markdown at the stored copies. Untouched urls stay as they were. */
export function rewriteImageUrls(markdown: string, rewrites: Map<string, string>): string {
  if (rewrites.size === 0) return markdown
  return markdown.replace(IMAGE_RE, (whole, alt: string, url: string) => {
    const next = rewrites.get(url)
    return next ? `![${alt}](${next})` : whole
  })
}
