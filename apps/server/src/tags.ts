import type { Repo } from './repo'

// The tag index (same shape as the tasks index): inline #tags in the text are
// the source of truth, re-extracted on every save. No separate tagging UI to
// maintain — writing "#work" anywhere IS the organization.

type Block = {
  type?: string
  content?: unknown
  children?: Block[]
}

// letters/digits start; letters/digits/_/- continue; ≤50 chars; lowercased.
// The leading boundary keeps URL fragments ("...page#section") out.
const TAG_RE = /(^|[\s([{])#([\p{L}\p{N}][\p{L}\p{N}_-]{0,49})/gu

/** #tags in plain text (memos, task lines). */
export function extractTagsFromText(text: string): string[] {
  const tags = new Set<string>()
  for (const match of text.matchAll(TAG_RE)) {
    const tag = match[2]?.toLowerCase()
    if (tag) tags.add(tag)
  }
  return [...tags]
}

/** #tags in a BlockNote document. Code blocks are skipped — "#include" is not a tag. */
export function extractTags(contentJson: string): string[] {
  let blocks: Block[]
  try {
    const parsed = JSON.parse(contentJson)
    blocks = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  const tags = new Set<string>()
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block.type !== 'codeBlock') {
        for (const tag of extractTagsFromText(inlineText(block.content))) tags.add(tag)
      }
      if (Array.isArray(block.children)) walk(block.children)
    }
  }
  walk(blocks)
  return [...tags]
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as Array<{ text?: string; content?: unknown }>)
    .map((i) => (typeof i?.text === 'string' ? i.text : inlineText(i?.content)))
    .join(' ')
}

/** Re-index one page's tags after a document write. */
export async function reconcileTags(repo: Repo, pageId: string, content: string): Promise<void> {
  await repo.setPageTags(pageId, extractTags(content))
}
