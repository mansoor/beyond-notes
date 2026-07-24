// Server-side fetch of a shared link, so the browser never has to. Because the
// URL is attacker-controlled (anything can be shared in), this is an SSRF
// surface: every hop's host is resolved and rejected if it points at a private,
// loopback, or link-local address, redirects are followed manually so each new
// host is re-checked, and the read is capped in bytes and time. Output is a
// title plus either the whole readable text or just the opening paragraph.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_BYTES = 2_000_000
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4
const MAX_TEXT = 20_000

export type LinkFetch = { url: string; title: string; content: string }

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = p as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true // this-host, private, loopback
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast + reserved
  return false
}

/** Exported for tests: true if an address is private/loopback/link-local/etc.
 *  and therefore must never be fetched. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isPrivateIpv4(ip)
  if (v === 6) {
    const low = ip.toLowerCase()
    if (low === '::1' || low === '::') return true // loopback, unspecified
    if (low.startsWith('fc') || low.startsWith('fd')) return true // unique-local fc00::/7
    if (/^fe[89ab]/.test(low)) return true // link-local fe80::/10
    if (low.startsWith('ff')) return true // multicast
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4-mapped
    if (mapped?.[1]) return isPrivateIpv4(mapped[1])
    return false
  }
  return true // not a resolvable IP literal → refuse
}

/** Throws unless every address the host resolves to is publicly routable. */
async function assertPublicHost(host: string): Promise<void> {
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('blocked host')
    return
  }
  const addrs = await lookup(host, { all: true }).catch(() => [])
  if (addrs.length === 0) throw new Error('cannot resolve host')
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('blocked host')
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, MAX_BYTES)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {})
        break
      }
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
  }
  return s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return named[code.toLowerCase()] ?? m
  })
}

function stripToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
      // block-level tags become line breaks so words don't fuse across them
      .replace(/<\/(p|div|section|article|li|h[1-6]|br|tr|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim()
}

function extractTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
  )?.[1]
  if (og?.trim()) return decodeEntities(og.trim())
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return t ? decodeEntities(t).replace(/\s+/g, ' ').trim() : ''
}

function firstParagraph(html: string, fallback: string): string {
  // prefer a substantial <p>; short ones are usually captions/nav
  const paras = html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)
  for (const m of paras) {
    const text = stripToText(m[1] ?? '').replace(/\n+/g, ' ').trim()
    if (text.length >= 40) return text
  }
  const meta = html.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i,
  )?.[1]
  if (meta?.trim()) return decodeEntities(meta.trim())
  return fallback.split('\n\n')[0]?.slice(0, 500) ?? ''
}

/**
 * Fetch a shared URL and return a title plus content. `mode: 'full'` returns the
 * whole readable text (capped); `'excerpt'` returns just the opening paragraph.
 * Throws on a blocked/unreachable host or a non-HTML response.
 */
export async function fetchLink(rawUrl: string, mode: 'full' | 'excerpt'): Promise<LinkFetch> {
  let start = rawUrl.trim()
  if (!/^[a-z]+:\/\//i.test(start)) start = `https://${start}`
  let current = new URL(start)
  let html = ''
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error('unsupported scheme')
    }
    await assertPublicHost(current.hostname)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; BeyondNotes-LinkPreview/1.0)',
          accept: 'text/html,application/xhtml+xml',
        },
      })
    } finally {
      clearTimeout(timer)
    }
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current) // re-checked at the top of the next turn
      continue
    }
    // A paywall, bot wall, or any 4xx/5xx still returns an HTML body; parsing it
    // would store the block page's title as the "article". Refuse it — the
    // caller falls back to keeping just the clean URL.
    if (!res.ok) throw new Error(`upstream returned ${res.status}`)
    const ct = res.headers.get('content-type') ?? ''
    if (ct && !/text\/html|application\/xhtml/i.test(ct)) {
      return { url: current.href, title: current.hostname, content: '' }
    }
    html = await readCapped(res)
    break
  }
  const title = extractTitle(html) || current.hostname
  const full = stripToText(html)
  const content = (mode === 'full' ? full : firstParagraph(html, full)).slice(0, MAX_TEXT).trim()
  return { url: current.href, title, content }
}
