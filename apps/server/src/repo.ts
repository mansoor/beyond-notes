import { and, desc, eq, gte, isNull, like, lt, sql as sqlOp } from 'drizzle-orm'
import type { AppDb } from './db'

export type UserRow = {
  id: string
  email: string
  name: string
  passwordHash: string
  /** false for an SSO-created account that has never set a password */
  passwordSet: boolean
  role: 'admin' | 'member'
  totpSecret: string | null
  totpEnabled: boolean
  recoveryCodes: string | null
  emailNotifications: boolean
  /** JSON array of hidden sidebar tokens, e.g. ["cat:site","space:abc"] */
  sidebarHidden: string
  /** how many days ahead "Coming up" reaches for tasks, and for reminders */
  taskDays: number
  reminderDays: number
  /** ask before a page goes to the Trash */
  confirmDelete: boolean
  /** fetch the full article (vs. just the first paragraph) for a shared link */
  linkCaptureFull: boolean
  /** clicking a space name opens its knowledge-graph overview vs. just expanding */
  graphEnabled: boolean
  /** JSON array of enabled graph edge kinds: concept|link|tag|relation|semantic */
  graphEdges: string
  /** also build the graph on phones (off = treat as disabled on small screens) */
  graphMobile: boolean
  /** default app theme, adopted on a device that has not picked one */
  defaultTheme: 'light' | 'paper' | 'navy' | 'dark'
  /** deactivated at; null = active */
  disabledAt: Date | null
  createdAt: Date
}

export type SessionRow = {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
}

export type IdentityRow = {
  id: string
  userId: string
  issuer: string
  subject: string
  email: string | null
  createdAt: Date
  lastLoginAt: Date | null
}

export type PasskeyRow = {
  id: string
  userId: string
  name: string
  /** base64url COSE public key */
  publicKey: string
  counter: number
  /** JSON array of authenticator transports */
  transports: string
  backedUp: boolean
  createdAt: Date
  lastUsedAt: Date | null
}

export type AuditEventRow = {
  id: string
  at: Date
  actorId: string | null
  actorEmail: string | null
  action: string
  target: string | null
  ip: string | null
  /** JSON object */
  detail: string | null
}

export type ApiTokenRow = {
  id: string
  userId: string
  name: string
  tokenHash: string
  prefix: string
  scope: 'read' | 'write'
  createdAt: Date
  expiresAt: Date | null
  lastUsedAt: Date | null
  revokedAt: Date | null
}

export type SiteVisitRow = {
  spaceId: string
  day: string
  path: string
  views: number
  visitors: number
}
export type SiteReferrerRow = { spaceId: string; day: string; host: string; views: number }

