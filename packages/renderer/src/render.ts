// Pure renderer: BlockNote block JSON -> HTML / plain text.
// Everything user-authored is escaped; hrefs are allow-listed. No raw HTML
// passes through — this is the publish pipeline's security posture, enforced
// here rather than at serve time.

import { highlightCode } from './highlight'
import { slugify } from './slug'

type Block = {
  id?: string
  type?: string
  props?: Record<string, unknown>
  content?: unknown
  children?: Block[]
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const trimmed = href.trim()
  if (/^(https?:\/\/|mailto:|\/)/i.test(trimmed)) return trimmed
  return null
}

function renderInline(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const item of content as any[]) {
    if (item?.type === 'link') {
      const href = safeHref(item.href)
      const inner = renderInline(item.content)
      out += href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner
      continue
    }
    if (typeof item?.text === 'string') {
      let text = escapeHtml(item.text)
      const styles = item.styles ?? {}
      if (styles.code) text = `<code>${text}</code>`
      if (styles.bold) text = `<strong>${text}</strong>`
      if (styles.italic) text = `<em>${text}</em>`
      if (styles.underline) text = `<u>${text}</u>`
      if (styles.strike) text = `<s>${text}</s>`
      out += text
    }
  }
  return out
}

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])

function listTag(type: string): 'ul' | 'ol' {
  return type === 'numberedListItem' ? 'ol' : 'ul'
}

/**
 * Heading anchors: the slug of the text, deduped within a page. The renderer
 * and the TOC extractor share this so a TOC link always finds its heading.
 */
function headingId(text: string, seen: Map<string, number>): string {
  const base = slugify(text) || 'section'
  const n = seen.get(base) ?? 0
  seen.set(base, n + 1)
  return n === 0 ? base : `${base}-${n + 1}`
}

function renderChildren(block: Block, seen: Map<string, number>): string {
  if (!Array.isArray(block.children) || block.children.length === 0) return ''
  return `<div class="indent">${renderBlocks(block.children, seen)}</div>`
}

function renderBlocks(blocks: Block[], seen: Map<string, number> = new Map()): string {
  let out = ''
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (!block) {
      i++
      continue
    }
    const type = block.type ?? 'paragraph'

    if (LIST_TYPES.has(type)) {
      // group consecutive same-type list items into one list element
      const tag = listTag(type)
      const isCheck = type === 'checkListItem'
      let items = ''
      while (i < blocks.length) {
        const item = blocks[i]
        if (!item || item.type !== type) break
        const inner = renderInline(item.content)
        if (isCheck) {
          const checked = item.props?.checked === true
          items += `<li class="check${checked ? ' done' : ''}"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${inner}${renderChildrenAsList(item, tag)}</li>`
        } else {
          items += `<li>${inner}${renderChildrenAsList(item, tag)}</li>`
        }
        i++
      }
      out += `<${tag}${isCheck ? ' class="checklist"' : ''}>${items}</${tag}>`
      continue
    }

    switch (type) {
      case 'heading': {
        const level = Number(block.props?.level) || 1
        const h = Math.min(Math.max(level + 1, 2), 4) // page title owns h1
        const inner = renderInline(block.content)
        const id = headingId(inlinePlain(block.content), seen)
        // the anchor is a real link so it works without JS; CHROME_JS upgrades
        // it to copy-to-clipboard
        out += `<h${h} id="${escapeHtml(id)}">${inner}<a class="hanchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a></h${h}>`
        break
      }
      case 'codeBlock': {
        const rawLang = typeof block.props?.language === 'string' ? block.props.language : ''
        const language = escapeHtml(rawLang)
        // Mermaid stays source in the snapshot and becomes a diagram in the
        // browser: escaping is both the safety rule and correct input, since
        // the library reads textContent (which un-escapes back to the source).
        if (rawLang.toLowerCase() === 'mermaid') {
          out += `<pre class="mermaid">${escapeHtml(codeText(block.content))}</pre>`
          break
        }
        const code = highlightCode(codeText(block.content), rawLang)
        out += `<pre${language ? ` data-lang="${language}"` : ''}><code${
          language ? ` class="language-${language}"` : ''
        }>${code}</code></pre>`
        break
      }
      case 'quote':
        out += `<blockquote>${renderInline(block.content)}</blockquote>`
        break
      case 'image': {
        const url = safeHref(block.props?.url)
        if (!url) break
        const caption = typeof block.props?.caption === 'string' ? block.props.caption : ''
        out += `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(caption)}" loading="lazy">${
          caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
        }</figure>`
        break
      }
      default:
        out += `<p>${renderInline(block.content)}</p>`
    }
    out += renderChildren(block, seen)
    i++
  }
  return out
}

