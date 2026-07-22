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
  /** JSON array of hidden sidebar tokens, e.g. ["cat:site","space:abc"] */
  sidebarHidden: string
  /** how many days ahead "Coming up" reaches on the Today page */
  comingUpDays: number
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
  publicTheme: 'paper' | 'ink' | 'mist' | 'sand' | 'bloom'
  publicAppearance: 'auto' | 'light' | 'dark'
  publicSocial: string
  publicLogoAttachmentId: string | null
  publicTagline: string | null
  publicHeaderLayout: 'classic' | 'centered' | 'split' | 'minimal'
  /** null = open; otherwise how often the account password is re-asked */
  lockPolicy: 'session' | 'idle' | null
  /** for an 'idle' lock: minutes of disuse before it re-asks (null = 30) */
  lockIdleMinutes: number | null
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
  galleryLayout: 'grid' | 'carousel' | 'filmstrip' | 'mosaic'
  galleryAutoplaySecs: number | null
  shareEnabled: boolean
  coverAttachmentId: string | null
  metaDescription: string | null
  icon: string | null
  archivedAt: Date | null
  archivedBy: string | null
  trashedAt: Date | null
  trashedBy: string | null
  /** null = open; otherwise how often the account password is re-asked */
  lockPolicy: 'session' | 'idle' | null
  /** for an 'idle' lock: minutes of disuse before it re-asks (null = 30) */
  lockIdleMinutes: number | null
  createdAt: Date
  updatedAt: Date
}

export type TemplateRow = {
  id: string
  name: string
  content: string
  createdBy: string
  createdAt: Date
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
  coverAttachmentId: string | null
  metaDescription: string | null
  tags: string
  createdBy: string
  createdAt: Date
}

export type PreviewRow = {
  id: string
  tokenHash: string
  pageId: string
  createdBy: string
  createdAt: Date
  revokedAt: Date | null
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
  icon: string | null
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
  dueTime: string | null
  position: number
  updatedAt: Date
}

export type DocumentRow = {
  pageId: string
  content: string
  schemaVersion: number
  updatedAt: Date
}

