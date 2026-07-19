import { and, eq, isNull, sql as sqlOp } from 'drizzle-orm'
import type { AppDb } from './db'

export type UserRow = {
  id: string
  email: string
  name: string
  passwordHash: string
  role: 'admin' | 'member'
  totpSecret: string | null
  totpEnabled: boolean
  recoveryCodes: string | null
  emailNotifications: boolean
  createdAt: Date
}

export type SessionRow = {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
}

export type ResetTokenRow = {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
  usedAt: Date | null
}

export type SpaceRow = {
  id: string
  name: string
  category: 'notebook' | 'wiki' | 'site'
  kind: 'tree' | 'journal'
  ownerId: string | null
  publicEnabled: boolean
  publicHost: string | null
  publicTitle: string | null
  publicFooter: string | null
  publicTheme: 'paper' | 'ink' | 'mist' | 'sand'
  createdAt: Date
}

export type PageRow = {
  id: string
  spaceId: string
  parentId: string | null
  title: string
  position: number
  dateKey: string | null
  pageType: 'doc' | 'blog' | 'gallery'
  slug: string | null
  liveVersionId: string | null
  createdAt: Date
  updatedAt: Date
}

export type PageVersionRow = {
  id: string
  pageId: string
  version: number
  title: string
  slug: string
  content: string
  html: string
  textPlain: string
  attachmentIds: string
  createdBy: string
  createdAt: Date
}

export type AttachmentRow = {
  id: string
  hash: string
  filename: string
  mime: string
  size: number
  width: number | null
  height: number | null
  createdBy: string
  createdAt: Date
}

export type GalleryItemRow = {
  id: string
  pageId: string
  attachmentId: string
  position: number
  caption: string
}

export type ReminderRow = {
  id: string
  userId: string
  title: string
  dueDate: string
  dueTime: string | null
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
  interval: number
  headsUpDays: number | null
  completedAt: Date | null
  createdAt: Date
}

export type JobRow = {
  id: string
  type: string
  refId: string
  payload: string
  runAt: Date
  status: 'pending' | 'running' | 'done' | 'failed'
  attempts: number
  lastError: string | null
  createdAt: Date
}

export type MemoRow = {
  id: string
  userId: string
  content: string
  createdAt: Date
  promotedTo: 'note' | 'journal' | 'task' | null
  promotedAt: Date | null
}

export type TaskRow = {
  id: string
  pageId: string
  blockId: string
  text: string
  checked: boolean
  due: string | null
  position: number
  updatedAt: Date
}

export type DocumentRow = {
  pageId: string
  content: string
  schemaVersion: number
  updatedAt: Date
}

export type InviteRow = {
  id: string
  tokenHash: string
  suggestedEmail: string | null
  role: 'admin' | 'member'
  createdBy: string
  createdAt: Date
  expiresAt: Date
  usedAt: Date | null
  usedBy: string | null
  revokedAt: Date | null
}

