/**
 * Personal access tokens: how scripts, the REST API and MCP clients act as a
 * person without a browser session.
 *
 * A token is "bn_" + 32 random bytes (base64url). Only its sha256 is stored,
 * so a database leak doesn't hand out working tokens, and the raw value is
 * shown exactly once, when it's made. A token never unlocks a locked notebook
 * or page: locks are opened per browser session with the account password.
 */
import { randomBytes } from 'node:crypto'
import { nanoid } from 'nanoid'
import { hashToken } from './auth'
import type { ApiTokenRow, Repo, UserRow } from './repo'

export const TOKEN_PREFIX = 'bn_'
/** lastUsedAt is bookkeeping, not an audit trail: write it at most this often */
const TOUCH_EVERY_MS = 60 * 1000

export type TokenScope = 'read' | 'write'

export function createApiTokenService(deps: { repo: Repo; now?: () => Date }) {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())

  return {
    async create(
      user: UserRow,
      input: { name: string; scope: TokenScope; expiresInDays?: number | null },
    ): Promise<{ token: string; row: ApiTokenRow }> {
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
      const row: ApiTokenRow = {
        id: nanoid(),
        userId: user.id,
        name: input.name.trim() || 'Token',
        tokenHash: hashToken(token),
        prefix: token.slice(0, 10),
        scope: input.scope,
        createdAt: now(),
        expiresAt: input.expiresInDays
          ? new Date(now().getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
        lastUsedAt: null,
        revokedAt: null,
      }
      await repo.insertApiToken(row)
      return { token, row }
    },

    /** The person a raw token acts as, or null for anything unusable. */
    async authenticate(raw: string): Promise<{ user: UserRow; token: ApiTokenRow } | null> {
      if (!raw.startsWith(TOKEN_PREFIX)) return null
      const row = await repo.getApiTokenByHash(hashToken(raw))
      if (!row || row.revokedAt) return null
      if (row.expiresAt && row.expiresAt.getTime() <= now().getTime()) return null
      const user = await repo.getUserById(row.userId)
      if (!user) return null
      if (!row.lastUsedAt || now().getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
        await repo.touchApiToken(row.id, now())
      }
      return { user, token: row }
    },
  }
}

/** Pull a bearer token out of an Authorization header, if there is one. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header
  const m = value?.match(/^Bearer\s+(\S+)$/i)
  return m?.[1] ?? null
}

export type ApiTokenService = ReturnType<typeof createApiTokenService>
