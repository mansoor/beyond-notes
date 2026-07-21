/**
 * Markdown -> a proposed wiki structure.
 *
 * A README is one long document with a shape a wiki already has: an intro, then
 * sections, then subsections. This turns that shape into a flat, ordered list of
 * proposed pages carrying a nesting level, which the user reviews and edits
 * before anything is written. Nothing here touches the database — planning is a
 * pure function so the review step is cheap, repeatable and testable.
 */

import { slugify } from '@bn/renderer'
import type { ImportNodePlan } from '@bn/schema'

/**
 * How many heading levels become pages: the section level (`##` in a normal
 * README) and one below it. Anything deeper stays inside its page as a heading —
 * a wiki of one-paragraph pages is worse to read than a page with subheadings,
 * and the published page already gets an "on this page" list for those.
 */
const MAX_PAGE_DEPTH = 2
const EXCERPT_CHARS = 160

type Heading = { level: number; title: string; line: number }

/**
 * Heading scan that ignores anything inside a fenced code block — a shell
 * comment (`# install this`) is not a section, and treating it as one splits a
 * page in the middle of a code sample.
 */
export function scanHeadings(lines: string[]): Heading[] {
  const out: Heading[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fenceMatch = line.match(/^\s*(```+|~~~+)/)
    if (fenceMatch) {
      const marker = (fenceMatch[1] ?? '').slice(0, 3)
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      out.push({
        level: (heading[1] ?? '#').length,
        title: cleanTitle(heading[2] ?? ''),
        line: i,
      })
    }
  }
  return out
}

/** Strip the markdown a heading may carry — links, emphasis, code, emoji-ish noise. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTocHeading(title: string): boolean {
  return /^(table of contents|contents|toc|index)$/i.test(title.trim())
}

function excerptOf(markdown: string): string {
  const text = markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('```') && !l.startsWith('|'))
    .join(' ')
    .replace(/[#*_`>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text
}

export type OutlineOptions = {
  /** Where the content came from, for the plan's labels (e.g. 'README.md'). */
  label?: string
  /** Nodes are emitted at this level and deeper (used for /docs subtrees). */
  baseLevel?: number
  /** Prefix for node keys so several files can share one plan. */
  keyPrefix?: string
}

/**
 * Split one markdown document into proposed pages.
 *
 * - a leading `# H1` becomes the document title (not a page — it names the space)
 * - prose before the first section becomes an "Introduction" page
 * - a "Table of contents" section is dropped: the wiki's own nav replaces it
 * - `##` becomes a top-level page and `###` its child; deeper headings stay
 *   inside the page
 */
export function outlineMarkdown(
  markdown: string,
  opts: OutlineOptions = {},
): { title: string | null; nodes: ImportNodePlan[]; warnings: string[] } {
  const base = opts.baseLevel ?? 0
  const prefix = opts.keyPrefix ?? 'n'
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const headings = scanHeadings(lines)
  const warnings: string[] = []

  // a leading H1 titles the whole document rather than becoming a page
  const h1 = headings.find((h) => h.level === 1)
  const docTitle = h1 && h1.line < 5 ? h1.title : null
  const bodyStart = docTitle && h1 ? h1.line + 1 : 0

  // the top section level: H2 in a normal README, but honour documents that
  // only ever use H1, or that start deeper
  const sectionLevels = headings.filter((h) => h.line >= bodyStart).map((h) => h.level)
  const topLevel = sectionLevels.length > 0 ? Math.min(...sectionLevels) : 2

  const pageHeadings = headings.filter(
    (h) => h.line >= bodyStart && h.level >= topLevel && h.level < topLevel + MAX_PAGE_DEPTH,
  )

  const sliceBody = (from: number, to: number) =>
    lines
      .slice(from, to)
      .join('\n')
      .replace(/^\s+|\s+$/g, '')

  const nodes: ImportNodePlan[] = []
  let key = 0
  const nextKey = () => `${prefix}-${++key}`

  // everything before the first section heading is the introduction
  const firstPage = pageHeadings[0]
  const intro = sliceBody(bodyStart, firstPage ? firstPage.line : lines.length)
  if (intro !== '') {
    nodes.push({
      key: nextKey(),
      title: 'Introduction',
      level: base,
      kind: 'intro',
      markdown: intro,
      excerpt: excerptOf(intro),
    })
  }

  for (let idx = 0; idx < pageHeadings.length; idx++) {
    const heading = pageHeadings[idx] as Heading
    const next = pageHeadings[idx + 1]
    const body = sliceBody(heading.line + 1, next ? next.line : lines.length)
    if (isTocHeading(heading.title)) {
      warnings.push(`Skipped "${heading.title}" — the wiki's own navigation replaces it.`)
      continue
    }
    nodes.push({
      key: nextKey(),
      title: heading.title || 'Untitled',
      level: base + (heading.level - topLevel),
      kind: 'section',
      anchor: slugify(heading.title),
      markdown: body,
      excerpt: excerptOf(body),
    })
  }

  if (nodes.length === 0 && markdown.trim() !== '') {
    // no headings at all: one page holding the whole document
    nodes.push({
      key: nextKey(),
      title: docTitle ?? opts.label ?? 'Imported page',
      level: base,
      kind: 'intro',
      markdown: markdown.trim(),
      excerpt: excerptOf(markdown),
    })
  }

  return { title: docTitle, nodes, warnings }
}

/**
 * Repair a level sequence so it can always be turned into a tree: a node may sit
 * one level deeper than the one before it, never more. The review UI enforces
 * this too, but a hand-edited plan arriving over the wire must not be trusted.
 */
export function normalizeLevels(nodes: ImportNodePlan[]): ImportNodePlan[] {
  let prev = -1
  return nodes.map((node) => {
    const level = Math.max(0, Math.min(node.level, prev + 1))
    prev = level
    return { ...node, level }
  })
}

/**
 * Rewrite in-document anchor links (`[Quick start](#quick-start)`) to point at
 * the page that section became. Called after the pages exist, so the ids are
 * known. Anchors with no matching page are left alone — a dead in-page link is
 * better than a link to the wrong page.
 */
export function rewriteAnchors(markdown: string, anchorToPath: Map<string, string>): string {
  return markdown.replace(/\]\(#([^)\s]+)\)/g, (whole, anchor: string) => {
    const target = anchorToPath.get(anchor.toLowerCase())
    return target ? `](${target})` : whole
  })
}
