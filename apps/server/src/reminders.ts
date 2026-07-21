import { nanoid } from 'nanoid'
import { PagesError } from './pages'
import type { JobRow, ReminderRow, Repo, UserRow } from './repo'

// ---- date-only recurrence math (no timezones, no DST edges) ----

export function parseDateKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number)
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 }
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

export function addDays(key: string, days: number): string {
  const { y, m, d } = parseDateKey(key)
  const date = new Date(y, m - 1, d + days)
  return fmt(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** Next occurrence after one recurrence step; month/year steps clamp the day (Jan 31 → Feb 28). */
export function advance(
  key: string,
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly',
  interval: number,
): string {
  const { y, m, d } = parseDateKey(key)
  switch (freq) {
    case 'daily':
      return addDays(key, interval)
    case 'weekly':
      return addDays(key, 7 * interval)
    case 'monthly': {
      const total = m - 1 + interval
      const year = y + Math.floor(total / 12)
      const month = (total % 12) + 1
      return fmt(year, month, Math.min(d, daysInMonth(year, month)))
    }
    case 'yearly': {
      const year = y + interval
      return fmt(year, m, Math.min(d, daysInMonth(year, m)))
    }
  }
}

/** Advance repeatedly until strictly after `today` (completing late skips missed occurrences). */
export function advancePastToday(
  key: string,
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly',
  interval: number,
  today: string,
): string {
  let next = advance(key, freq, interval)
  let guard = 0
  while (next <= today && guard < 1000) {
    next = advance(next, freq, interval)
    guard++
  }
  return next
}

/** The Date a notification fires for a given local date + optional HH:MM (default 09:00). */
export function notifyAt(dateKey: string, time: string | null): Date {
  const { y, m, d } = parseDateKey(dateKey)
  const [hh, mm] = (time ?? '09:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh ?? 9, mm ?? 0, 0, 0)
}

function todayKeyOf(now: Date): string {
  return fmt(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

// ---- service ----

export function createRemindersService(repo: Repo, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  async function enqueueJobs(reminder: ReminderRow): Promise<void> {
    await repo.cancelPendingJobsForRef(reminder.id)
    const jobs: JobRow[] = []
    const dueAt = notifyAt(reminder.dueDate, reminder.dueTime)
    if (dueAt.getTime() > now().getTime()) {
      jobs.push({
        id: nanoid(),
        type: 'reminder-due',
        refId: reminder.id,
        payload: JSON.stringify({ dueDate: reminder.dueDate }),
        runAt: dueAt,
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: now(),
      })
    }
    if (reminder.headsUpDays) {
      const headsUpAt = notifyAt(addDays(reminder.dueDate, -reminder.headsUpDays), reminder.dueTime)
      if (headsUpAt.getTime() > now().getTime()) {
        jobs.push({
          id: nanoid(),
          type: 'reminder-headsup',
          refId: reminder.id,
          payload: JSON.stringify({ dueDate: reminder.dueDate }),
          runAt: headsUpAt,
          status: 'pending',
          attempts: 0,
          lastError: null,
          createdAt: now(),
        })
      }
    }
    for (const job of jobs) await repo.insertJob(job)
  }

  async function requireReminder(user: UserRow, id: string): Promise<ReminderRow> {
    const reminder = await repo.getReminder(id)
    if (!reminder || reminder.userId !== user.id) {
      throw new PagesError('NOT_FOUND', 'Reminder not found.')
    }
    return reminder
  }

  return {
    async create(
      user: UserRow,
      input: {
        title: string
        icon?: string | null
        dueDate: string
        dueTime: string | null
        freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
        interval: number
        headsUpDays: number | null
      },
    ): Promise<ReminderRow> {
      const reminder: ReminderRow = {
        id: nanoid(),
        userId: user.id,
        title: input.title,
        icon: input.icon ?? null,
        dueDate: input.dueDate,
        dueTime: input.dueTime,
        freq: input.freq,
        interval: input.interval,
        headsUpDays: input.headsUpDays,
        completedAt: null,
        createdAt: now(),
      }
      await repo.insertReminder(reminder)
      await enqueueJobs(reminder)
      return reminder
    },

    /** Edit any field. Re-schedules from scratch so date/heads-up changes stick. */
    async update(
      user: UserRow,
      input: {
        id: string
        title: string
        icon: string | null
        dueDate: string
        dueTime: string | null
        freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
        interval: number
        headsUpDays: number | null
      },
    ): Promise<void> {
      const existing = await requireReminder(user, input.id)
      await repo.updateReminder(input.id, {
        title: input.title,
        icon: input.icon,
        dueDate: input.dueDate,
        dueTime: input.dueTime,
        freq: input.freq,
        interval: input.interval,
        headsUpDays: input.headsUpDays,
        // editing a completed reminder re-activates it
        completedAt: null,
      })
      await repo.cancelPendingJobsForRef(input.id)
      await enqueueJobs({ ...existing, ...input, completedAt: null })
    },

    async list(user: UserRow): Promise<ReminderRow[]> {
      const rows = await repo.listReminders(user.id)
      return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    },

    /** Check off: one-time completes; recurring re-arms past today and re-schedules. */
    async complete(user: UserRow, id: string): Promise<void> {
      const reminder = await requireReminder(user, id)
      if (!reminder.freq) {
        await repo.updateReminder(id, { completedAt: now() })
        await repo.cancelPendingJobsForRef(id)
        return
      }
      const next = advancePastToday(
        reminder.dueDate,
        reminder.freq,
        reminder.interval,
        todayKeyOf(now()),
      )
      await repo.updateReminder(id, { dueDate: next })
      await enqueueJobs({ ...reminder, dueDate: next })
    },

    async remove(user: UserRow, id: string): Promise<void> {
      await requireReminder(user, id)
      await repo.cancelPendingJobsForRef(id)
      await repo.deleteReminder(id)
    },
  }
}

export type RemindersService = ReturnType<typeof createRemindersService>
