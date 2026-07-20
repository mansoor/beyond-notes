// Pure renderer: BlockNote block JSON -> HTML / plain text.
// Everything user-authored is escaped; hrefs are allow-listed. No raw HTML
// passes through — this is the publish pipeline's security posture, enforced
// here rather than at serve time.

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

function renderChildren(block: Block): string {
  if (!Array.isArray(block.children) || block.children.length === 0) return ''
  return `<div class="indent">${renderBlocks(block.children)}</div>`
}

function renderBlocks(blocks: Block[]): string {
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
        out += `<h${h}>${renderInline(block.content)}</h${h}>`
        break
      }
      case 'codeBlock': {
        const language =
          typeof block.props?.language === 'string' ? escapeHtml(block.props.language) : ''
        const code = escapeHtml(codeText(block.content))
        out += `<pre><code${language ? ` class="language-${language}"` : ''}>${code}</code></pre>`
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
    out += renderChildren(block)
    i++
  }
  return out
}

function renderChildrenAsList(block: Block, tag: 'ul' | 'ol'): string {
  if (!Array.isArray(block.children) || block.children.length === 0) return ''
  return renderBlocks(block.children).replace(/^/, '') // nested lists render as their own <ul>/<ol> inside the <li>
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