export type WebhookRow = {
  id: string
  userId: string
  target: 'inbox' | 'today' | 'tasks'
  tokenHash: string
  label: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
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

export type DbDatabaseRow = {
  id: string
  ownerId: string | null
  name: string
  position: number
  createdAt: Date
  updatedAt: Date
}

export type DbTableRow = {
  id: string
  databaseId: string
  name: string
  description: string
  columns: string // JSON array of column definitions
  form: string | null // JSON form config, or null
  position: number
  archivedAt: Date | null
  archivedBy: string | null
  createdAt: Date
  updatedAt: Date
}

export type DbRowRow = {
  id: string
  tableId: string
  cells: string // JSON object keyed by column id
  source: 'manual' | 'form'
  position: number
  createdAt: Date
  updatedAt: Date
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
          | 'email'
          | 'emailNotifications'
          | 'comingUpDays'
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
          | 'title'
          | 'parentId'
          | 'position'
          | 'updatedAt'
          | 'spaceId'
          | 'pageType'
          | 'metaDescription'
          | 'slug'
          | 'galleryLayout'
          | 'galleryAutoplaySecs'
          | 'shareEnabled'
          | 'coverAttachmentId'
          | 'icon'
        >
      >,
    ): Promise<void> {
      await db.update(t.pages).set(patch).where(eq(t.pages.id, id))
    },

    async deletePage(id: string): Promise<void> {
      // FK cascade removes the subtree and documents on both dialects
      await db.delete(t.pages).where(eq(t.pages.id, id))
    },

    async setPagesArchived(
      ids: string[],
      archivedAt: Date | null,
      archivedBy: string | null,
    ): Promise<void> {
      for (const id of ids) {
        await db.update(t.pages).set({ archivedAt, archivedBy }).where(eq(t.pages.id, id))
      }
    },

    async listArchivedPages(): Promise<PageRow[]> {
      return db.select().from(t.pages).where(sqlOp`${t.pages.archivedAt} is not null`)
    },

    async listLockedPages(): Promise<PageRow[]> {
      return db.select().from(t.pages).where(sqlOp`${t.pages.lockPolicy} is not null`)
    },

    async setPageLock(
      id: string,
      policy: 'session' | 'idle' | null,
      idleMinutes: number | null = null,
    ): Promise<void> {
      await db
        .update(t.pages)
        .set({ lockPolicy: policy, lockIdleMinutes: policy === 'idle' ? idleMinutes : null })
        .where(eq(t.pages.id, id))
    },

    async setSpaceLock(
      id: string,
      policy: 'session' | 'idle' | null,
      idleMinutes: number | null = null,
    ): Promise<void> {
      await db
        .update(t.spaces)
        .set({ lockPolicy: policy, lockIdleMinutes: policy === 'idle' ? idleMinutes : null })
        .where(eq(t.spaces.id, id))
    },

    async setSidebarHidden(userId: string, hidden: string): Promise<void> {
      await db.update(t.users).set({ sidebarHidden: hidden }).where(eq(t.users.id, userId))
    },

    // ---- trash ----

    async setPagesTrashed(
      ids: string[],
      trashedAt: Date | null,
      trashedBy: string | null,
    ): Promise<void> {
      for (const id of ids) {
        await db.update(t.pages).set({ trashedAt, trashedBy }).where(eq(t.pages.id, id))
      }
    },

    async listTrashedPages(): Promise<PageRow[]> {
      return db.select().from(t.pages).where(sqlOp`${t.pages.trashedAt} is not null`)
    },

    // ---- page links ----

    async setPageLinks(fromPageId: string, toPageIds: string[]): Promise<void> {
      await db.delete(t.pageLinks).where(eq(t.pageLinks.fromPageId, fromPageId))
      if (toPageIds.length > 0) {
        await db
          .insert(t.pageLinks)
          .values(toPageIds.map((toPageId) => ({ fromPageId, toPageId })))
          .onConflictDoNothing()
      }
    },

    async listBacklinks(toPageId: string): Promise<string[]> {
      const rows = await db
        .select({ fromPageId: t.pageLinks.fromPageId })
        .from(t.pageLinks)
        .where(eq(t.pageLinks.toPageId, toPageId))
      return rows.map((r: { fromPageId: string }) => r.fromPageId)
    },

    // ---- slug history ----

    async addPageSlug(pageId: string, slug: string, when: Date): Promise<void> {
      await db.insert(t.pageSlugs).values({ pageId, slug, createdAt: when }).onConflictDoNothing()
    },

    async listAllPageSlugs(): Promise<Array<{ pageId: string; slug: string }>> {
      return db.select({ pageId: t.pageSlugs.pageId, slug: t.pageSlugs.slug }).from(t.pageSlugs)
    },

    async listAllPageSlugRows(): Promise<Array<{ pageId: string; slug: string; createdAt: Date }>> {
      return db.select().from(t.pageSlugs)
    },

    // ---- templates ----

    async insertTemplate(row: TemplateRow): Promise<void> {
      await db.insert(t.templates).values(row)
    },

    async listTemplates(): Promise<TemplateRow[]> {
      return db.select().from(t.templates)
    },

    async getTemplate(id: string): Promise<TemplateRow | null> {
      const rows = await db.select().from(t.templates).where(eq(t.templates.id, id)).limit(1)
      return rows[0] ?? null
    },

    async deleteTemplate(id: string): Promise<void> {
      await db.delete(t.templates).where(eq(t.templates.id, id))
    },

    // ---- draft previews ----

    async insertPreview(row: PreviewRow): Promise<void> {
      await db.insert(t.previews).values(row)
    },

    async getPreviewByTokenHash(tokenHash: string): Promise<PreviewRow | null> {
      const rows = await db
        .select()
        .from(t.previews)
        .where(eq(t.previews.tokenHash, tokenHash))
        .limit(1)
      return rows[0] ?? null
    },

    async listPreviewsForPage(pageId: string): Promise<PreviewRow[]> {
      return db.select().from(t.previews).where(eq(t.previews.pageId, pageId))
    },

    async listAllPreviews(): Promise<PreviewRow[]> {
      return db.select().from(t.previews)
    },

    async revokePreview(id: string, when: Date): Promise<void> {
      await db.update(t.previews).set({ revokedAt: when }).where(eq(t.previews.id, id))
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

    async updateMemo(id: string, patch: Partial<Pick<MemoRow, 'content'>>): Promise<void> {
      await db.update(t.memos).set(patch).where(eq(t.memos.id, id))
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
      patch: Partial<
        Pick<TaskRow, 'text' | 'checked' | 'due' | 'dueTime' | 'position' | 'updatedAt'>
      >,
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
          | 'publicEnabled'
          | 'publicHost'
          | 'publicTitle'
          | 'publicFooter'
          | 'publicTheme'
          | 'publicAppearance'
          | 'publicSocial'
          | 'publicLogoAttachmentId'
          | 'publicTagline'
          | 'publicHeaderLayout'
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

    async listAttachments(): Promise<AttachmentRow[]> {
      return db.select().from(t.attachments)
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
      patch: Partial<
        Pick<
          ReminderRow,
          | 'title'
          | 'icon'
          | 'dueDate'
          | 'dueTime'
          | 'freq'
          | 'interval'
          | 'headsUpDays'
          | 'completedAt'
        >
      >,
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
          sqlOp`(lower(${t.pages.title}) like ${lowered} or lower(${t.documents.content}) like ${lowered}) and ${t.pages.archivedAt} is null and ${t.pages.trashedAt} is null`,
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

    async cancelPendingJobsForTypeRef(type: string, refId: string): Promise<void> {
      await db
        .delete(t.scheduledJobs)
        .where(
          and(
            eq(t.scheduledJobs.type, type),
            eq(t.scheduledJobs.refId, refId),
            eq(t.scheduledJobs.status, 'pending'),
          ),
        )
    },

    async getPendingJobByTypeRef(type: string, refId: string): Promise<JobRow | null> {
      const rows = await db
        .select()
        .from(t.scheduledJobs)
        .where(
          and(
            eq(t.scheduledJobs.type, type),
            eq(t.scheduledJobs.refId, refId),
            eq(t.scheduledJobs.status, 'pending'),
          ),
        )
        .limit(1)
      return rows[0] ?? null
    },

    // ---- server settings ----

    async getSetting(key: string): Promise<string | null> {
      const rows = await db.select().from(t.settings).where(eq(t.settings.key, key)).limit(1)
      return rows[0]?.value ?? null
    },

    async listSettings(): Promise<Array<{ key: string; value: string; updatedAt: Date }>> {
      return db.select().from(t.settings)
    },

    async listAllWebhooks(): Promise<WebhookRow[]> {
      return db.select().from(t.webhooks)
    },

    async putSetting(key: string, value: string, when: Date): Promise<void> {
      const updated = await db
        .update(t.settings)
        .set({ value, updatedAt: when })
        .where(eq(t.settings.key, key))
        .returning({ key: t.settings.key })
      if (updated.length === 0) {
        await db.insert(t.settings).values({ key, value, updatedAt: when })
      }
    },

    // ---- blob rows (database storage driver) ----

    async putBlob(key: string, data: Buffer, when: Date): Promise<void> {
      if (await this.getBlob(key)) return // content-addressed: same key, same bytes
      await db.insert(t.blobs).values({ key, data, createdAt: when })
    },

    async getBlob(key: string): Promise<Buffer | null> {
      const rows = await db.select().from(t.blobs).where(eq(t.blobs.key, key)).limit(1)
      return rows[0] ? Buffer.from(rows[0].data) : null
    },

    async deleteBlob(key: string): Promise<void> {
      await db.delete(t.blobs).where(eq(t.blobs.key, key))
    },

    async listBlobKeys(): Promise<string[]> {
      const rows = await db.select({ key: t.blobs.key }).from(t.blobs)
      return rows.map((r: { key: string }) => r.key)
    },

    // ---- webhooks ----

    async insertWebhook(row: WebhookRow): Promise<void> {
      await db.insert(t.webhooks).values(row)
    },

    async getWebhookByTokenHash(tokenHash: string): Promise<WebhookRow | null> {
      const rows = await db
        .select()
        .from(t.webhooks)
        .where(eq(t.webhooks.tokenHash, tokenHash))
        .limit(1)
      return rows[0] ?? null
    },

    async listWebhooksForUser(userId: string): Promise<WebhookRow[]> {
      return db.select().from(t.webhooks).where(eq(t.webhooks.userId, userId))
    },

    async touchWebhook(id: string, when: Date): Promise<void> {
      await db.update(t.webhooks).set({ lastUsedAt: when }).where(eq(t.webhooks.id, id))
    },

    async revokeWebhook(id: string, when: Date): Promise<void> {
      await db.update(t.webhooks).set({ revokedAt: when }).where(eq(t.webhooks.id, id))
    },

    // ---- tag index ----

    /** Replace the inline-derived tags; manual tags (context rail) survive. */
    async setPageTags(pageId: string, tags: string[]): Promise<void> {
      await db
        .delete(t.pageTags)
        .where(and(eq(t.pageTags.pageId, pageId), eq(t.pageTags.source, 'inline')))
      if (tags.length > 0) {
        await db
          .insert(t.pageTags)
          .values(tags.map((tag) => ({ pageId, tag, source: 'inline' as const })))
          // a manual row already owns this (pageId, tag) — keep it manual
          .onConflictDoNothing()
      }
    },

    async addManualPageTag(pageId: string, tag: string): Promise<void> {
      await db.insert(t.pageTags).values({ pageId, tag, source: 'manual' }).onConflictDoNothing()
    },

    async removeManualPageTag(pageId: string, tag: string): Promise<void> {
      await db
        .delete(t.pageTags)
        .where(
          and(
            eq(t.pageTags.pageId, pageId),
            eq(t.pageTags.tag, tag),
            eq(t.pageTags.source, 'manual'),
          ),
        )
    },

    async listPageTags(
      pageId: string,
    ): Promise<Array<{ tag: string; source: 'inline' | 'manual' }>> {
      const rows = await db
        .select({ tag: t.pageTags.tag, source: t.pageTags.source })
        .from(t.pageTags)
        .where(eq(t.pageTags.pageId, pageId))
      return rows as Array<{ tag: string; source: 'inline' | 'manual' }>
    },

    async listAllPageTags(): Promise<Array<{ pageId: string; tag: string }>> {
      return db.select({ pageId: t.pageTags.pageId, tag: t.pageTags.tag }).from(t.pageTags)
    },

    // full rows for export — manual tags make this table non-derivable
    async listAllPageTagRows(): Promise<
      Array<{ pageId: string; tag: string; source: 'inline' | 'manual' }>
    > {
      return db.select().from(t.pageTags)
    },

    async insertPageTagRow(row: {
      pageId: string
      tag: string
      source: 'inline' | 'manual'
    }): Promise<void> {
      await db.insert(t.pageTags).values(row).onConflictDoNothing()
    },

    async listPageIdsByTag(tag: string): Promise<string[]> {
      const rows = await db
        .select({ pageId: t.pageTags.pageId })
        .from(t.pageTags)
        .where(eq(t.pageTags.tag, tag))
      return rows.map((r: { pageId: string }) => r.pageId)
    },

    // ---- pins ----

    async addPin(userId: string, pageId: string, when: Date): Promise<void> {
      await db.insert(t.pins).values({ userId, pageId, createdAt: when }).onConflictDoNothing()
    },

    async removePin(userId: string, pageId: string): Promise<void> {
      await db.delete(t.pins).where(and(eq(t.pins.userId, userId), eq(t.pins.pageId, pageId)))
    },

    async listPins(userId: string): Promise<Array<{ pageId: string; createdAt: Date }>> {
      return db
        .select({ pageId: t.pins.pageId, createdAt: t.pins.createdAt })
        .from(t.pins)
        .where(eq(t.pins.userId, userId))
    },

    async listAllPins(): Promise<Array<{ userId: string; pageId: string; createdAt: Date }>> {
      return db.select().from(t.pins)
    },

    // ---- journal day notes ----

    async listPagesByDateKey(spaceId: string, dateKey: string): Promise<PageRow[]> {
      return db
        .select()
        .from(t.pages)
        .where(and(eq(t.pages.spaceId, spaceId), eq(t.pages.dateKey, dateKey)))
    },

    // ---- data: databases ----

    async insertDbDatabase(row: DbDatabaseRow): Promise<void> {
      await db.insert(t.dbDatabases).values(row)
    },

    async getDbDatabase(id: string): Promise<DbDatabaseRow | null> {
      const rows = await db.select().from(t.dbDatabases).where(eq(t.dbDatabases.id, id)).limit(1)
      return rows[0] ?? null
    },

    async listDbDatabases(): Promise<DbDatabaseRow[]> {
      return db.select().from(t.dbDatabases)
    },

    async updateDbDatabase(
      id: string,
      patch: Partial<Pick<DbDatabaseRow, 'name' | 'position' | 'updatedAt'>>,
    ): Promise<void> {
      await db.update(t.dbDatabases).set(patch).where(eq(t.dbDatabases.id, id))
    },

    async deleteDbDatabase(id: string): Promise<void> {
      // FK cascade removes the database's tables and their rows on both dialects
      await db.delete(t.dbDatabases).where(eq(t.dbDatabases.id, id))
    },

    // ---- data: tables ----

    async insertDbTable(row: DbTableRow): Promise<void> {
      await db.insert(t.dbTables).values(row)
    },

    async getDbTable(id: string): Promise<DbTableRow | null> {
      const rows = await db.select().from(t.dbTables).where(eq(t.dbTables.id, id)).limit(1)
      return rows[0] ?? null
    },

    async listDbTables(): Promise<DbTableRow[]> {
      return db.select().from(t.dbTables)
    },

    async listDbTablesInDatabase(databaseId: string): Promise<DbTableRow[]> {
      return db.select().from(t.dbTables).where(eq(t.dbTables.databaseId, databaseId))
    },

    async updateDbTable(
      id: string,
      patch: Partial<
        Pick<
          DbTableRow,
          | 'databaseId'
          | 'name'
          | 'description'
          | 'columns'
          | 'form'
          | 'position'
          | 'archivedAt'
          | 'archivedBy'
          | 'updatedAt'
        >
      >,
    ): Promise<void> {
      await db.update(t.dbTables).set(patch).where(eq(t.dbTables.id, id))
    },

    async deleteDbTable(id: string): Promise<void> {
      // FK cascade removes the table's rows on both dialects
      await db.delete(t.dbTables).where(eq(t.dbTables.id, id))
    },

    async insertDbRow(row: DbRowRow): Promise<void> {
      await db.insert(t.dbRows).values(row)
    },

    async getDbRow(id: string): Promise<DbRowRow | null> {
      const rows = await db.select().from(t.dbRows).where(eq(t.dbRows.id, id)).limit(1)
      return rows[0] ?? null
    },

    async listDbRows(tableId: string): Promise<DbRowRow[]> {
      return db.select().from(t.dbRows).where(eq(t.dbRows.tableId, tableId))
    },

    async updateDbRow(
      id: string,
      patch: Partial<Pick<DbRowRow, 'cells' | 'position' | 'updatedAt'>>,
    ): Promise<void> {
      await db.update(t.dbRows).set(patch).where(eq(t.dbRows.id, id))
    },

    async deleteDbRow(id: string): Promise<void> {
      await db.delete(t.dbRows).where(eq(t.dbRows.id, id))
    },

    // ---- whole-table reads for export (export.ts is the only caller) ----

    async listAllPages(): Promise<PageRow[]> {
      return db.select().from(t.pages)
    },

    async listAllDocuments(): Promise<DocumentRow[]> {
      return db.select().from(t.documents)
    },

    async listAllVersions(): Promise<PageVersionRow[]> {
      return db.select().from(t.pageVersions)
    },

    async listAllMemos(): Promise<MemoRow[]> {
      return db.select().from(t.memos)
    },

    async listAllGalleryItems(): Promise<GalleryItemRow[]> {
      return db.select().from(t.galleryItems)
    },

    async listAllReminders(): Promise<ReminderRow[]> {
      return db.select().from(t.reminders)
    },

    async listAllJobs(): Promise<JobRow[]> {
      return db.select().from(t.scheduledJobs)
    },

    async listAllDbDatabases(): Promise<DbDatabaseRow[]> {
      return db.select().from(t.dbDatabases)
    },

    async listAllDbTables(): Promise<DbTableRow[]> {
      return db.select().from(t.dbTables)
    },

    async listAllDbRows(): Promise<DbRowRow[]> {
      return db.select().from(t.dbRows)
    },
  }
}

export type Repo = ReturnType<typeof createRepo>
