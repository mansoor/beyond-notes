import { nanoid } from 'nanoid'
import { PagesError } from './pages'
import type { MemoRow, PageRow, Repo, SpaceRow, UserRow } from './repo'
import { reconcileTags } from './tags'
import { appendBlocksToContent, makeCheckBlock, makeParagraphBlock, reconcileTasks } from './tasks'

const EMPTY_DOC = '[]'
const DOC_SCHEMA_VERSION = 1
const TASKS_INBOX_KEY = 'inbox' // sentinel dateKey for the per-user tasks-inbox page

export function createDailyService(repo: Repo, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  async function ensureJournalSpace(user: UserRow): Promise<SpaceRow> {
    const existing = await repo.getSpaceByOwnerAndKind(user.id, 'journal')
    if (existing) return existing
    const space: SpaceRow = {
      id: nanoid(),
      name: 'Journal',
      category: 'notebook',
      kind: 'journal',
      ownerId: user.id,
      publicEnabled: false,
      publicMaintenance: false,
      publicHost: null,
      publicTitle: null,
      publicFooter: null,
      publicTheme: 'paper',
      publicAppearance: 'auto',
      publicSocial: '[]',
      publicLogoAttachmentId: null,
      publicTagline: null,
      publicHeaderLayout: 'classic',
      publicTitleSize: 'md',
      publicLogoSize: 'md',
      publicFaviconAttachmentId: null,
      analyticsProvider: 'none',
      analyticsSiteId: null,
      analyticsHost: null,
      lockPolicy: null,
      lockIdleMinutes: null,
      createdAt: now(),
    }
    await repo.insertSpace(space)
    return space
  }

  async function ensurePage(space: SpaceRow, dateKey: string, title: string): Promise<PageRow> {
    // several pages can share a dateKey (topic notes); the MAIN page is always
    // the oldest one — it is created first, before any topic note can exist
    const all = await repo.listPagesByDateKey(space.id, dateKey)
    const existing = all.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
    if (existing) return existing
    const page: PageRow = {
      id: nanoid(),
      spaceId: space.id,
      parentId: null,
      title,
      position: 0,
      dateKey,
      pageType: 'doc',
      slug: null,
      liveVersionId: null,
      galleryLayout: 'grid',
      blogLayout: 'list',
      category: null,
      galleryAutoplaySecs: null,
      shareEnabled: false,
      coverAttachmentId: null,
      metaDescription: null,
      icon: null,
      archivedAt: null,
      archivedBy: null,
      trashedAt: null,
      trashedBy: null,
      lockPolicy: null,
      lockIdleMinutes: null,
      createdAt: now(),
      updatedAt: now(),
    }
    await repo.insertPage(page)
    await repo.insertDocument({
      pageId: page.id,
      content: EMPTY_DOC,
      schemaVersion: DOC_SCHEMA_VERSION,
      updatedAt: now(),
    })
    return page
  }

  async function appendToPage(pageId: string, blocks: ReturnType<typeof makeParagraphBlock>[]) {
    const doc = await repo.getDocument(pageId)
    if (!doc) throw new PagesError('NOT_FOUND', 'Document missing for page.')
    const next = appendBlocksToContent(doc.content, blocks)
    const when = now()
    await repo.updateDocument(pageId, next, when)
    await repo.updatePage(pageId, { updatedAt: when })
    await reconcileTasks(repo, pageId, next, when)
    await reconcileTags(repo, pageId, next)
  }

  return {
    ensureJournalSpace,

    /** Get-or-create the journal page for one date ('YYYY-MM-DD'). */
    async day(user: UserRow, date: string) {
      const space = await ensureJournalSpace(user)
      const page = await ensurePage(space, date, date)
      const doc = await repo.getDocument(page.id)
      if (!doc) throw new PagesError('NOT_FOUND', 'Document missing for page.')
      return { page, doc }
    },

    /**
     * Every note for a date: the main day page first (created on demand),
     * then topic notes in creation order.
     */
    async dayNotes(user: UserRow, date: string) {
      const space = await ensureJournalSpace(user)
      const main = await ensurePage(space, date, date)
      const pages = (await repo.listPagesByDateKey(space.id, date)).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )
      const notes = []
      for (const page of pages) {
        const doc = await repo.getDocument(page.id)
        if (!doc) continue
        notes.push({ page, doc, main: page.id === main.id })
      }
      return notes
    },

    /** An extra named note on a day — personal/work/hobby streams side by side. */
    async createDayNote(user: UserRow, date: string, title: string): Promise<PageRow> {
      const space = await ensureJournalSpace(user)
      await ensurePage(space, date, date) // the main page always exists first
      const siblings = await repo.listPagesByDateKey(space.id, date)
      const page: PageRow = {
        id: nanoid(),
        spaceId: space.id,
        parentId: null,
        title,
        position: siblings.length,
        dateKey: date,
        pageType: 'doc',
        slug: null,
        liveVersionId: null,
        galleryLayout: 'grid',
        blogLayout: 'list',
        category: null,
        galleryAutoplaySecs: null,
        shareEnabled: false,
        coverAttachmentId: null,
        metaDescription: null,
        icon: null,
        archivedAt: null,
        archivedBy: null,
        trashedAt: null,
        trashedBy: null,
        lockPolicy: null,
        lockIdleMinutes: null,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertPage(page)
      await repo.insertDocument({
        pageId: page.id,
        content: EMPTY_DOC,
        schemaVersion: DOC_SCHEMA_VERSION,
        updatedAt: now(),
      })
      return page
    },

    /** Topic notes can go; the main day page cannot (it anchors the date). */
    async deleteDayNote(user: UserRow, pageId: string): Promise<void> {
      const page = await repo.getPage(pageId)
      const space = page ? await repo.getSpace(page.spaceId) : null
      if (!page || !space || space.ownerId !== user.id || space.kind !== 'journal') {
        throw new PagesError('NOT_FOUND', 'Note not found.')
      }
      if (!page.dateKey) throw new PagesError('NOT_FOUND', 'Note not found.')
      const all = await repo.listPagesByDateKey(space.id, page.dateKey)
      const main = all.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
      if (main?.id === page.id) {
        throw new PagesError('BAD_MOVE', 'The main day note cannot be deleted.')
      }
      await repo.deletePage(pageId)
    },

    /** Append a paragraph to the main note of a day (webhooks use this). */
    async appendToDay(user: UserRow, date: string, text: string): Promise<void> {
      const { page } = await this.day(user, date)
      await appendToPage(page.id, [makeParagraphBlock(text)])
    },

    /** Which days of a month ('YYYY-MM') have journal pages — calendar dots. */
    async days(user: UserRow, month: string): Promise<string[]> {
      const space = await repo.getSpaceByOwnerAndKind(user.id, 'journal')
      if (!space) return []
      const pages = await repo.listPagesInSpace(space.id)
      return pages
        .map((p) => p.dateKey)
        .filter((d): d is string => d !== null)
        .filter((d) => d.startsWith(`${month}-`))
        .sort()
    },

    async tasksInboxPage(user: UserRow): Promise<PageRow> {
      const space = await ensureJournalSpace(user)
      return ensurePage(space, TASKS_INBOX_KEY, 'Tasks inbox')
    },

    // ---- memos ----

    async capture(user: UserRow, content: string): Promise<MemoRow> {
      const memo: MemoRow = {
        id: nanoid(),
        userId: user.id,
        content,
        createdAt: now(),
        promotedTo: null,
        promotedAt: null,
      }
      await repo.insertMemo(memo)
      return memo
    },

    async listMemos(user: UserRow): Promise<MemoRow[]> {
      const memos = await repo.listMemos(user.id)
      return memos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200)
    },

    async deleteMemo(user: UserRow, memoId: string): Promise<void> {
      const memo = await repo.getMemo(memoId)
      if (!memo || memo.userId !== user.id) throw new PagesError('NOT_FOUND', 'Memo not found.')
      await repo.deleteMemo(memoId)
    },

    /** Fix a captured note's text. Promoted memos are frozen — edit the target. */
    async updateMemo(user: UserRow, memoId: string, content: string): Promise<void> {
      const memo = await repo.getMemo(memoId)
      if (!memo || memo.userId !== user.id) throw new PagesError('NOT_FOUND', 'Memo not found.')
      if (memo.promotedTo) {
        throw new PagesError('BAD_MOVE', 'This note was already moved — edit it where it landed.')
      }
      await repo.updateMemo(memoId, { content })
    },

    async requireMemo(user: UserRow, memoId: string): Promise<MemoRow> {
      const memo = await repo.getMemo(memoId)
      if (!memo || memo.userId !== user.id) throw new PagesError('NOT_FOUND', 'Memo not found.')
      return memo
    },

    /** Memo → new page at the root of a tree space. */
    async promoteToNote(user: UserRow, memoId: string, spaceId: string): Promise<PageRow> {
      const memo = await this.requireMemo(user, memoId)
      const space = await repo.getSpace(spaceId)
      if (
        !space ||
        (space.ownerId !== null && space.ownerId !== user.id) ||
        space.kind !== 'tree'
      ) {
        throw new PagesError('NOT_FOUND', 'Space not found.')
      }
      const siblings = (await repo.listPagesInSpace(spaceId)).filter((p) => p.parentId === null)
      const title = memo.content.length > 60 ? `${memo.content.slice(0, 57)}…` : memo.content
      const page: PageRow = {
        id: nanoid(),
        spaceId,
        parentId: null,
        title: title.split('\n')[0] ?? 'Untitled',
        position: siblings.length,
        dateKey: null,
        pageType: 'doc',
        slug: null,
        liveVersionId: null,
        galleryLayout: 'grid',
        blogLayout: 'list',
        category: null,
        galleryAutoplaySecs: null,
        shareEnabled: false,
        coverAttachmentId: null,
        metaDescription: null,
        icon: null,
        archivedAt: null,
        archivedBy: null,
        trashedAt: null,
        trashedBy: null,
        lockPolicy: null,
        lockIdleMinutes: null,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertPage(page)
      await repo.insertDocument({
        pageId: page.id,
        content: JSON.stringify([makeParagraphBlock(memo.content)]),
        schemaVersion: DOC_SCHEMA_VERSION,
        updatedAt: now(),
      })
      await repo.markMemoPromoted(memoId, 'note', now())
      return page
    },

    /**
     * Memo → appended to a journal day, stamped with capture time.
     *
     * Both the day and the time come from when the memo was *captured*, not
     * when it is promoted: a thought jotted at 11pm and filed the next morning
     * belongs in last night's entry, under its `23:47 —` stamp. Deriving both
     * from `createdAt` keeps the day and the time telling the same story.
     */
    async promoteToJournal(user: UserRow, memoId: string): Promise<void> {
      const memo = await this.requireMemo(user, memoId)
      const y = memo.createdAt.getFullYear()
      const mo = String(memo.createdAt.getMonth() + 1).padStart(2, '0')
      const d = String(memo.createdAt.getDate()).padStart(2, '0')
      const { page } = await this.day(user, `${y}-${mo}-${d}`)
      const hh = String(memo.createdAt.getHours()).padStart(2, '0')
      const mm = String(memo.createdAt.getMinutes()).padStart(2, '0')
      await appendToPage(page.id, [makeParagraphBlock(`${hh}:${mm} — ${memo.content}`)])
      await repo.markMemoPromoted(memoId, 'journal', now())
    },

    /** Memo → checkbox block in the tasks-inbox page. */
    async promoteToTask(user: UserRow, memoId: string): Promise<void> {
      const memo = await this.requireMemo(user, memoId)
      const inbox = await this.tasksInboxPage(user)
      await appendToPage(inbox.id, [makeCheckBlock(memo.content)])
      await repo.markMemoPromoted(memoId, 'task', now())
    },

    /** Quick-add from the Tasks view; an @YYYY-MM-DD token in the text becomes the due date at index time. */
    async quickAddTask(user: UserRow, text: string): Promise<void> {
      const inbox = await this.tasksInboxPage(user)
      await appendToPage(inbox.id, [makeCheckBlock(text)])
    },
  }
}

export type DailyService = ReturnType<typeof createDailyService>
