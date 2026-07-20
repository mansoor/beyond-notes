import type { Repo } from './repo'

// The internal-link index (tags pattern): links inserted by the @-mention are
// ordinary BlockNote links whose href is the app route /p/<pageId>, so the
// text stays the source of truth and the index is re-derived on every save.

const LINK_HREF_RE = /^\/p\/([A-Za-z0-9_-]{10,})$/

type Node = {
  type?: string
  href?: string
  content?: unknown
  children?: Node[]
  rows?: Array<{ cells?: unknown[] }>
}

/** Target page ids of internal links in a BlockNote document. */
export function extractPageLinks(contentJson: string): string[] {
  let blocks: Node[]
  try {
    const parsed = JSON.parse(contentJson)
    blocks = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  const ids = new Set<string>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const n = node as Node
    if (n.type === 'link' && typeof n.href === 'string') {
      const match = LINK_HREF_RE.exec(n.href)
      if (match?.[1]) ids.add(match[1])
    }
    walk(n.content)
    walk(n.children)
    if (Array.isArray(n.rows)) for (const row of n.rows) walk(row.cells)
  }
  walk(blocks)
  return [...ids]
}

/** Re-index one page's outgoing links after a document write. */
export async function reconcileLinks(repo: Repo, pageId: string, content: string): Promise<void> {
  await repo.setPageLinks(pageId, extractPageLinks(content))
}
