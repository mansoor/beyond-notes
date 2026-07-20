import type { Mailer } from './mailer'
import type { Repo } from './repo'
import type { SettingsService } from './settings'

/** Who a notification is for. Channels that can target a person use it. */
export type Recipient = { email: string; emailOptIn: boolean } | null

export interface Notifier {
  send(title: string, body: string, recipient: Recipient): Promise<void>
}

/** ntfy: the plan's first notification channel — self-hosted push, trivial API.
 *  Topic is instance-wide (household model), so the recipient is ignored.
 *  Config resolves per send (settings UI, env fallback); unconfigured = no-op. */
export function createNtfyNotifier(settings: SettingsService): Notifier {
  return {
    async send(title, body) {
      const ntfy = settings.effectiveNtfy()
      if (!ntfy) return
      const res = await fetch(`${ntfy.url.replace(/\/$/, '')}/${ntfy.topic}`, {
        method: 'POST',
        headers: { Title: title },
        body,
      })
      if (!res.ok) throw new Error(`ntfy responded ${res.status}`)
    },
  }
}

/** Email channel: only fires when SMTP exists and the recipient opted in. */
export function createEmailNotifier(mailer: Mailer): Notifier {
  return {
    async send(title, body, recipient) {
      if (!mailer.configured || !recipient?.emailOptIn) return
      await mailer.send(recipient.email, title, body)
    },
  }
}

export function createLogNotifier(log: (msg: string) => void): Notifier {
  return {
    async send(title, body) {
      log(`[notify] ${title} — ${body}`)
    },
  }
}

const MAX_ATTEMPTS = 3

/**
 * The 30-second tick over scheduled_jobs. Claims via a portable
 * compare-and-set (single process by design), retries transient notifier
 * failures, and catches up on anything that came due while the app was down.
 */
export function createScheduler(
  repo: Repo,
  notifiers: Notifier[],
  opts: { now?: () => Date } = {},
) {
  const now = opts.now ?? (() => new Date())
  let timer: ReturnType<typeof setInterval> | null = null

  async function processJob(job: {
    id: string
    type: string
    refId: string
    payload: string
    attempts: number
  }): Promise<void> {
    try {
      const payload = JSON.parse(job.payload) as { dueDate?: string }
      const reminder = await repo.getReminder(job.refId)

      // stale-job guard: the reminder moved on (re-armed, edited) or is gone
      if (!reminder || reminder.completedAt || reminder.dueDate !== payload.dueDate) {
        await repo.finishJob(job.id, 'done', job.attempts, 'stale — skipped')
        return
      }

      const when = reminder.dueTime ? ` at ${reminder.dueTime}` : ''
      const message =
        job.type === 'reminder-headsup'
          ? { title: `Heads-up: ${reminder.title}`, body: `Due ${reminder.dueDate}${when}` }
          : { title: `Reminder: ${reminder.title}`, body: `Due today${when}` }

      const owner = await repo.getUserById(reminder.userId)
      const recipient: Recipient = owner
        ? { email: owner.email, emailOptIn: owner.emailNotifications }
        : null
      for (const notifier of notifiers) {
        await notifier.send(message.title, message.body, recipient)
      }
      await repo.finishJob(job.id, 'done', job.attempts + 1, null)
    } catch (err) {
      const attempts = job.attempts + 1
      const message = err instanceof Error ? err.message : String(err)
      await repo.finishJob(
        job.id,
        attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        message,
      )
    }
  }

  return {
    async runOnce(): Promise<number> {
      const due = await repo.listDueJobs(now())
      let processed = 0
      for (const job of due) {
        if (!(await repo.claimJob(job.id))) continue
        await processJob(job)
        processed++
      }
      return processed
    },

    start(intervalMs = 30_000): void {
      if (timer) return
      timer = setInterval(() => {
        this.runOnce().catch(() => {
          // errors are recorded per job; the tick itself must never die
        })
      }, intervalMs)
    },

    stop(): void {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

export type Scheduler = ReturnType<typeof createScheduler>
