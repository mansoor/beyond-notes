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
  }
}

export type Repo = ReturnType<typeof createRepo>
