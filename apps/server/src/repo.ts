import { and, eq, isNull } from 'drizzle-orm'
import type { AppDb } from './db'

export type UserRow = {
  id: string
  email: string
  name: string
  passwordHash: string
  role: 'admin' | 'member'
  createdAt: Date
}

export type SessionRow = {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
}

export type SpaceRow = {
  id: string
  name: string
  category: 'notebook' | 'wiki' | 'site'
  ownerId: string | null
  createdAt: Date
}

export type PageRow = {
  id: string
  spaceId: string
  parentId: string | null
  title: string
  position: number
  createdAt: Date
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

    async insertSession(session: SessionRow): Promise<void> {
      await db.insert(t.sessions).values(session)
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
      patch: Partial<Pick<PageRow, 'title' | 'parentId' | 'position' | 'updatedAt'>>,
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
  }
}

export type Repo = ReturnType<typeof createRepo>