export type ShareRole = 'viewer' | 'editor'
export type SpaceShareRow = {
  spaceId: string
  principalType: 'user' | 'group'
  principalId: string
  role: ShareRole
  createdAt: Date
}
export type UserGroupRow = { id: string; name: string; createdAt: Date }
export type UserGroupMemberRow = { groupId: string; userId: string }

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
  publicMaintenance: boolean
  publicHost: string | null
  publicTitle: string | null
  publicFooter: string | null
  publicTheme: 'paper' | 'ink' | 'mist' | 'sand' | 'bloom'
  publicAppearance: 'auto' | 'light' | 'dark' | 'toggle'
  publicSocial: string
  publicLogoAttachmentId: string | null
  publicTagline: string | null
  publicHeaderLayout: 'classic' | 'centered' | 'split' | 'minimal'
  publicTitleSize: 'sm' | 'md' | 'lg' | 'xl'
  publicLogoSize: 'sm' | 'md' | 'lg'
  publicFaviconAttachmentId: string | null
  /** opt-in analytics for the published site; 'none' emits no tag at all */
  analyticsProvider: 'none' | 'plausible' | 'umami' | 'ga4'
  analyticsSiteId: string | null
  /** self-hosted Plausible/Umami origin; null uses the vendor's */
  analyticsHost: string | null
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
  blogLayout: 'list' | 'grid'
  category: string | null
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
  let documentListener: ((pageId: string, content: string) => void) | null = null
  const db = appDb.db
  const t = appDb.tables as any

  return {
    /** Totals for the metrics endpoint. Counted in the database, not in memory. */
    async instanceCounts(): Promise<{
      users: number
      spaces: number
      pages: number
      attachments: number
      attachmentBytes: number
    }> {
      const one = async (q: Promise<Array<{ n: unknown }>>) => Number((await q)[0]?.n ?? 0)
      const [users, spaces, pages, attachments, attachmentBytes] = await Promise.all([
        one(db.select({ n: sqlOp`count(*)` }).from(t.users)),
        one(db.select({ n: sqlOp`count(*)` }).from(t.spaces)),
        one(db.select({ n: sqlOp`count(*)` }).from(t.pages).where(isNull(t.pages.trashedAt))),
        one(db.select({ n: sqlOp`count(*)` }).from(t.attachments)),
        one(db.select({ n: sqlOp`coalesce(sum(${t.attachments.size}), 0)` }).from(t.attachments)),
      ])
      return { users, spaces, pages, attachments, attachmentBytes }
    },

    async countUsers(): Promise<number> {
      const rows = await db.select({ id: t.users.id }).from(t.users)
      return rows.length
    },

    /** People who can sign in (what a per-seat licence counts). */
    async countActiveUsers(): Promise<number> {
      const rows = await db
        .select({ id: t.users.id })
        .from(t.users)
        .where(isNull(t.users.disabledAt))
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
          | 'passwordSet'
          | 'role'
          | 'totpSecret'
          | 'totpEnabled'
          | 'recoveryCodes'
          | 'name'
          | 'email'
          | 'emailNotifications'
          | 'taskDays'
          | 'reminderDays'
          | 'confirmDelete'
          | 'linkCaptureFull'
          | 'graphEnabled'
          | 'graphEdges'
          | 'graphMobile'
          | 'defaultTheme'
          | 'disabledAt'
        >
      >,
    ): Promise<void> {
      await db.update(t.users).set(patch).where(eq(t.users.id, id))
    },

    /** End every session of one person (deactivation, forced password reset). */
    async deleteSessionsForUser(userId: string): Promise<void> {
      await db.delete(t.sessions).where(eq(t.sessions.userId, userId))
    },

    async getIdentity(issuer: string, subject: string): Promise<IdentityRow | null> {
      const rows = await db
        .select()
        .from(t.userIdentities)
        .where(and(eq(t.userIdentities.issuer, issuer), eq(t.userIdentities.subject, subject)))
        .limit(1)
      return rows[0] ?? null
    },

    async listIdentitiesForUser(userId: string): Promise<IdentityRow[]> {
      return db.select().from(t.userIdentities).where(eq(t.userIdentities.userId, userId))
    },

    async insertIdentity(row: IdentityRow): Promise<void> {
      await db.insert(t.userIdentities).values(row)
    },

    async touchIdentity(id: string, patch: { lastLoginAt: Date; email: string | null }) {
      await db.update(t.userIdentities).set(patch).where(eq(t.userIdentities.id, id))
    },

    /** Scoped to the owner so one user can never unlink another's identity. */
    async deleteIdentity(id: string, userId: string): Promise<void> {
      await db
        .delete(t.userIdentities)
        .where(and(eq(t.userIdentities.id, id), eq(t.userIdentities.userId, userId)))
    },

    async listAllIdentities(): Promise<IdentityRow[]> {
      return db.select().from(t.userIdentities)
    },

    async listPasskeysForUser(userId: string): Promise<PasskeyRow[]> {
      return db.select().from(t.passkeys).where(eq(t.passkeys.userId, userId))
    },

    async listAllPasskeys(): Promise<PasskeyRow[]> {
      return db.select().from(t.passkeys)
    },

    async getPasskey(id: string): Promise<PasskeyRow | null> {
      const rows = await db.select().from(t.passkeys).where(eq(t.passkeys.id, id)).limit(1)
      return rows[0] ?? null
    },

    async insertPasskey(row: PasskeyRow): Promise<void> {
      await db.insert(t.passkeys).values(row)
    },

    async recordPasskeyUse(id: string, counter: number, when: Date): Promise<void> {
      await db.update(t.passkeys).set({ counter, lastUsedAt: when }).where(eq(t.passkeys.id, id))
    },

    /** Scoped to the owner, like deleteIdentity. */
    async renamePasskey(id: string, userId: string, name: string): Promise<void> {
      await db
        .update(t.passkeys)
        .set({ name })
        .where(and(eq(t.passkeys.id, id), eq(t.passkeys.userId, userId)))
    },

    async deletePasskey(id: string, userId: string): Promise<void> {
      await db.delete(t.passkeys).where(and(eq(t.passkeys.id, id), eq(t.passkeys.userId, userId)))
    },

    async insertAuditEvent(row: AuditEventRow): Promise<void> {
      await db.insert(t.auditEvents).values(row)
    },

    /** Newest first. `before` pages backwards; `prefix` filters by action family. */
    async listAuditEvents(opts: {
      limit: number
      before?: Date
      prefix?: string
    }): Promise<AuditEventRow[]> {
      const where = [
        opts.before ? lt(t.auditEvents.at, opts.before) : undefined,
        opts.prefix ? like(t.auditEvents.action, `${opts.prefix}%`) : undefined,
      ].filter(Boolean)
      return db
        .select()
        .from(t.auditEvents)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(t.auditEvents.at), desc(t.auditEvents.id))
        .limit(opts.limit)
    },

    async deleteAuditEventsBefore(cutoff: Date): Promise<number> {
      const rows = await db
        .delete(t.auditEvents)
        .where(lt(t.auditEvents.at, cutoff))
        .returning({ id: t.auditEvents.id })
      return rows.length
    },

    // ---- built-in visit counts ----

    async addSiteVisits(
      rows: Array<{ spaceId: string; day: string; path: string; views: number; visitors: number }>,
    ): Promise<void> {
      for (const r of rows) {
        await db
          .insert(t.siteVisitsDaily)
          .values(r)
          .onConflictDoUpdate({
            target: [t.siteVisitsDaily.spaceId, t.siteVisitsDaily.day, t.siteVisitsDaily.path],
            set: {
              views: sqlOp`${t.siteVisitsDaily.views} + ${r.views}`,
              visitors: sqlOp`${t.siteVisitsDaily.visitors} + ${r.visitors}`,
            },
          })
      }
    },
    async addSiteReferrers(
      rows: Array<{ spaceId: string; day: string; host: string; views: number }>,
    ): Promise<void> {
      for (const r of rows) {
        await db
          .insert(t.siteReferrersDaily)
          .values(r)
          .onConflictDoUpdate({
            target: [
              t.siteReferrersDaily.spaceId,
              t.siteReferrersDaily.day,
              t.siteReferrersDaily.host,
            ],
            set: { views: sqlOp`${t.siteReferrersDaily.views} + ${r.views}` },
          })
      }
    },
    /** Daily rows for one site from `fromDay` (inclusive, YYYY-MM-DD). */
    async listSiteVisits(spaceId: string, fromDay: string): Promise<SiteVisitRow[]> {
      return db
        .select()
        .from(t.siteVisitsDaily)
        .where(and(eq(t.siteVisitsDaily.spaceId, spaceId), gte(t.siteVisitsDaily.day, fromDay)))
    },
    async listSiteReferrers(spaceId: string, fromDay: string): Promise<SiteReferrerRow[]> {
      return db
        .select()
        .from(t.siteReferrersDaily)
        .where(
          and(eq(t.siteReferrersDaily.spaceId, spaceId), gte(t.siteReferrersDaily.day, fromDay)),
        )
    },
    async listAllSiteVisits(): Promise<SiteVisitRow[]> {
      return db.select().from(t.siteVisitsDaily)
    },
    async listAllSiteReferrers(): Promise<SiteReferrerRow[]> {
      return db.select().from(t.siteReferrersDaily)
    },
    async deleteSiteVisitsBefore(day: string): Promise<void> {
      await db.delete(t.siteVisitsDaily).where(lt(t.siteVisitsDaily.day, day))
      await db.delete(t.siteReferrersDaily).where(lt(t.siteReferrersDaily.day, day))
    },

    // ---- sharing ----

    async listAllSpaceShares(): Promise<SpaceShareRow[]> {
      return (await db.select().from(t.spaceShares)) as SpaceShareRow[]
    },
    async listSpaceShares(spaceId: string): Promise<SpaceShareRow[]> {
      return (await db
        .select()
        .from(t.spaceShares)
        .where(eq(t.spaceShares.spaceId, spaceId))) as SpaceShareRow[]
    },
    /** Insert, or change the role of, one share. */
    async putSpaceShare(row: SpaceShareRow): Promise<void> {
      await db
        .insert(t.spaceShares)
        .values(row)
        .onConflictDoUpdate({
          target: [t.spaceShares.spaceId, t.spaceShares.principalType, t.spaceShares.principalId],
          set: { role: row.role },
        })
    },
    async deleteSpaceShare(
      spaceId: string,
      principalType: 'user' | 'group',
      principalId: string,
    ): Promise<void> {
      await db
        .delete(t.spaceShares)
        .where(
          and(
            eq(t.spaceShares.spaceId, spaceId),
            eq(t.spaceShares.principalType, principalType),
            eq(t.spaceShares.principalId, principalId),
          ),
        )
    },
    /** A deleted group or person stops being shared with anywhere. */
    async deleteSharesForPrincipal(principalType: 'user' | 'group', principalId: string) {
      await db
        .delete(t.spaceShares)
        .where(
          and(
            eq(t.spaceShares.principalType, principalType),
            eq(t.spaceShares.principalId, principalId),
          ),
        )
    },

    async listUserGroups(): Promise<UserGroupRow[]> {
      return (await db.select().from(t.userGroups)) as UserGroupRow[]
    },
    async insertUserGroup(row: UserGroupRow): Promise<void> {
      await db.insert(t.userGroups).values(row)
    },
    async renameUserGroup(id: string, name: string): Promise<void> {
      await db.update(t.userGroups).set({ name }).where(eq(t.userGroups.id, id))
    },
    async deleteUserGroup(id: string): Promise<void> {
      await db.delete(t.userGroups).where(eq(t.userGroups.id, id))
    },
    async listAllUserGroupMembers(): Promise<UserGroupMemberRow[]> {
      return (await db.select().from(t.userGroupMembers)) as UserGroupMemberRow[]
    },
    async addUserGroupMember(row: UserGroupMemberRow): Promise<void> {
      await db.insert(t.userGroupMembers).values(row).onConflictDoNothing()
    },
    async removeUserGroupMember(groupId: string, userId: string): Promise<void> {
      await db
        .delete(t.userGroupMembers)
        .where(and(eq(t.userGroupMembers.groupId, groupId), eq(t.userGroupMembers.userId, userId)))
    },

    async insertApiToken(row: ApiTokenRow): Promise<void> {
      await db.insert(t.apiTokens).values(row)
    },

    async getApiTokenByHash(tokenHash: string): Promise<ApiTokenRow | null> {
      const rows = await db
        .select()
        .from(t.apiTokens)
        .where(eq(t.apiTokens.tokenHash, tokenHash))
        .limit(1)
      return rows[0] ?? null
    },

    async listApiTokensForUser(userId: string): Promise<ApiTokenRow[]> {
      return db.select().from(t.apiTokens).where(eq(t.apiTokens.userId, userId))
    },

    async touchApiToken(id: string, when: Date): Promise<void> {
      await db.update(t.apiTokens).set({ lastUsedAt: when }).where(eq(t.apiTokens.id, id))
    },

    /** Scoped to the owner, like the other self-service deletes. */
    async revokeApiToken(id: string, userId: string, when: Date): Promise<void> {
      await db
        .update(t.apiTokens)
        .set({ revokedAt: when })
        .where(and(eq(t.apiTokens.id, id), eq(t.apiTokens.userId, userId)))
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
          | 'blogLayout'
          | 'category'
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

    async setSpaceAnalytics(
      id: string,
      a: {
        provider: 'none' | 'plausible' | 'umami' | 'ga4'
        siteId: string | null
        host: string | null
      },
    ): Promise<void> {
      await db
        .update(t.spaces)
        .set({
          analyticsProvider: a.provider,
          analyticsSiteId: a.siteId,
          analyticsHost: a.host,
        })
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

    async listAllPageLinks(): Promise<Array<{ fromPageId: string; toPageId: string }>> {
      return db
        .select({ fromPageId: t.pageLinks.fromPageId, toPageId: t.pageLinks.toPageId })
        .from(t.pageLinks)
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

    /**
     * The one write path for page content. Anything listening (live
     * co-editing) hears about writes that didn't come from itself.
     */
    async updateDocument(
      pageId: string,
      content: string,
      updatedAt: Date,
      source: 'collab' | null = null,
    ): Promise<void> {
      await db.update(t.documents).set({ content, updatedAt }).where(eq(t.documents.pageId, pageId))
      if (source !== 'collab') documentListener?.(pageId, content)
    },
    /** Hear about page content written outside live co-editing. */
    onDocumentWritten(listener: ((pageId: string, content: string) => void) | null) {
      documentListener = listener
    },

    async getLiveState(pageId: string): Promise<{ state: Uint8Array; contentAt: Date } | null> {
      const rows = await db
        .select()
        .from(t.documentLiveStates)
        .where(eq(t.documentLiveStates.pageId, pageId))
        .limit(1)
      const row = rows[0]
      return row
        ? { state: new Uint8Array(row.state as Uint8Array), contentAt: row.contentAt }
        : null
    },
    async putLiveState(pageId: string, state: Uint8Array, contentAt: Date): Promise<void> {
      const value = Buffer.from(state)
      await db
        .insert(t.documentLiveStates)
        .values({ pageId, state: value, contentAt })
        .onConflictDoUpdate({
          target: t.documentLiveStates.pageId,
          set: { state: value, contentAt },
        })
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
          | 'publicMaintenance'
          | 'publicHost'
          | 'publicTitle'
          | 'publicFooter'
          | 'publicTheme'
          | 'publicAppearance'
          | 'publicSocial'
          | 'publicLogoAttachmentId'
          | 'publicTagline'
          | 'publicHeaderLayout'
          | 'publicTitleSize'
          | 'publicLogoSize'
          | 'publicFaviconAttachmentId'
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

    /** Drop every job of a type — used to cancel/replace the singleton backup job. */
    async deleteJobsByType(type: string): Promise<void> {
      await db.delete(t.scheduledJobs).where(eq(t.scheduledJobs.type, type))
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
