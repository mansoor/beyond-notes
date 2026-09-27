/**
 * The audit log: who did what, when, and from where.
 *
 * Recording is best-effort by design. A failed write is logged and swallowed,
 * never surfaced, so a full disk or a locked table can't turn a sign-in or a
 * settings save into an error. Events older than the retention window are
 * pruned by the same periodic job that empties the trash.
 */
import type { AuditAction } from '@bn/schema'
import { nanoid } from 'nanoid'
import type { Repo, UserRow } from './repo'

export type AuditInput = {
  action: AuditAction
  /** the signed-in person, when there is one */
  actor?: Pick<UserRow, 'id' | 'email'> | null
  /** who it was about when nobody is signed in (a failed sign-in's email) */
  actorEmail?: string | null
  target?: string | null
  ip?: string | null
  detail?: Record<string, unknown>
}

export function createAuditService(deps: {
  repo: Repo
  now?: () => Date
  onError?: (err: unknown) => void
}) {
  const now = deps.now ?? (() => new Date())
  return {
    async record(input: AuditInput): Promise<void> {
      try {
        await deps.repo.insertAuditEvent({
          id: nanoid(),
          at: now(),
          actorId: input.actor?.id ?? null,
          actorEmail: input.actor?.email ?? input.actorEmail ?? null,
          action: input.action,
          target: input.target ?? null,
          ip: input.ip ?? null,
          detail:
            input.detail && Object.keys(input.detail).length ? JSON.stringify(input.detail) : null,
        })
      } catch (err) {
        deps.onError?.(err)
      }
    },

    async prune(retentionDays: number): Promise<number> {
      if (retentionDays <= 0) return 0
      return deps.repo.deleteAuditEventsBefore(
        new Date(now().getTime() - retentionDays * 24 * 60 * 60 * 1000),
      )
    },
  }
}

export type AuditService = ReturnType<typeof createAuditService>
