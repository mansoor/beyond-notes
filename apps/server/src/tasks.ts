import { nanoid } from 'nanoid'
import { PagesError } from './pages'
import type { Repo, TaskRow, UserRow } from './repo'

// ---- BlockNote document helpers (pure functions over the block JSON) ----

type Block = {
  id?: string
  type?: string
  props?: Record<string, unknown>
  content?: unknown
  children?: Block[]
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((item: any) => {
      if (typeof item?.text === 'string') return item.text
      if (item?.content) return inlineText(item.content)
      return ''
    })
    .join('')
}

const DUE_TOKEN = /@(\d{4}-\d{2}-\d{2})\b/

export type ExtractedTask = { blockId: string; text: string; checked: boolean; due: string | null }

/** Walk a BlockNote document and collect every checkbox block, in document order. */
export function extractTasks(content: string): ExtractedTask[] {
  let blocks: Block[]
  try {
    const parsed = JSON.parse(content)
    blocks = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  const found: ExtractedTask[] = []
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block?.type === 'checkListItem' && typeof block.id === 'string') {
        const text = inlineText(block.content).trim()
        const due = DUE_TOKEN.exec(text)?.[1] ?? null
        found.push({ blockId: block.id, text, checked: block.props?.checked === true, due })
      }
      if (Array.isArray(block?.children) && block.children.length > 0) walk(block.children)
    }
  }
  walk(blocks)
  return found
}

/** Set the checked prop of one block, returning the new document or null if absent. */
export function setBlockChecked(content: string, blockId: string, checked: boolean): string | null {
  const blocks = JSON.parse(content) as Block[]
  let hit = false
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block?.id === blockId && block.type === 'checkListItem') {
        block.props = { ...block.props, checked }
        hit = true
      }
      if (Array.isArray(block?.children)) walk(block.children)
    }
  }
  walk(blocks)
  return hit ? JSON.stringify(blocks) : null
}

export function makeParagraphBlock(text: string): Block {
  return {
    id: nanoid(),
    type: 'paragraph',
    props: {},
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  }
}

export function makeCheckBlock(text: string): Block {
  return {
    id: nanoid(),
    type: 'checkListItem',
    props: { checked: false },
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  }
}

export function appendBlocksToContent(content: string, blocks: Block[]): string {
  let existing: Block[]
  try {
    const parsed = JSON.parse(content)
    existing = Array.isArray(parsed) ? parsed : []
  } catch {
    existing = []
  }
  return JSON.stringify([...existing, ...blocks])
}

// ---- index reconciliation ----

/**
 * Diff the checkbox blocks of a freshly-saved document against the tasks
 * index. Called on every document write (editor saves and server-side edits),
 * which is what keeps "the block is the source of truth" true.
 */
export async function reconcileTasks(
  repo: Repo,
  pageId: string,
  content: string,
  now: Date,
): Promise<void> {
  const found = extractTasks(content)
  const existing = await repo.listTasksForPage(pageId)
  const existingById = new Map(existing.map((t) => [t.blockId, t]))
  const seen = new Set<string>()

  for (let i = 0; i < found.length; i++) {
    const task = found[i]
    if (!task) continue
    seen.add(task.blockId)
    const row = existingById.get(task.blockId)
    if (!row) {
      await repo.insertTask({
        id: `${pageId}:${task.blockId}`,
        pageId,
        blockId: task.blockId,
        text: task.text,
        checked: task.checked,
        due: task.due,
        position: i,
        updatedAt: now,
      })
    } else if (
      row.text !== task.text ||
      row.checked !== task.checked ||
      row.due !== task.due ||
      row.position !== i
    ) {
      await repo.updateTask(row.id, {
        text: task.text,
        checked: task.checked,
        due: task.due,
        position: i,
        updatedAt: now,
      })
    }
  }

  for (const row of existing) {
    if (!seen.has(row.blockId)) await repo.deleteTask(row.id)
  }
}

// ---- agenda service ----

export function createTasksService(repo: Repo, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  return {
    /** Every task on a page the user can see, with page/space context. */
    async agenda(user: UserRow) {
      const [tasks, spaces] = await Promise.all([repo.listAllTasks(), repo.listSpaces()])
      const accessible = new Map(
        spaces.filter((s) => s.ownerId === null || s.ownerId === user.id).map((s) => [s.id, s]),
      )
      const result = []
      for (const task of tasks.sort((a, b) => a.position - b.position)) {
        const page = await repo.getPage(task.pageId)
        if (!page || page.archivedAt) continue // archived pages take their tasks with them
        const space = accessible.get(page.spaceId)
        if (!space) continue
        result.push({ task, page, space })
      }
      return result
    },

    /** Check/uncheck from the agenda: mutates the block, then reindexes. */
    async toggle(user: UserRow, taskId: string, checked: boolean): Promise<void> {
      const task = await repo.getTask(taskId)
      if (!task) throw new PagesError('NOT_FOUND', 'Task not found.')
      const page = await repo.getPage(task.pageId)
      const space = page ? await repo.getSpace(page.spaceId) : null
      if (!page || !space || (space.ownerId !== null && space.ownerId !== user.id)) {
        throw new PagesError('NOT_FOUND', 'Task not found.')
      }
      const doc = await repo.getDocument(page.id)
      if (!doc) throw new PagesError('NOT_FOUND', 'Document missing for page.')
      const next = setBlockChecked(doc.content, task.blockId, checked)
      if (next === null) {
        // index out of sync with the document — heal by reindexing
        await reconcileTasks(repo, page.id, doc.content, now())
        throw new PagesError('CONFLICT', 'Task block no longer exists. Refresh the list.')
      }
      const when = now()
      await repo.updateDocument(page.id, next, when)
      await repo.updatePage(page.id, { updatedAt: when })
      await reconcileTasks(repo, page.id, next, when)
    },
  }
}

export type TasksService = ReturnType<typeof createTasksService>
