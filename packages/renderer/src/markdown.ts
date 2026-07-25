// BlockNote block JSON <-> Markdown. The serializer is faithful; the parser is
// deliberately pragmatic — headings, lists, checkboxes, quotes, code fences,
// images, and common inline marks cover real personal notes. Anything it
// doesn't recognize survives as a plain paragraph, never lost.

type InlineItem = {
  type: 'text' | 'link'
  text?: string
  href?: string
  content?: InlineItem[]
  styles?: Record<string, boolean>
}

type TableCell = { type: 'tableCell'; props: Record<string, unknown>; content: InlineItem[] }
type TableContent = {
  type: 'tableContent'
  columnWidths: (number | undefined)[]
  headerRows?: number
  rows: { cells: TableCell[] }[]
}

type Block = {
  id: string
  type: string
  props: Record<string, unknown>
  content: InlineItem[] | TableContent
  children: Block[]
}

/** A table block's content is an object, not an inline array. */
export function tableContentOf(content: unknown): TableContent | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  const c = content as TableContent
  return c.type === 'tableContent' && Array.isArray(c.rows) ? c : null
}

function cellsOf(row: { cells: unknown }): TableCell[] {
  if (!Array.isArray(row?.cells)) return []
  // BlockNote accepts both shapes: a cell object, or bare inline content
  return row.cells.map((cell) =>
    Array.isArray(cell)
      ? { type: 'tableCell' as const, props: {}, content: cell as InlineItem[] }
      : (cell as TableCell),
  )
}

// ---- serialize: blocks -> markdown ----

function inlineToMd(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const item of content as InlineItem[]) {
    if (item?.type === 'link') {
      out += `[${inlineToMd(item.content)}](${item.href ?? ''})`
      continue
    }
    if (typeof item?.text === 'string') {
      let text = item.text
      const styles = item.styles ?? {}
      if (styles.code) text = `\`${text}\``
      if (styles.bold) text = `**${text}**`
      if (styles.italic) text = `*${text}*`
      if (styles.strike) text = `~~${text}~~`
      out += text
    }
  }
  return out
}

function blockToMd(block: Block, indent: string, ordinal: number): string[] {
  const lines: string[] = []
  const inner = inlineToMd(block.content)
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(block.props?.level) || 1, 1), 6)
      lines.push(`${'#'.repeat(level)} ${inner}`)
      break
    }
    case 'bulletListItem':
      lines.push(`${indent}- ${inner}`)
      break
    case 'numberedListItem':
      lines.push(`${indent}${ordinal}. ${inner}`)
      break
    case 'checkListItem':
      lines.push(`${indent}- [${block.props?.checked === true ? 'x' : ' '}] ${inner}`)
      break
    case 'quote':
      lines.push(`> ${inner}`)
      break
    case 'codeBlock': {
      const language = typeof block.props?.language === 'string' ? block.props.language : ''
      const code = Array.isArray(block.content)
        ? block.content.map((i) => (typeof i?.text === 'string' ? i.text : '')).join('')
        : ''
      lines.push(`\`\`\`${language}`, ...code.split('\n'), '```')
      break
    }
    case 'image': {
      const url = typeof block.props?.url === 'string' ? block.props.url : ''
      const caption = typeof block.props?.caption === 'string' ? block.props.caption : ''
      if (url) lines.push(`![${caption}](${url})`)
      break
    }
    case 'table': {
      const table = tableContentOf(block.content)
      if (!table || table.rows.length === 0) break
      const rows = table.rows.map((row) =>
        cellsOf(row).map((cell) => inlineToMd(cell.content).replace(/\|/g, '\\|').trim()),
      )
      const width = Math.max(...rows.map((r) => r.length))
      const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
      const [head, ...body] = rows
      lines.push(`| ${pad(head ?? []).join(' | ')} |`)
      lines.push(`|${' --- |'.repeat(width)}`)
      for (const row of body) lines.push(`| ${pad(row).join(' | ')} |`)
      break
    }
    default:
      if (inner) lines.push(indent ? `${indent}${inner}` : inner)
  }
  return lines
}

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])

function blocksToMd(blocks: Block[], indent = ''): string[] {
  const lines: string[] = []
  let ordinal = 0
  for (const block of blocks) {
    if (!block) continue
    ordinal = block.type === 'numberedListItem' ? ordinal + 1 : 0
    const isList = LIST_TYPES.has(block.type)
    const rendered = blockToMd(block, isList ? indent : '', Math.max(ordinal, 1))
    // blank line between top-level blocks, none inside a list run
    if (lines.length > 0 && !(isList && lines[lines.length - 1]?.match(/^\s*(-|\d+\.)/))) {
      lines.push('')
    }
    lines.push(...rendered)
    if (Array.isArray(block.children) && block.children.length > 0) {
      lines.push(...blocksToMd(block.children, `${indent}  `))
    }
  }
  return lines
}

