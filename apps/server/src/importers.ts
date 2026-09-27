/**
 * Importers for other tools' exports: a Notion "Markdown & CSV" export, an
 * Obsidian vault (or any folder of Markdown), and Evernote .enex files.
 *
 * Each turns the upload into the same review plan the Markdown/GitHub importer
 * uses (ImportNodePlan rows in tree order), plus the files the notes refer to.
 * Nothing is written here. Cross-references are left as placeholders that the
 * apply step resolves once real ids exist:
 *
 *   (bn-page:KEY)   a link to another imported note, by plan key
 *   (bn-file:KEY)   an image or attachment carried inside the upload
 *
 * Obsidian daily notes (YYYY-MM-DD.md) are marked with `journalDate` so they
 * land in the Journal instead of becoming pages.
 */
import { createHash } from 'node:crypto'
import type { ImportNodePlan } from '@bn/schema'
import { XMLParser } from 'fast-xml-parser'
import { unzipSync } from 'fflate'
import TurndownService from 'turndown'

export type ImportKind = 'notion' | 'obsidian' | 'evernote'

export type StashFile = { name: string; mime: string; data: Uint8Array }

export type ParsedImport = {
  kind: ImportKind
  sourceLabel: string
  suggestedName: string
  suggestedCategory: 'notebook' | 'wiki'
  nodes: ImportNodePlan[]
  files: Map<string, StashFile>
  warnings: string[]
}

export class ImportFormatError extends Error {}

/** More than this and the review list stops being reviewable. */
export const MAX_IMPORT_NODES = 5000
const MAX_LEVEL = 6

// ---- shared helpers ----

const decoder = new TextDecoder('utf-8')
function text(bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/^﻿/, '')
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  heic: 'image/heic',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
}
export function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}
const isImage = (name: string) => mimeOf(name).startsWith('image/')

const basename = (p: string) => p.split('/').pop() ?? p
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const stripExt = (p: string) => p.replace(/\.[^./]+$/, '')

