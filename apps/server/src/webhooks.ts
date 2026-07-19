import { randomBytes } from 'node:crypto'
import { nanoid } from 'nanoid'
import { hashToken } from './auth'
import type { DailyService } from './daily'
import { PagesError } from './pages'
import type { Repo, WebhookRow } from './repo'

/**
 * Incoming webhooks: other apps POST text at /api/hooks/<token> and it lands
 * in one of the owner's capture surfaces. The token is the credential (never
 * stored raw, shown once at creation) and each hook is scoped to exactly one
 * target — a leaked inbox token cannot touch tasks.
 */
export function createWebhooksService(
  repo: Repo,
  daily: DailyService,
  opts: { now?: () => Date } = {},
) {
  const now = opts.now ?? (() => new Date())

  const todayKey = () => {
    const d = now()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  }

  return {
    async create(userId: string, input: { target: 'inbox' | 'today' | 'tasks'; label: string }) {
      const token = randomBytes(24).toString('base64url')
      const row: WebhookRow = {
        id: nanoid(),
        userId,
        target: input.target,
        tokenHash: hashToken(token),
        label: input.label,
        createdAt: now(),
        lastUsedAt: null,
        revokedAt: null,
      }
      await repo.insertWebhook(row)
      return { token, row }
    },

    async list(userId: string): Promise<WebhookRow[]> {
      const rows = await repo.listWebhooksForUser(userId)
      return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    },

    async revoke(userId: string, id: string): Promise<void> {
      const rows = await repo.listWebhooksForUser(userId)
      if (!rows.some((r) => r.id === id)) throw new PagesError('NOT_FOUND', 'Webhook not found.')
      await repo.revokeWebhook(id, now())
    },

    /** null = unknown/revoked token (the route answers 404 either way). */
    async deliver(token: string, text: string): Promise<{ target: WebhookRow['target'] } | null> {
      const hook = await repo.getWebhookByTokenHash(hashToken(token))
      if (!hook || hook.revokedAt) return null
      const user = await repo.getUserById(hook.userId)
      if (!user) return null

      if (hook.target === 'inbox') {
        await daily.capture(user, text)
      } else if (hook.target === 'tasks') {
        await daily.quickAddTask(user, text)
      } else {
        const hh = String(now().getHours()).padStart(2, '0')
        const mm = String(now().getMinutes()).padStart(2, '0')
        await daily.appendToDay(user, todayKey(), `${hh}:${mm} — ${text}`)
      }
      await repo.touchWebhook(hook.id, now())
      return { target: hook.target }
    },
  }
}

export type WebhooksService = ReturnType<typeof createWebhooksService>
