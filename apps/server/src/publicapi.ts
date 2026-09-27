/**
 * The public API's core: what a personal access token can do, shared by the
 * REST routes (/api/v1) and the MCP server (/api/mcp) so both behave the same.
 *
 * Content goes in and out as Markdown. Visibility follows the app exactly
 * (household spaces for everyone, personal spaces for their owner), and a
 * token counts as a session with nothing unlocked: a locked notebook or page
 * keeps its title in listings but its content can't be read or changed. The
 * tRPC middleware normally guards writes against locks, and none of this goes
 * through tRPC, so every read and write here checks for itself.
 */
import { blocknoteToMarkdown, dedupeBlockIds, markdownToBlocks, plainText } from '@bn/renderer'
import type { DailyService } from './daily'
import { type LockService, LockedError } from './locks'
import { PagesError, type PagesService } from './pages'
import type { PageRow, Repo, UserRow } from './repo'
import type { TasksService } from './tasks'

export class ApiError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'LOCKED' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
  }
}

/** Translate the services' own errors into the API's small vocabulary. */
function translate(err: unknown): never {
  if (err instanceof ApiError) throw err
  if (err instanceof LockedError) {
    throw new ApiError('LOCKED', 'That page is locked. Unlock it in the app to use it.')
  }
  if (err instanceof PagesError) {
    const code =
      err.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : err.code === 'CONFLICT'
          ? 'CONFLICT'
          : err.code === 'FORBIDDEN'
            ? 'FORBIDDEN'
            : 'BAD_REQUEST'
    throw new ApiError(code, err.message)
  }
  throw err
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export function createPublicApi(deps: {
  repo: Repo
  pages: PagesService
  daily: DailyService
  tasks: TasksService
  locks: LockService
  now?: () => Date
}) {
  const { repo, pages, daily, tasks, locks } = deps
  const now = deps.now ?? (() => new Date())

  /** The page, if this person may see it and it isn't locked. */
  async function openPage(user: UserRow, pageId: string): Promise<PageRow> {
    const page = await repo.getPage(pageId)
    if (!page) throw new ApiError('NOT_FOUND', 'No such page.')
    try {
      await locks.assertPageOpen(null, page)
      await pages.getPage(user, pageId) // the visibility check
    } catch (err) {
      translate(err)
    }
    return page
  }

  /** Replace or extend a page's content with Markdown, through the same save
   *  path as the editor (so tasks, tags and links are re-indexed). */
  async function writeMarkdown(
    user: UserRow,
    pageId: string,
    markdown: string,
    mode: 'replace' | 'append',
  ): Promise<string> {
    try {
      const { doc } = await pages.getPage(user, pageId)
      let blocks = markdownToBlocks(markdown)
      if (mode === 'append') {
        const existing = JSON.parse(doc.content) as Array<{ id?: string }>
        const seen = new Set(existing.map((b) => b.id).filter((id): id is string => Boolean(id)))
        blocks = [...existing, ...dedupeBlockIds(blocks, seen)]
      }
      const saved = await pages.saveDocument(user, {
        pageId,
        content: JSON.stringify(blocks),
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })
      return saved.updatedAt
    } catch (err) {
      translate(err)
    }
  }

  async function journalPage(user: UserRow, date: string) {
    const { page } = await daily.day(user, date)
    try {
      await locks.assertPageOpen(null, page)
    } catch (err) {
      translate(err)
    }
    return page
  }

  const api = {
    today(): string {
      return localDateKey(now())
    },

    me(user: UserRow) {
      return { id: user.id, name: user.name, email: user.email, role: user.role }
    },

    async spaces(user: UserRow) {
      const rows = await pages.listSpaces(user)
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.category,
        personal: s.ownerId !== null,
        locked: s.lockPolicy !== null,
      }))
    },

    /** Titles travel even when locked (as in the app); content does not. */
    async pages(user: UserRow, spaceId: string) {
      try {
        const [rows, hidden] = await Promise.all([
          pages.tree(user, spaceId),
          locks.hiddenPageIds(null, user),
        ])
        return rows.map((p) => ({
          id: p.id,
          parentId: p.parentId,
          title: p.title,
          position: p.position,
          locked: hidden.has(p.id),
        }))
      } catch (err) {
        translate(err)
      }
    },

    async readPage(user: UserRow, pageId: string) {
      await openPage(user, pageId)
      const { page, doc } = await pages.getPage(user, pageId)
      return {
        id: page.id,
        spaceId: page.spaceId,
        parentId: page.parentId,
        title: page.title,
        markdown: blocknoteToMarkdown(doc.content),
        updatedAt: doc.updatedAt.toISOString(),
      }
    },

    async createPage(
      user: UserRow,
      input: { spaceId: string; parentId?: string | null; title: string; markdown?: string },
    ) {
      const space = await repo.getSpace(input.spaceId)
      if (!space) throw new ApiError('NOT_FOUND', 'No such space.')
      if (space.lockPolicy) {
        throw new ApiError('LOCKED', 'That space is locked. Unlock it in the app to use it.')
      }
      if (input.parentId) await openPage(user, input.parentId)
      let page: PageRow
      try {
        page = await pages.createPage(user, {
          spaceId: input.spaceId,
          parentId: input.parentId ?? null,
          title: input.title,
        })
      } catch (err) {
        translate(err)
      }
      if (input.markdown?.trim()) await writeMarkdown(user, page.id, input.markdown, 'replace')
      return api.readPage(user, page.id)
    },

    async updatePage(
      user: UserRow,
      pageId: string,
      input: { title?: string; markdown?: string; mode?: 'replace' | 'append' },
    ) {
      await openPage(user, pageId)
      if (input.title !== undefined) {
        const title = input.title.trim()
        if (!title) throw new ApiError('BAD_REQUEST', 'A title cannot be empty.')
        try {
          await pages.renamePage(user, pageId, title)
        } catch (err) {
          translate(err)
        }
      }
      if (input.markdown !== undefined) {
        await writeMarkdown(user, pageId, input.markdown, input.mode ?? 'replace')
      }
      return api.readPage(user, pageId)
    },

    async search(user: UserRow, query: string) {
      const q = query.trim()
      if (q.length < 2) throw new ApiError('BAD_REQUEST', 'Search for at least 2 characters.')
      const [found, memos, spaces, hidden] = await Promise.all([
        repo.searchPages(q),
        repo.searchMemos(user.id, q),
        repo.listSpaces(),
        locks.hiddenPageIds(null, user),
      ])
      const visible = new Map(
        spaces.filter((s) => s.ownerId === null || s.ownerId === user.id).map((s) => [s.id, s]),
      )
      const needle = q.toLowerCase()
      const results: Array<{
        kind: 'page' | 'inbox'
        id: string
        title: string
        where: string
        snippet: string
      }> = []
      for (const { page, content } of found) {
        const space = visible.get(page.spaceId)
        if (!space || hidden.has(page.id) || page.trashedAt) continue
        const text = plainText(content)
        const idx = text.toLowerCase().indexOf(needle)
        results.push({
          kind: 'page',
          id: page.id,
          title: page.title,
          where: space.kind === 'journal' ? 'Journal' : space.name,
          snippet: idx >= 0 ? text.slice(Math.max(0, idx - 60), idx + 120) : text.slice(0, 160),
        })
      }
      for (const memo of memos) {
        results.push({
          kind: 'inbox',
          id: memo.id,
          title: memo.content.slice(0, 80),
          where: 'Inbox',
          snippet: memo.content.slice(0, 200),
        })
      }
      return results.slice(0, 30)
    },

    async readJournal(user: UserRow, date: string) {
      const page = await journalPage(user, date)
      const { doc } = await pages.getPage(user, page.id)
      return { date, pageId: page.id, markdown: blocknoteToMarkdown(doc.content) }
    },

    async appendJournal(user: UserRow, date: string, markdown: string) {
      if (!markdown.trim()) throw new ApiError('BAD_REQUEST', 'Nothing to add.')
      const page = await journalPage(user, date)
      await writeMarkdown(user, page.id, markdown, 'append')
      return api.readJournal(user, date)
    },

    async tasks(user: UserRow, opts: { includeDone?: boolean } = {}) {
      const [rows, hidden] = await Promise.all([
        tasks.agenda(user),
        locks.hiddenPageIds(null, user),
      ])
      return rows
        .filter(({ task, page }) => !hidden.has(page.id) && (opts.includeDone || !task.checked))
        .map(({ task, page, space }) => ({
          id: task.id,
          text: task.text,
          done: task.checked,
          due: task.due,
          pageId: page.id,
          pageTitle: page.title,
          where: space.kind === 'journal' ? 'Journal' : space.name,
        }))
    },

    /** Lands in the Tasks inbox; a trailing @YYYY-MM-DD sets the due date. */
    async addTask(user: UserRow, text: string) {
      const t = text.trim()
      if (!t) throw new ApiError('BAD_REQUEST', 'A task needs some text.')
      await daily.quickAddTask(user, t.slice(0, 500))
      return { ok: true as const }
    },

    async capture(user: UserRow, text: string) {
      const t = text.trim()
      if (!t) throw new ApiError('BAD_REQUEST', 'Nothing to capture.')
      const memo = await daily.capture(user, t.slice(0, 5000))
      return { id: memo.id }
    },
  }
  return api
}

export type PublicApi = ReturnType<typeof createPublicApi>