/** Resolve `rel` against directory `dir`, both '/'-separated, no leading slash. */
function resolvePath(dir: string, rel: string): string {
  const out = rel.startsWith('/') ? [] : dir.split('/').filter(Boolean)
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function excerptOf(markdown: string): string {
  return markdown
    .replace(/\(bn-(page|file):[^)]+\)/g, '')
    .replace(/[#>*_`![\]|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** Apply `fn` to the prose of a Markdown document, never inside code. */
function outsideCode(markdown: string, fn: (prose: string) => string): string {
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('')
}

/** Unzip, flattening a zip-of-zips (Notion splits big exports into Part-N.zip). */
function unzipAll(buf: Uint8Array): Map<string, Uint8Array> {
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(buf)
  } catch {
    throw new ImportFormatError('That file is not a readable zip archive.')
  }
  const out = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(raw)) {
    const p = path.replace(/\\/g, '/')
    if (p.endsWith('/') || p.startsWith('__MACOSX/') || basename(p) === '.DS_Store') continue
    if (p.toLowerCase().endsWith('.zip')) {
      try {
        for (const [inner, innerData] of Object.entries(unzipSync(data))) {
          const q = inner.replace(/\\/g, '/')
          if (!q.endsWith('/') && !q.startsWith('__MACOSX/')) out.set(q, innerData)
        }
        continue
      } catch {
        // not a zip after all: keep it as a file
      }
    }
    out.set(p, data)
  }
  return out
}

/** Drop a folder every entry shares ("My Vault/…"), and return its name. */
function stripCommonRoot(files: Map<string, Uint8Array>): {
  files: Map<string, Uint8Array>
  root: string
} {
  const firsts = new Set([...files.keys()].map((p) => (p.includes('/') ? p.split('/')[0] : '')))
  if (firsts.size !== 1) return { files, root: '' }
  const [root = ''] = [...firsts]
  if (!root) return { files, root: '' }
  const out = new Map<string, Uint8Array>()
  for (const [p, d] of files) out.set(p.slice(root.length + 1), d)
  return { files: out, root }
}

/** Hashtags for a tag list, the way the app writes them inline. */
function tagLine(tags: string[]): string {
  const clean = tags
    .map((t) => t.trim().replace(/^#/, '').replace(/\s+/g, '-'))
    .filter((t) => /^[\p{L}\p{N}_/-]+$/u.test(t))
  return clean.length ? `${clean.map((t) => `#${t}`).join(' ')}\n\n` : ''
}

/** A minimal RFC 4180 CSV reader: quotes, escaped quotes, CRLF. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

function csvToMarkdownTable(csv: string): string {
  const rows = parseCsv(csv.replace(/^﻿/, ''))
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const esc = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
  const line = (r: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => esc(r[i] ?? '')).join(' | ')} |`
  const [head = [], ...body] = rows
  return [line(head), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n')
}

/** Keeps levels inside the plan's 0..6 and says so once if it had to. */
function clampLevel(level: number, warnings: string[]): number {
  if (level > MAX_LEVEL) {
    const note = `Pages nested deeper than ${MAX_LEVEL + 1} levels were lifted to level ${MAX_LEVEL + 1}.`
    if (!warnings.includes(note)) warnings.push(note)
    return MAX_LEVEL
  }
  return level
}

class FileRegistry {
  files = new Map<string, StashFile>()
  private byPath = new Map<string, string>()
  add(path: string, data: Uint8Array): string {
    const existing = this.byPath.get(path)
    if (existing) return existing
    const key = `f${this.byPath.size + 1}`
    this.byPath.set(path, key)
    this.files.set(key, { name: basename(path), mime: mimeOf(path), data })
    return key
  }
}

/**
 * Rewrite Markdown links and images whose target is a file in the upload:
 * notes become (bn-page:KEY), carried files become (bn-file:KEY).
 */
function rewriteRelativeLinks(
  markdown: string,
  dir: string,
  resolveNote: (path: string) => string | null,
  resolveFile: (path: string) => string | null,
): string {
  return outsideCode(markdown, (prose) =>
    prose.replace(
      /(!?)\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g,
      (whole, bang: string, label: string, url: string) => {
        if (/^(https?:|mailto:|#|\/|bn-)/i.test(url)) return whole
        const path = resolvePath(dir, safeDecode(url.split('#')[0] ?? ''))
        const note = resolveNote(path)
        if (note) return `[${label}](bn-page:${note})`
        const file = resolveFile(path)
        if (file) return bang ? `![${label}](bn-file:${file})` : `[${label}](bn-file:${file})`
        return whole
      },
    ),
  )
}

// ---- Notion ----

const NOTION_ID = /\s+[0-9a-f]{32}$/i
const notionTitle = (name: string) => stripExt(name).replace(NOTION_ID, '').trim() || 'Untitled'

export function parseNotion(buf: Uint8Array, filename: string): ParsedImport {
  const { files } = stripCommonRoot(unzipAll(buf))
  const warnings: string[] = []
  const registry = new FileRegistry()

  // one entry per page: a .md file, or a database's .csv (prefer the _all view)
  type Entry = { stem: string; path: string; kind: 'md' | 'csv'; key: string; title: string }
  const entries = new Map<string, Entry>()
  let n = 0
  for (const path of files.keys()) {
    const lower = path.toLowerCase()
    if (lower.endsWith('.md')) {
      const stem = stripExt(path)
      entries.set(stem, {
        stem,
        path,
        kind: 'md',
        key: `n${++n}`,
        title: notionTitle(basename(path)),
      })
    }
  }
  for (const path of files.keys()) {
    if (!path.toLowerCase().endsWith('.csv')) continue
    const isAll = /_all\.csv$/i.test(path)
    const stem = stripExt(path).replace(/_all$/i, '')
    if (entries.has(stem) && (entries.get(stem)?.kind === 'md' || !isAll)) continue
    const prev = entries.get(stem)
    entries.set(stem, {
      stem,
      path,
      kind: 'csv',
      key: prev?.key ?? `n${++n}`,
      title: notionTitle(basename(stem)),
    })
  }
  if (entries.size === 0) {
    throw new ImportFormatError('No Notion pages found. Export from Notion as "Markdown & CSV".')
  }

  // a page's children live in the folder named like the page itself
  const parentOf = (stem: string): Entry | null => {
    let dir = dirname(stem)
    while (dir) {
      const e = entries.get(dir)
      if (e) return e
      dir = dirname(dir)
    }
    return null
  }
  const children = new Map<string, Entry[]>()
  const roots: Entry[] = []
  for (const e of entries.values()) {
    const p = parentOf(e.stem)
    if (p) children.set(p.stem, [...(children.get(p.stem) ?? []), e])
    else roots.push(e)
  }
  const byTitle = (a: Entry, b: Entry) => a.title.localeCompare(b.title)

  const resolveNote = (path: string) => {
    const stem = stripExt(path).replace(/_all$/i, '')
    return entries.get(stem)?.key ?? null
  }
  const resolveFile = (path: string) => {
    const data = files.get(path)
    return data ? registry.add(path, data) : null
  }

  const nodes: ImportNodePlan[] = []
  const walk = (list: Entry[], level: number) => {
    for (const e of [...list].sort(byTitle)) {
      const raw = text(files.get(e.path) ?? new Uint8Array())
      let title = e.title
      let markdown: string
      if (e.kind === 'md') {
        const h1 = raw.match(/^\s*#\s+(.+?)\s*$/m)
        if (h1 && raw.trimStart().startsWith('#')) {
          title = h1[1]?.trim() || title
          markdown = raw.replace(/^\s*#\s+.+\r?\n?/, '')
        } else markdown = raw
      } else {
        markdown = csvToMarkdownTable(raw)
      }
      markdown = rewriteRelativeLinks(markdown.trim(), dirname(e.path), resolveNote, resolveFile)
      nodes.push({
        key: e.key,
        title: title.slice(0, 200),
        level: clampLevel(level, warnings),
        kind: 'file',
        path: e.path.slice(0, 400),
        markdown,
        excerpt: e.kind === 'csv' ? 'Database (as a table)' : excerptOf(markdown),
      })
      walk(children.get(e.stem) ?? [], level + 1)
    }
  }
  walk(roots, 0)

  if ([...entries.values()].some((e) => e.kind === 'csv')) {
    warnings.push(
      'Notion databases come in as a page with a table; their rows are pages beneath it.',
    )
  }
  return {
    kind: 'notion',
    sourceLabel: filename || 'Notion export',
    suggestedName: roots.length === 1 ? (roots[0]?.title ?? 'Notion') : 'Notion',
    suggestedCategory: 'wiki',
    nodes,
    files: registry.files,
    warnings,
  }
}

// ---- Obsidian (and any folder of Markdown) ----

const DAILY = /^\d{4}-\d{2}-\d{2}$/

function frontmatterTags(front: string): string[] {
  const tags: string[] = []
  const inline = front.match(/^tags?:\s*(.+)$/m)
  if (inline?.[1]) {
    const v = inline[1].trim()
    const list = v.startsWith('[') ? v.slice(1, -1) : v
    tags.push(...list.split(/[,\s]+/).map((t) => t.replace(/^["']|["']$/g, '')))
  }
  const block = front.match(/^tags?:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/m)
  if (block?.[1]) {
    tags.push(
      ...block[1].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').replace(/^["']|["']$/g, '')),
    )
  }
  return tags.filter(Boolean)
}

export function parseObsidian(buf: Uint8Array, filename: string): ParsedImport {
  const unzipped = unzipAll(buf)
  for (const p of [...unzipped.keys()]) {
    // settings, trash and dot-folders are not notes
    if (p.split('/').some((seg) => seg.startsWith('.'))) unzipped.delete(p)
  }
  const { files, root } = stripCommonRoot(unzipped)
  const warnings: string[] = []
  const registry = new FileRegistry()

  const notes = [...files.keys()].filter((p) => p.toLowerCase().endsWith('.md'))
  if (notes.length === 0) throw new ImportFormatError('No Markdown notes found in that zip.')

  let n = 0
  const keyOf = new Map<string, string>() // note path -> key
  for (const p of notes) keyOf.set(p, `o${++n}`)
  const byName = new Map<string, string>() // lowercase basename -> note path
  for (const p of notes) {
    const name = stripExt(basename(p)).toLowerCase()
    if (!byName.has(name)) byName.set(name, p)
  }
  const attachments = new Map<string, string>() // lowercase basename -> path
  for (const p of files.keys()) {
    if (!p.toLowerCase().endsWith('.md')) attachments.set(basename(p).toLowerCase(), p)
  }
  const isDaily = (p: string) => DAILY.test(stripExt(basename(p)))

  const findNote = (target: string): string | null => {
    const t = target.replace(/\.md$/i, '')
    const direct = notes.find((p) => stripExt(p).toLowerCase() === t.toLowerCase())
    return direct ?? byName.get(basename(t).toLowerCase()) ?? null
  }
  const linkToNote = (path: string, label: string) =>
    isDaily(path)
      ? `[${label}](/day/${stripExt(basename(path))})`
      : `[${label}](bn-page:${keyOf.get(path)})`
  const fileKey = (path: string) => {
    const data = files.get(path)
    return data ? registry.add(path, data) : null
  }

  const convert = (path: string, raw: string): string => {
    let md = raw.replace(/\r\n/g, '\n')
    let tags: string[] = []
    const front = md.match(/^---\n([\s\S]*?)\n---\n?/)
    if (front) {
      tags = frontmatterTags(front[1] ?? '')
      md = md.slice(front[0].length)
    }
    md = outsideCode(md, (prose) =>
      prose
        // ![[embed]] — an image or file, or a note shown inline (kept as a link)
        .replace(/!\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
          const [target = ''] = inner.split('|')
          const clean = target.split('#')[0]?.trim() ?? ''
          const att = attachments.get(basename(clean).toLowerCase())
          if (att) {
            const k = fileKey(att)
            if (k) return isImage(att) ? `![](bn-file:${k})` : `[${basename(att)}](bn-file:${k})`
          }
          const note = findNote(clean)
          return note ? linkToNote(note, clean) : whole
        })
        // [[Note]], [[Note|alias]], [[Note#Heading]]
        .replace(/\[\[([^\]\n]+)\]\]/g, (_whole, inner: string) => {
          const [target = '', alias] = inner.split('|')
          const [notePart = ''] = target.split('#')
          const label = (alias ?? target).trim()
          const note = notePart.trim() ? findNote(notePart.trim()) : null
          return note ? linkToNote(note, label) : label
        }),
    )
    md = rewriteRelativeLinks(
      md,
      dirname(path),
      (p) => {
        const note = notes.includes(p) ? p : findNote(p)
        return note && !isDaily(note) ? (keyOf.get(note) ?? null) : null
      },
      (p) => {
        const hit = files.has(p) ? p : attachments.get(basename(p).toLowerCase())
        return hit ? fileKey(hit) : null
      },
    )
    return `${tagLine(tags)}${md.trim()}`
  }

  // the folder tree; a "folder note" (Folder/Folder.md) stands in for its folder
  const folders = new Set<string>()
  for (const p of notes) {
    if (isDaily(p)) continue
    let d = dirname(p)
    while (d) {
      folders.add(d)
      d = dirname(d)
    }
  }
  const folderNote = (folder: string) => {
    const candidate = `${folder}/${basename(folder)}.md`
    return notes.includes(candidate) ? candidate : null
  }

  const nodes: ImportNodePlan[] = []
  const walk = (dir: string, level: number) => {
    const subdirs = [...folders]
      .filter((f) => dirname(f) === dir)
      .sort((a, b) => a.localeCompare(b))
    const own = notes
      .filter((p) => dirname(p) === dir && !isDaily(p))
      .filter((p) => !(dir && p === folderNote(dir)))
      .sort((a, b) => a.localeCompare(b))
    for (const sub of subdirs) {
      const fnote = folderNote(sub)
      const markdown = fnote ? convert(fnote, text(files.get(fnote) ?? new Uint8Array())) : ''
      nodes.push({
        key: fnote ? (keyOf.get(fnote) ?? `d${nodes.length}`) : `dir-${nodes.length + 1}`,
        title: basename(sub).slice(0, 200),
        level: clampLevel(level, warnings),
        kind: 'file',
        path: sub.slice(0, 400),
        markdown,
        excerpt: markdown ? excerptOf(markdown) : 'Folder',
      })
      walk(sub, level + 1)
    }
    for (const p of own) {
      const markdown = convert(p, text(files.get(p) ?? new Uint8Array()))
      nodes.push({
        key: keyOf.get(p) ?? `o${nodes.length}`,
        title: stripExt(basename(p)).slice(0, 200) || 'Untitled',
        level: clampLevel(level, warnings),
        kind: 'file',
        path: p.slice(0, 400),
        markdown,
        excerpt: excerptOf(markdown),
      })
    }
  }
  walk('', 0)

  // daily notes go to the Journal, oldest first, after the tree
  const daily = notes.filter(isDaily).sort((a, b) => basename(a).localeCompare(basename(b)))
  for (const p of daily) {
    const date = stripExt(basename(p))
    const markdown = convert(p, text(files.get(p) ?? new Uint8Array()))
    if (!markdown.trim()) continue
    nodes.push({
      key: keyOf.get(p) ?? `j${nodes.length}`,
      title: date,
      level: 0,
      kind: 'file',
      path: p.slice(0, 400),
      markdown,
      excerpt: excerptOf(markdown),
      journalDate: date,
    })
  }
  if (daily.length) {
    warnings.push(
      `${daily.length} daily note${daily.length === 1 ? '' : 's'} will be added to the Journal on ${daily.length === 1 ? 'its' : 'their'} date.`,
    )
  }

  return {
    kind: 'obsidian',
    sourceLabel: filename || 'Obsidian vault',
    suggestedName: root || stripExt(filename) || 'Obsidian vault',
    suggestedCategory: 'notebook',
    nodes,
    files: registry.files,
    warnings,
  }
}

// ---- Evernote (.enex) ----

type EnexResource = {
  data?: string | { '#text'?: string }
  mime?: string
  'resource-attributes'?: { 'file-name'?: string }
}
type EnexNote = {
  title?: string
  content?: string
  tag?: string[]
  resource?: EnexResource[]
}

function turndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  })
  // Evernote wraps nearly every line in a div; treat them as paragraphs
  td.addRule('div', {
    filter: ['div'],
    replacement: (content) => `\n${content}\n`,
  })
  return td
}

export function parseEvernote(buf: Uint8Array, filename: string): ParsedImport {
  const xml = text(buf)
  if (!xml.includes('<en-export')) {
    throw new ImportFormatError('That is not an Evernote export (.enex).')
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'note' || name === 'tag' || name === 'resource',
    // ENML inside <content> is CDATA text; never parse it as part of the export
    stopNodes: ['*.content'],
    parseTagValue: false,
  })
  const doc = parser.parse(xml) as { 'en-export'?: { note?: EnexNote[] } }
  const notes = doc['en-export']?.note ?? []
  if (notes.length === 0) throw new ImportFormatError('That .enex file has no notes in it.')

  const warnings: string[] = []
  const files = new Map<string, StashFile>()
  const td = turndown()
  let encrypted = 0
  const nodes: ImportNodePlan[] = []

  notes.forEach((note, i) => {
    // resources are matched to <en-media hash="…"> by the md5 of their bytes
    const media = new Map<string, { key: string; mime: string; name: string }>()
    for (const r of note.resource ?? []) {
      const b64 = typeof r.data === 'string' ? r.data : (r.data?.['#text'] ?? '')
      if (!b64) continue
      const bytes = Buffer.from(b64.replace(/\s+/g, ''), 'base64')
      const hash = createHash('md5').update(bytes).digest('hex')
      const mime = r.mime ?? 'application/octet-stream'
      const name =
        r['resource-attributes']?.['file-name'] ?? `${hash}.${mime.split('/')[1] ?? 'bin'}`
      const key = `r${hash}`
      files.set(key, { name, mime, data: new Uint8Array(bytes) })
      media.set(hash, { key, mime, name })
    }

    let enml = String(note.content ?? '')
      .trim()
      .replace(/^<!\[CDATA\[|\]\]>$/g, '')
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<\/?en-note[^>]*>/g, '')
    enml = enml
      .replace(/<en-media\b([^>]*?)\/?>(?:<\/en-media>)?/g, (_m, attrs: string) => {
        const hash = attrs.match(/hash="([0-9a-f]+)"/i)?.[1]?.toLowerCase() ?? ''
        const hit = media.get(hash)
        if (!hit) return ''
        return hit.mime.startsWith('image/')
          ? `<img src="bn-file:${hit.key}" alt="">`
          : `<a href="bn-file:${hit.key}">${hit.name}</a>`
      })
      .replace(/<en-todo\b[^>]*checked="true"[^>]*\/?>(?:<\/en-todo>)?/g, 'BNTODOX ')
      .replace(/<en-todo\b[^>]*\/?>(?:<\/en-todo>)?/g, 'BNTODOO ')
      .replace(/<en-crypt\b[\s\S]*?<\/en-crypt>/g, () => {
        encrypted++
        return '<p><em>[Encrypted text was not imported]</em></p>'
      })

    let markdown = td
      .turndown(enml)
      .split('\n')
      .map((line) =>
        line.replace(
          /^(\s*)(?:[-*]\s+)?BNTODO([XO]) ?/,
          (_m, indent: string, state: string) => `${indent}- [${state === 'X' ? 'x' : ' '}] `,
        ),
      )
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    markdown = `${tagLine(note.tag ?? [])}${markdown}`
    const title = String(note.title ?? '').trim() || 'Untitled'
    nodes.push({
      key: `e${i + 1}`,
      title: title.slice(0, 200),
      level: 0,
      kind: 'file',
      markdown,
      excerpt: excerptOf(markdown),
    })
  })
  if (encrypted)
    warnings.push(`${encrypted} encrypted section${encrypted === 1 ? ' was' : 's were'} left out.`)

  return {
    kind: 'evernote',
    sourceLabel: filename || 'Evernote export',
    suggestedName: stripExt(basename(filename)) || 'Evernote',
    suggestedCategory: 'notebook',
    nodes,
    files,
    warnings,
  }
}

// ---- entry point ----

/** Guess the format when the person didn't say. */
export function detectKind(filename: string, buf: Uint8Array): ImportKind {
  if (/\.enex$/i.test(filename)) return 'evernote'
  const head = decoder.decode(buf.slice(0, 200))
  if (head.includes('<?xml') || head.includes('<en-export')) return 'evernote'
  // read the names only: the filter sees every entry and extracts none
  const names: string[] = []
  try {
    unzipSync(buf, {
      filter: (f) => {
        names.push(f.name)
        return false
      },
    })
  } catch {
    return 'obsidian' // unreadable; the parser will say so
  }
  if (names.some((p) => /(^|\/)\.obsidian\//.test(p))) return 'obsidian'
  if (
    names.some(
      (p) => NOTION_ID.test(stripExt(basename(p))) || /^(Part-\d+|Export-)/i.test(basename(p)),
    )
  ) {
    return 'notion'
  }
  return 'obsidian'
}

export function parseImport(
  kind: ImportKind | 'auto',
  filename: string,
  buf: Uint8Array,
): ParsedImport {
  const k = kind === 'auto' ? detectKind(filename, buf) : kind
  const parsed =
    k === 'notion'
      ? parseNotion(buf, filename)
      : k === 'evernote'
        ? parseEvernote(buf, filename)
        : parseObsidian(buf, filename)
  if (parsed.nodes.length === 0) throw new ImportFormatError('Nothing importable was found.')
  if (parsed.nodes.length > MAX_IMPORT_NODES) {
    parsed.warnings.push(
      `Only the first ${MAX_IMPORT_NODES} of ${parsed.nodes.length} pages are shown; import the rest separately.`,
    )
    parsed.nodes = parsed.nodes.slice(0, MAX_IMPORT_NODES)
  }
  return parsed
}