export function blocknoteToMarkdown(contentJson: string): string {
  let blocks: Block[]
  try {
    const parsed = JSON.parse(contentJson)
    blocks = Array.isArray(parsed) ? parsed : []
  } catch {
    return ''
  }
  return `${blocksToMd(blocks)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

// ---- parse: markdown -> blocks ----

function parseInline(text: string): InlineItem[] {
  const items: InlineItem[] = []
  // links first, then marks inside the remaining plain segments
  const linkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g
  let last = 0
  let m = linkRe.exec(text)
  while (m) {
    if (m.index > last) items.push(...parseMarks(text.slice(last, m.index)))
    items.push({ type: 'link', href: m[2] ?? '', content: parseMarks(m[1] ?? '') })
    last = m.index + m[0].length
    m = linkRe.exec(text)
  }
  if (last < text.length) items.push(...parseMarks(text.slice(last)))
  return items
}

function parseMarks(text: string): InlineItem[] {
  const items: InlineItem[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|~~([^~]+)~~)/g
  let last = 0
  let m = re.exec(text)
  while (m) {
    if (m.index > last) items.push({ type: 'text', text: text.slice(last, m.index), styles: {} })
    if (m[2] !== undefined) items.push({ type: 'text', text: m[2], styles: { bold: true } })
    else if (m[3] !== undefined) items.push({ type: 'text', text: m[3], styles: { italic: true } })
    else if (m[4] !== undefined) items.push({ type: 'text', text: m[4], styles: { code: true } })
    else if (m[5] !== undefined) items.push({ type: 'text', text: m[5], styles: { strike: true } })
    last = m.index + m[0].length
    m = re.exec(text)
  }
  if (last < text.length) items.push({ type: 'text', text: text.slice(last), styles: {} })
  return items
}

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_DIVIDER = /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/

/** `| a | b |` -> ['a','b'], honouring \| escapes. */
function splitRow(line: string): string[] {
  const inner = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim())
}

export function markdownToBlocks(markdown: string): unknown[] {
  const blocks: Block[] = []
  let nextId = 0
  const id = () => `md-${++nextId}`
  const make = (type: string, props: Record<string, unknown>, content: InlineItem[]): Block => ({
    id: id(),
    type,
    props,
    content,
    children: [],
  })

  const lines = markdown.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i++
      continue
    }

    const fence = line.match(/^```(\S*)\s*$/)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').match(/^```\s*$/)) {
        code.push(lines[i] ?? '')
        i++
      }
      i++ // closing fence
      blocks.push(
        make('codeBlock', { language: fence[1] ?? '' }, [
          { type: 'text', text: code.join('\n'), styles: {} },
        ]),
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      // the editor renders levels 1-3; deeper markdown headings clamp to 3
      const level = Math.min((heading[1] ?? '#').length, 3)
      blocks.push(make('heading', { level }, parseInline(heading[2] ?? '')))
      i++
      continue
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
    if (image) {
      blocks.push(make('image', { url: image[2] ?? '', caption: image[1] ?? '' }, []))
      i++
      continue
    }

    // a pipe table: a header row, an |---|---| separator, then body rows
    if (line.match(TABLE_ROW) && (lines[i + 1] ?? '').match(TABLE_DIVIDER)) {
      const rows: string[][] = [splitRow(line)]
      i += 2 // header + divider
      while (i < lines.length && (lines[i] ?? '').match(TABLE_ROW)) {
        rows.push(splitRow(lines[i] ?? ''))
        i++
      }
      const width = Math.max(...rows.map((r) => r.length))
      blocks.push({
        id: id(),
        type: 'table',
        props: { textColor: 'default', backgroundColor: 'default' },
        content: {
          type: 'tableContent',
          columnWidths: Array.from({ length: width }, () => undefined),
          headerRows: 1,
          rows: rows.map((cells) => ({
            cells: Array.from({ length: width }, (_, c) => ({
              type: 'tableCell' as const,
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left',
                colspan: 1,
                rowspan: 1,
              },
              content: parseInline(cells[c] ?? ''),
            })),
          })),
        },
        children: [],
      })
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      blocks.push(make('quote', {}, parseInline(quote[1] ?? '')))
      i++
      continue
    }

    const check = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/)
    if (check) {
      blocks.push(
        make(
          'checkListItem',
          { checked: (check[1] ?? '').toLowerCase() === 'x' },
          parseInline(check[2] ?? ''),
        ),
      )
      i++
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      blocks.push(make('bulletListItem', {}, parseInline(bullet[1] ?? '')))
      i++
      continue
    }

    const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
    if (numbered) {
      blocks.push(make('numberedListItem', {}, parseInline(numbered[1] ?? '')))
      i++
      continue
    }

    // paragraph: greedily join soft-wrapped lines until a blank or structure
    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const next = lines[i] ?? ''
      if (next.trim() === '' || next.match(/^(#{1,6}\s|```|>\s?|\s*[-*]\s|\s*\d+\.\s|!\[|\s*\|)/)) {
        break
      }
      para.push(next)
      i++
    }
    blocks.push(make('paragraph', {}, parseInline(para.join(' '))))
  }
  return blocks
}

/**
 * Concatenate two BlockNote documents for a page merge: the target's blocks,
 * then the source's title as an H2 (so a folded section keeps its heading and
 * nothing reads as if it were silently glued on), then the source's blocks.
 * Malformed JSON on either side is treated as empty. Mirrors the GitHub/markdown
 * import's `foldMergedNodes`, but at the block level since these pages already
 * exist as documents.
 */
export function mergeDocuments(
  targetJson: string,
  sourceTitle: string,
  sourceJson: string,
): string {
  const parse = (j: string): unknown[] => {
    try {
      const p = JSON.parse(j)
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  }
  const heading = sourceTitle.trim() ? markdownToBlocks(`## ${sourceTitle.trim()}`) : []
  return JSON.stringify([...parse(targetJson), ...heading, ...parse(sourceJson)])
}