function renderChildrenAsList(block: Block, tag: 'ul' | 'ol'): string {
  if (!Array.isArray(block.children) || block.children.length === 0) return ''
  return renderBlocks(block.children).replace(/^/, '') // nested lists render as their own <ul>/<ol> inside the <li>
}

export type TocEntry = { level: number; text: string; id: string }

/**
 * The "On this page" list. Walks the same blocks in the same order with the
 * same id rules as the renderer, so ids always line up with the baked HTML.
 */
export function extractHeadings(contentJson: string): TocEntry[] {
  let blocks: Block[]
  try {
    const parsed = JSON.parse(contentJson)
    blocks = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  const seen = new Map<string, number>()
  const out: TocEntry[] = []
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block?.type === 'heading') {
        const text = inlinePlain(block.content)
        const level = Math.min(Math.max((Number(block.props?.level) || 1) + 1, 2), 4)
        out.push({ level, text, id: headingId(text, seen) })
      }
      if (Array.isArray(block?.children)) walk(block.children)
    }
  }
  walk(blocks)
  return out
}

function codeText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as any[]).map((i) => (typeof i?.text === 'string' ? i.text : '')).join('')
}

export function blocknoteToHtml(contentJson: string): string {
  let blocks: Block[]
  try {
    const parsed = JSON.parse(contentJson)
    blocks = Array.isArray(parsed) ? parsed : []
  } catch {
    return ''
  }
  return renderBlocks(blocks)
}

export type GalleryRenderItem = { url: string; thumbUrl: string; caption: string }
export type GalleryLayout = 'grid' | 'carousel' | 'filmstrip' | 'mosaic'

/** The gallery appended to a gallery page's rendered HTML at publish time.
 *  Layout is a per-gallery setting, baked into the snapshot like everything
 *  else; carousel/filmstrip get full-size images (they show one at a time). */
export function galleryHtml(
  items: GalleryRenderItem[],
  layout: GalleryLayout = 'grid',
  autoplaySecs?: number | null,
): string {
  if (items.length === 0) return ''
  const strip = layout === 'carousel' || layout === 'filmstrip'
  const cells = items
    .map(
      (i) =>
        `<a class="cell" href="${escapeHtml(i.url)}"><img src="${escapeHtml(strip ? i.url : i.thumbUrl)}" alt="${escapeHtml(i.caption)}" loading="lazy">${
          i.caption ? `<span class="cap">${escapeHtml(i.caption)}</span>` : ''
        }</a>`,
    )
    .join('')
  if (strip) {
    const auto = autoplaySecs ? ` data-autoplay="${Math.round(autoplaySecs)}"` : ''
    return `<div class="gallery ${layout}"${auto}><div class="track">${cells}</div><button type="button" class="gnav prev" aria-label="Previous">‹</button><button type="button" class="gnav next" aria-label="Next">›</button></div>`
  }
  return `<div class="gallery ${layout}">${cells}</div>`
}

export function plainText(contentJson: string): string {
  let blocks: Block[]
  try {
    const parsed = JSON.parse(contentJson)
    blocks = Array.isArray(parsed) ? parsed : []
  } catch {
    return ''
  }
  const lines: string[] = []
  const walk = (list: Block[]) => {
    for (const block of list) {
      const text = inlinePlain(block.content)
      if (text) lines.push(text)
      if (Array.isArray(block.children)) walk(block.children)
    }
  }
  walk(blocks)
  return lines.join('\n')
}

function inlinePlain(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as any[])
    .map((i) => {
      if (typeof i?.text === 'string') return i.text
      if (i?.content) return inlinePlain(i.content)
      return ''
    })
    .join('')
}
