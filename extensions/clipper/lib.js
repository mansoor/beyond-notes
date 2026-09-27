/*
 * Shared by the popup and the background worker: settings, the Beyond Notes
 * API, and the page extractor that runs inside the tab being clipped.
 *
 * Plain script (no modules, no build step) so the same files load as a Chrome
 * service worker (importScripts), a Firefox background script, and a popup.
 */

// Chrome exposes `chrome`, Firefox both; the promise-returning APIs used here
// exist on `chrome.*` in both browsers for Manifest V3.
const ext = globalThis.chrome

/** { url, token, name } or null. The token lives on this device only (never synced). */
async function loadSettings() {
  const { bn } = await ext.storage.local.get('bn')
  return bn?.url && bn?.token ? bn : null
}

async function saveSettings(settings) {
  await ext.storage.local.set({ bn: settings })
}

async function clearSettings() {
  await ext.storage.local.remove('bn')
}

/** "notes.example.com/" -> "https://notes.example.com" */
function normalizeUrl(raw) {
  let url = String(raw || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** One call to the instance's REST API. Throws with the server's own message. */
async function api(settings, method, path, body) {
  let res
  try {
    res = await fetch(`${settings.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${settings.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(`Could not reach ${settings.url}. Check the address and that it is running.`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) throw new Error('The token was not accepted. Paste a current one.')
    if (res.status === 403) throw new Error('This token is read-only. Use a read and write token.')
    throw new Error(data?.error?.message || `The server answered ${res.status}.`)
  }
  return data
}

/**
 * Runs INSIDE the tab (chrome.scripting.executeScript), so it must be fully
 * self-contained: no references to anything outside this function.
 *
 * Returns the selection (or the page's main content when nothing is selected)
 * converted to Markdown, plus the title and address.
 */
function extractForClip() {
  const abs = (url) => {
    try {
      return new URL(url, location.href).href
    } catch {
      return ''
    }
  }
  const SKIP = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'IFRAME',
    'SVG',
    'CANVAS',
    'FORM',
    'BUTTON',
    'INPUT',
    'SELECT',
    'TEXTAREA',
  ])
  // chrome around an article, skipped only when clipping the whole page
  const CHROME = new Set(['NAV', 'FOOTER', 'ASIDE', 'HEADER'])

  const text = (s) => s.replace(/\s+/g, ' ')
  // **bold** / *italic* keep the spaces the page had around them, outside the marks
  const wrap = (raw, mark) => {
    const t = raw.trim()
    if (!t) return raw.replace(/\S/g, '')
    return `${/^\s/.test(raw) ? ' ' : ''}${mark}${t}${mark}${/\s$/.test(raw) ? ' ' : ''}`
  }
  const inline = (node, full) => {
    let out = ''
    for (const child of node.childNodes) out += convert(child, full, 0)
    return out.replace(/[ \t]+\n/g, '\n')
  }

  function convert(node, full, depth) {
    if (node.nodeType === Node.TEXT_NODE) return text(node.textContent || '')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node
    // SVG and MathML elements report lowercase names
    const tag = el.tagName.toUpperCase()
    if (SKIP.has(tag)) return ''
    if (full && CHROME.has(tag)) return ''
    if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return ''
    if (
      full &&
      el.isConnected &&
      typeof el.checkVisibility === 'function' &&
      !el.checkVisibility()
    ) {
      return ''
    }
    const kids = () => inline(el, full)
    switch (tag) {
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        const t = kids().trim()
        return t ? `\n\n${'#'.repeat(Number(tag[1]))} ${t}\n\n` : ''
      }
      case 'P':
      case 'DIV':
      case 'SECTION':
      case 'ARTICLE':
      case 'MAIN':
      case 'FIGURE':
        return `\n\n${kids().trim()}\n\n`
      case 'FIGCAPTION':
        return `\n\n*${kids().trim()}*\n\n`
      case 'BR':
        return '  \n'
      case 'HR':
        return '\n\n---\n\n'
      case 'STRONG':
      case 'B':
        return wrap(kids(), '**')
      case 'EM':
      case 'I':
        return wrap(kids(), '*')
      case 'S':
      case 'DEL':
        return wrap(kids(), '~~')
      case 'SUP': {
        // footnote markers like [12] are noise once the footnotes are gone
        const t = (el.textContent || '').trim()
        return /^\[\d+\]$/.test(t) ? '' : kids()
      }
      case 'CODE':
        return el.closest('pre') ? el.textContent || '' : `\`${(el.textContent || '').trim()}\``
      case 'PRE': {
        const lang = (el.querySelector('code')?.className.match(/language-([\w-]+)/) || [])[1] || ''
        return `\n\n\`\`\`${lang}\n${(el.textContent || '').replace(/\n$/, '')}\n\`\`\`\n\n`
      }
      case 'A': {
        const href = abs(el.getAttribute('href') || '')
        const t = kids().trim()
        if (!t) return ''
        return href && !href.startsWith('javascript:') ? `[${t}](${href})` : t
      }
      case 'IMG': {
        const src = abs(el.currentSrc || el.getAttribute('src') || '')
        if (!src || src.startsWith('data:')) return ''
        return `\n\n![${(el.getAttribute('alt') || '').replace(/[[\]]/g, '')}](${src})\n\n`
      }
      case 'BLOCKQUOTE':
        return `\n\n${kids()
          .trim()
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n')}\n\n`
      case 'UL':
      case 'OL': {
        let n = 0
        const items = []
        for (const li of el.children) {
          if (li.tagName !== 'LI') continue
          n++
          const marker = tag === 'OL' ? `${n}.` : '-'
          let body = ''
          let nested = ''
          for (const c of li.childNodes) {
            if (c.nodeType === Node.ELEMENT_NODE && (c.tagName === 'UL' || c.tagName === 'OL')) {
              nested += convert(c, full, depth + 1)
            } else body += convert(c, full, depth + 1)
          }
          const box = li.querySelector(':scope > input[type=checkbox]')
          const check = box ? (box.checked ? '[x] ' : '[ ] ') : ''
          items.push(
            `${'  '.repeat(depth)}${marker} ${check}${text(body).trim()}${nested ? `\n${nested.replace(/^\n+|\n+$/g, '')}` : ''}`,
          )
        }
        return `\n\n${items.join('\n')}\n\n`
      }
      case 'TABLE': {
        const rows = [...el.querySelectorAll('tr')].map((tr) =>
          // cells go through the converter too, so an embedded <style> stays
          // out and links survive
          [...tr.children].map((c) => text(inline(c, full)).trim().replace(/\|/g, '\\|')),
        )
        if (rows.length === 0) return ''
        const width = Math.max(...rows.map((r) => r.length))
        const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`
        return `\n\n${[line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')}\n\n`
      }
      default:
        return kids()
    }
  }

  const sel = window.getSelection()
  let root
  let fromSelection = false
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().trim()) {
    root = document.createElement('div')
    for (let i = 0; i < sel.rangeCount; i++) root.appendChild(sel.getRangeAt(i).cloneContents())
    fromSelection = true
  } else {
    root =
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.querySelector('[role=main]') ||
      document.body
  }
  const markdown = convert(root, !fromSelection, 0)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500000)
  const description =
    document.querySelector('meta[name=description]')?.getAttribute('content') ||
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    ''
  return {
    title: document.title || location.href,
    url: location.href,
    markdown,
    fromSelection,
    description,
  }
}

/** Run the extractor in a tab; null on pages extensions can't touch (chrome://, stores). */
async function extractFromTab(tabId) {
  try {
    const [result] = await ext.scripting.executeScript({ target: { tabId }, func: extractForClip })
    return result?.result ?? null
  } catch {
    return null
  }
}

/** The Inbox gets a compact note: the link, and the selection quoted under it. */
function inboxText(clip) {
  const link = `[${clip.title.replace(/[[\]]/g, '')}](${clip.url})`
  if (clip.fromSelection && clip.markdown) {
    const quoted = clip.markdown
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    return `${link}\n\n${quoted}`.slice(0, 5000)
  }
  return link
}

/** A new page gets the full content, with where it came from on top. */
function pageMarkdown(clip) {
  const host = (() => {
    try {
      return new URL(clip.url).host
    } catch {
      return clip.url
    }
  })()
  const date = new Date().toISOString().slice(0, 10)
  return `> Clipped from [${host}](${clip.url}) on ${date}\n\n${clip.markdown || clip.description || ''}`
}

async function clipToInbox(settings, clip) {
  await api(settings, 'POST', '/api/v1/inbox', { text: inboxText(clip) })
  return `${settings.url}/inbox`
}

async function clipToPage(settings, clip, spaceId, title) {
  const page = await api(settings, 'POST', '/api/v1/pages', {
    spaceId,
    title: (title || clip.title).slice(0, 300),
    markdown: pageMarkdown(clip),
  })
  return `${settings.url}/p/${page.id}`
}