// One implementation serves both dialects: the drizzle runtime API is uniform
// for the portable SQL this repo restricts itself to (see TECH-PLAN, database
// section). Types are enforced at this boundary, not inside the queries.
export function createRepo(appDb: AppDb) {
  const db = appDb.db
  const t = appDb.tables as any

  return {
    async countUsers(): Promise<number> {
      const rows = await db.select({ id: t.users.id }).from(t.users)
      return rows.length
    },

    async getUserByEmail(email: string): Promise<UserRow | null> {
      const rows = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1)
      return rows[0] ?? null
    },

    async getUserById(id: string): Promise<UserRow | null> {
      const rows = await db.select().from(t.users).where(eq(t.users.id, id)).limit(1)
      return rows[0] ?? null
    },

    async insertUser(user: UserRow): Promise<void> {
      await db.insert(t.users).values(user)
    },

    async listUsers(): Promise<UserRow[]> {
      return db.select().from(t.users)
    },

    async updateUser(
      id: string,
      patch: Partial<
        Pick<
          UserRow,
          | 'passwordHash'
          | 'totpSecret'
          | 'totpEnabled'
          | 'recoveryCodes'
          | 'name'
          | 'emailNotifications'
        >
      >,
    ): Promise<void> {
      await db.update(t.users).set(patch).where(eq(t.users.id, id))
    },

    async insertResetToken(row: ResetTokenRow): Promise<void> {
      await db.insert(t.passwordResetTokens).values(row)
    },

    async getResetToken(id: string): Promise<ResetTokenRow | null> {
      const rows = await db
        .select()
        .from(t.passwordResetTokens)
        .where(eq(t.passwordResetTokens.id, id))
        .limit(1)
      return rows[0] ?? null
    },

    /** CAS: only one caller can consume a token, even under a double-click. */
    async markResetTokenUsed(id: string, when: Date): Promise<boolean> {
      const rows = await db
        .update(t.passwordResetTokens)
        .set({ usedAt: when })
        .where(and(eq(t.passwordResetTokens.id, id), isNull(t.passwordResetTokens.usedAt)))
        .returning({ id: t.passwordResetTokens.id })
      return rows.length === 1
    },

    async deleteResetTokensForUser(userId: string): Promise<void> {
      await db.delete(t.passwordResetTokens).where(eq(t.passwordResetTokens.userId, userId))
    },

    async insertSession(session: SessionRow): Promise<void> {
      await db.insert(t.sessions).values(session)
    },

    async listSessionsForUser(userId: string): Promise<SessionRow[]> {
      return db.select().from(t.sessions).where(eq(t.sessions.userId, userId))
    },

    async getSession(id: string): Promise<SessionRow | null> {
      const rows = await db.select().from(t.sessions).where(eq(t.sessions.id, id)).limit(1)
      return rows[0] ?? null
    },

    async deleteSession(id: string): Promise<void> {
      await db.delete(t.sessions).where(eq(t.sessions.id, id))
    },

    async insertInvite(invite: InviteRow): Promise<void> {
      await db.insert(t.invites).values(invite)
    },

    async getInviteByTokenHash(tokenHash: string): Promise<InviteRow | null> {
      const rows = await db
        .select()
        .from(t.invites)
        .where(eq(t.invites.tokenHash, tokenHash))
        .limit(1)
      return rows[0] ?? null
    },

    async listInvites(): Promise<InviteRow[]> {
      return db.select().from(t.invites)
    },

    async markInviteUsed(id: string, userId: string, when: Date): Promise<void> {
      await db
        .update(t.invites)
        .set({ usedAt: when, usedBy: userId })
        .where(and(eq(t.invites.id, id), isNull(t.invites.usedAt)))
    },

    async revokeInvite(id: string, when: Date): Promise<void> {
      await db
        .update(t.invites)
        .set({ revokedAt: when })
        .where(and(eq(t.invites.id, id), isNull(t.invites.usedAt)))
    },

    // ---- spaces ----

    async insertSpace(space: SpaceRow): Promise<void> {
      await db.insert(t.spaces).values(space)
    },

    async getSpace(id: string): Promise<SpaceRow | null> {
      const rows = await db.select().from(t.spaces).where(eq(t.spaces.id, id)).limit(1)
      return rows[0] ?? null
    },

    async listSpaces(): Promise<SpaceRow[]> {
      return db.select().from(t.spaces)
    },

    async renameSpace(id: string, name: string): Promise<void> {
      await db.update(t.spaces).set({ name }).where(eq(t.spaces.id, id))
    },

    async deleteSpace(id: string): Promise<void> {
      await db.delete(t.spaces).where(eq(t.spaces.id, id))
    },

    // ---- pages ----

    async insertPage(page: PageRow): Promise<void> {
      await db.insert(t.pages).values(page)
    },

    async getPage(id: string): Promise<PageRow | null> {
      const rows = await db.select().from(t.pages).where(eq(t.pages.id, id)).limit(1)
      return rows[0] ?? null
    },

    async listPagesInSpace(spaceId: string): Promise<PageRow[]> {
      return db.select().from(t.pages).where(eq(t.pages.spaceId, spaceId))
    },

    async updatePage(
      id: string,
      patch: Partial<
        Pick<
          PageRow,
          'title' | 'parentId' | 'position' | 'updatedAt' | 'spaceId' | 'pageType' | 'slug'
        >
      >,
    ): Promise<void> {
      await db.update(t.pages).set(patch).where(eq(t.pages.id, id))
    },

    async deletePage(id: string): Promise<void> {
      // FK cascade removes the subtree and documents on both dialects
      await db.delete(t.pages).where(eq(t.pages.id, id))
    },

    // ---- documents ----

    async insertDocument(doc: DocumentRow): Promise<void> {
      await db.insert(t.documents).values(doc)
    },

    async getDocument(pageId: string): Promise<DocumentRow | null> {
      const rows = await db
        .select()
        .from(t.documents)
        .where(eq(t.documents.pageId, pageId))
        .limit(1)
      return rows[0] ?? null
    },

    async updateDocument(pageId: string, content: string, updatedAt: Date): Promise<void> {
      await db.update(t.documents).set({ content, updatedAt }).where(eq(t.documents.pageId, pageId))
    },

    // ---- journal helpers ----

    async getSpaceByOwnerAndKind(ownerId: string, kind: 'journal'): Promise<SpaceRow | null> {
      const rows = await db
        .select()
        .from(t.spaces)
        .where(and(eq(t.spaces.ownerId, ownerId), eq(t.spaces.kind, kind)))
        .limit(1)
      return rows[0] ?? null
    },

    async getPageByDateKey(spaceId: string, dateKey: string): Promise<PageRow | null> {
      const rows = await db
        .select()
        .from(t.pages)
        .where(and(eq(t.pages.spaceId, spaceId), eq(t.pages.dateKey, dateKey)))
        .limit(1)
      return rows[0] ?? null
    },

    // ---- memos ----

    async insertMemo(memo: MemoRow): Promise<void> {
      await db.insert(t.memos).values(memo)
    },

    async getMemo(id: string): Promise<MemoRow | null> {
      const rows = await db.select().from(t.memos).where(eq(t.memos.id, id)).limit(1)
      return rows[0] ?? null
    },

    async listMemos(userId: string): Promise<MemoRow[]> {
      return db.select().from(t.memos).where(eq(t.memos.userId, userId))
    },

    async markMemoPromoted(id: string, to: 'note' | 'journal' | 'task', when: Date): Promise<void> {
      await db.update(t.memos).set({ promotedTo: to, promotedAt: when }).where(eq(t.memos.id, id))
    },

    async deleteMemo(id: string): Promise<void> {
      await db.delete(t.memos).where(eq(t.memos.id, id))
    },

    // ---- tasks index ----

    async listTasksForPage(pageId: string): Promise<TaskRow[]> {
      return db.select().from(t.tasks).where(eq(t.tasks.pageId, pageId))
    },

    async listAllTasks(): Promise<TaskRow[]> {
      return db.select().from(t.tasks)
    },

    async getTask(id: string): Promise<TaskRow | null> {
      const rows = await db.select().from(t.tasks).where(eq(t.tasks.id, id)).limit(1)
      return rows[0] ?? null
    },

    async insertTask(task: TaskRow): Promise<void> {
      await db.insert(t.tasks).values(task)
    },

    async updateTask(
      id: string,
      patch: Partial<Pick<TaskRow, 'text' | 'checked' | 'due' | 'position' | 'updatedAt'>>,
    ): Promise<void> {
      await db.update(t.tasks).set(patch).where(eq(t.tasks.id, id))
    },

    async deleteTask(id: string): Promise<void> {
      await db.delete(t.tasks).where(eq(t.tasks.id, id))
    },

    // ---- publishing ----

    async updateSpacePublishing(
      spaceId: string,
      patch: Partial<
        Pick<
          SpaceRow,
          'publicEnabled' | 'publicHost' | 'publicTitle' | 'publicFooter' | 'publicTheme'
        >
      >,
    ): Promise<void> {
      await db.update(t.spaces).set(patch).where(eq(t.spaces.id, spaceId))
    },

    async getSpaceByPublicHost(host: string): Promise<SpaceRow | null> {
      const rows = await db.select().from(t.spaces).where(eq(t.spaces.publicHost, host)).limit(1)
      return rows[0] ?? null
    },

    async insertPageVersion(version: PageVersionRow): Promise<void> {
      await db.insert(t.pageVersions).values(version)
    },

    async listVersionsForPage(pageId: string): Promise<PageVersionRow[]> {
      return db.select().from(t.pageVersions).where(eq(t.pageVersions.pageId, pageId))
    },

    async getVersion(id: string): Promise<PageVersionRow | null> {
      const rows = await db.select().from(t.pageVersions).where(eq(t.pageVersions.id, id)).limit(1)
      return rows[0] ?? null
    },

    async setLivePointer(pageId: string, versionId: string | null): Promise<void> {
      await db.update(t.pages).set({ liveVersionId: versionId }).where(eq(t.pages.id, pageId))
    },

    async setPageSlug(pageId: string, slug: string): Promise<void> {
      await db.update(t.pages).set({ slug }).where(eq(t.pages.id, pageId))
    },

    // ---- attachments & galleries ----

    async insertAttachment(row: AttachmentRow): Promise<void> {
      await db.insert(t.attachments).values(row)
    },

    async getAttachment(id: string): Promise<AttachmentRow | null> {
      const rows = await db.select().from(t.attachments).where(eq(t.attachments.id, id)).limit(1)
      return rows[0] ?? null
    },

    async insertGalleryItem(row: GalleryItemRow): Promise<void> {
      await db.insert(t.galleryItems).values(row)
    },

    async listGalleryItems(pageId: string): Promise<GalleryItemRow[]> {
      return db.select().from(t.galleryItems).where(eq(t.galleryItems.pageId, pageId))
    },

    async updateGalleryItemCaption(id: string, caption: string): Promise<void> {
      await db.update(t.galleryItems).set({ caption }).where(eq(t.galleryItems.id, id))
    },

    async deleteGalleryItem(id: string): Promise<void> {
      await db.delete(t.galleryItems).where(eq(t.galleryItems.id, id))
    },

    // ---- reminders & jobs ----

    async insertReminder(row: ReminderRow): Promise<void> {
      await db.insert(t.reminders).values(row)
    },

    async getReminder(id: string): Promise<ReminderRow | null> {
      const rows = await db.select().from(t.reminders).where(eq(t.reminders.id, id)).limit(1)
      return rows[0] ?? null
    },

    async listReminders(userId: string): Promise<ReminderRow[]> {
      return db.select().from(t.reminders).where(eq(t.reminders.userId, userId))
    },

    async updateReminder(
      id: string,
      patch: Partial<Pick<ReminderRow, 'dueDate' | 'completedAt'>>,
    ): Promise<void> {
      await db.update(t.reminders).set(patch).where(eq(t.reminders.id, id))
    },

    async deleteReminder(id: string): Promise<void> {
      await db.delete(t.reminders).where(eq(t.reminders.id, id))
    },

    async insertJob(row: JobRow): Promise<void> {
      await db.insert(t.scheduledJobs).values(row)
    },

    async listDueJobs(now: Date): Promise<JobRow[]> {
      const rows = (await db
        .select()
        .from(t.scheduledJobs)
        .where(eq(t.scheduledJobs.status, 'pending'))) as JobRow[]
      return rows.filter((j) => j.runAt.getTime() <= now.getTime())
    },

    /**
     * Compare-and-set claim: portable across both dialects. Correct because
     * the app is a single process by design — the CAS guards against
     * overlapping ticks, not other machines.
     */
    async claimJob(id: string): Promise<boolean> {
      const rows = await db
        .update(t.scheduledJobs)
        .set({ status: 'running' })
        .where(and(eq(t.scheduledJobs.id, id), eq(t.scheduledJobs.status, 'pending')))
        .returning({ id: t.scheduledJobs.id })
      return rows.length === 1
    },

    async finishJob(
      id: string,
      status: 'done' | 'failed' | 'pending',
      attempts: number,
      lastError: string | null,
    ): Promise<void> {
      await db
        .update(t.scheduledJobs)
        .set({ status, attempts, lastError })
        .where(eq(t.scheduledJobs.id, id))
    },

    /** Portable case-insensitive search over titles + working-copy content. */
    async searchPages(pattern: string): Promise<Array<{ page: PageRow; content: string }>> {
      const lowered = `%${pattern.toLowerCase()}%`
      const rows = await db
        .select({ page: t.pages, content: t.documents.content })
        .from(t.pages)
        .innerJoin(t.documents, eq(t.documents.pageId, t.pages.id))
        .where(
          sqlOp`lower(${t.pages.title}) like ${lowered} or lower(${t.documents.content}) like ${lowered}`,
        )
        .limit(50)
      return rows as Array<{ page: PageRow; content: string }>
    },

    async searchMemos(userId: string, pattern: string): Promise<MemoRow[]> {
      const lowered = `%${pattern.toLowerCase()}%`
      const rows = await db
        .select()
        .from(t.memos)
        .where(and(eq(t.memos.userId, userId), sqlOp`lower(${t.memos.content}) like ${lowered}`))
        .limit(20)
      return rows as MemoRow[]
    },

    async cancelPendingJobsForRef(refId: string): Promise<void> {
      await db
        .delete(t.scheduledJobs)
        .where(and(eq(t.scheduledJobs.refId, refId), eq(t.scheduledJobs.status, 'pending')))
    },
  }
}

export type Repo = ReturnType<typeof createRepo>
