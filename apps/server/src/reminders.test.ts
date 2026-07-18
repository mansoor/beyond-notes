import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { advance, advancePastToday, createRemindersService, notifyAt } from './reminders'
import { createRepo } from './repo'
import { type Notifier, createScheduler } from './scheduler'

describe('recurrence math (pure)', () => {
  it('advances daily/weekly/monthly/yearly with clamping', () => {
    expect(advance('2026-07-18', 'daily', 3)).toBe('2026-07-21')
    expect(advance('2026-07-18', 'weekly', 1)).toBe('2026-07-25')
    expect(advance('2026-01-31', 'monthly', 1)).toBe('2026-02-28') // clamp
    expect(advance('2026-11-30', 'monthly', 3)).toBe('2027-02-28') // year rollover + clamp
    expect(advance('2024-02-29', 'yearly', 1)).toBe('2025-02-28') // leap clamp
    expect(advance('2026-12-25', 'yearly', 2)).toBe('2028-12-25')
  })

  it('advancePastToday skips missed occurrences', () => {
    // weekly reminder last due a month ago, completed today
    expect(advancePastToday('2026-06-16', 'weekly', 1, '2026-07-18')).toBe('2026-07-21')
    // already in the future: single step
    expect(advancePastToday('2026-07-20', 'weekly', 1, '2026-07-18')).toBe('2026-07-27')
  })

  it('notifyAt defaults to 09:00 local', () => {
    const at = notifyAt('2026-07-20', null)
    expect(at.getHours()).toBe(9)
    const timed = notifyAt('2026-07-20', '18:30')
    expect(timed.getHours()).toBe(18)
    expect(timed.getMinutes()).toBe(30)
  })
})

const dialects: Array<{ name: string; make: () => Promise<AppDb> }> = [
  {
    name: 'sqlite',
    make: async () => {
      const db = createDb('file::memory:')
      await db.migrate('./drizzle')
      return db
    },
  },
]

if (process.env.TEST_PG_URL) {
  dialects.push({
    name: 'pg',
    make: async () => {
      const db = createDb(process.env.TEST_PG_URL as string)
      await db.db.execute(sql.raw('drop schema public cascade'))
      await db.db.execute(sql.raw('create schema public'))
      await db.db.execute(sql.raw('drop schema if exists drizzle cascade'))
      await db.migrate('./drizzle')
      return db
    },
  })
}

for (const dialect of dialects) {
  describe(`reminders + scheduler (${dialect.name})`, () => {
    async function setup(startAt = new Date(2026, 6, 18, 8, 0)) {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const clock = { value: startAt }
      const nowFn = () => new Date(clock.value)
      const reminders = createRemindersService(repo, { now: nowFn })
      const sent: Array<{ title: string; body: string }> = []
      const notifier: Notifier = {
        async send(title, body) {
          sent.push({ title, body })
        },
      }
      const scheduler = createScheduler(repo, [notifier], { now: nowFn })
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      return { appDb, repo, reminders, scheduler, clock, sent, user }
    }

    it('due + heads-up jobs are scheduled and fire at the right times', async () => {
      const { appDb, reminders, scheduler, clock, sent, user } = await setup()
      await reminders.create(user, {
        title: 'Car registration',
        dueDate: '2026-07-25',
        dueTime: null,
        freq: 'yearly',
        interval: 1,
        headsUpDays: 5,
      })

      // nothing fires early
      expect(await scheduler.runOnce()).toBe(0)

      // heads-up: 5 days before, at 09:00 on Jul 20
      clock.value = new Date(2026, 6, 20, 9, 1)
      expect(await scheduler.runOnce()).toBe(1)
      expect(sent[0]?.title).toBe('Heads-up: Car registration')
      expect(sent[0]?.body).toContain('2026-07-25')

      // due day
      clock.value = new Date(2026, 6, 25, 9, 1)
      expect(await scheduler.runOnce()).toBe(1)
      expect(sent[1]?.title).toBe('Reminder: Car registration')

      // idempotent: nothing left
      expect(await scheduler.runOnce()).toBe(0)
      await appDb.close()
    })

    it('completing a recurring reminder re-arms it and stales old jobs', async () => {
      const { appDb, repo, reminders, scheduler, clock, sent, user } = await setup()
      const r = await reminders.create(user, {
        title: 'Take out the bins',
        dueDate: '2026-07-21',
        dueTime: '20:00',
        freq: 'weekly',
        interval: 1,
        headsUpDays: null,
      })

      // complete before it fires → next week, old job cancelled
      await reminders.complete(user, r.id)
      const updated = await repo.getReminder(r.id)
      expect(updated?.dueDate).toBe('2026-07-28')
      expect(updated?.completedAt).toBeNull()

      clock.value = new Date(2026, 6, 21, 20, 5)
      expect(await scheduler.runOnce()).toBe(0) // old occurrence cancelled

      clock.value = new Date(2026, 6, 28, 20, 5)
      expect(await scheduler.runOnce()).toBe(1)
      expect(sent[0]?.body).toContain('at 20:00')
      await appDb.close()
    })

    it('one-time reminders complete for good; delete cancels everything', async () => {
      const { appDb, repo, reminders, scheduler, clock, user } = await setup()
      const once = await reminders.create(user, {
        title: 'Renew passport',
        dueDate: '2026-08-01',
        dueTime: null,
        freq: null,
        interval: 1,
        headsUpDays: 7,
      })
      await reminders.complete(user, once.id)
      expect((await repo.getReminder(once.id))?.completedAt).not.toBeNull()
      clock.value = new Date(2026, 7, 2, 12, 0)
      expect(await scheduler.runOnce()).toBe(0)

      const gone = await reminders.create(user, {
        title: 'Temp',
        dueDate: '2026-08-03',
        dueTime: null,
        freq: null,
        interval: 1,
        headsUpDays: null,
      })
      await reminders.remove(user, gone.id)
      clock.value = new Date(2026, 7, 4, 12, 0)
      expect(await scheduler.runOnce()).toBe(0)
      await appDb.close()
    })

    it('notifier failures retry, then mark the job failed', async () => {
      const { appDb, repo, reminders, clock, user } = await setup()
      let calls = 0
      const flaky: Notifier = {
        async send() {
          calls++
          throw new Error('ntfy down')
        },
      }
      const nowFn = () => new Date(clock.value)
      const scheduler = createScheduler(repo, [flaky], { now: nowFn })
      await reminders.create(user, {
        title: 'X',
        dueDate: '2026-07-19',
        dueTime: null,
        freq: null,
        interval: 1,
        headsUpDays: null,
      })
      clock.value = new Date(2026, 6, 19, 9, 1)
      await scheduler.runOnce() // attempt 1 → pending
      await scheduler.runOnce() // attempt 2 → pending
      await scheduler.runOnce() // attempt 3 → failed
      await scheduler.runOnce() // no more attempts
      expect(calls).toBe(3)
      await appDb.close()
    })

    it('reminders are per-user', async () => {
      const { appDb, repo, reminders, user } = await setup()
      const auth = createAuthService(repo)
      const invite = await auth.createInvite(user.id, { role: 'member' })
      const { user: member } = await auth.acceptInvite({
        token: invite.token,
        name: 'P',
        email: 'p@x.dev',
        password: 'longpassword2',
      })
      const r = await reminders.create(user, {
        title: 'Mine',
        dueDate: '2026-08-01',
        dueTime: null,
        freq: null,
        interval: 1,
        headsUpDays: null,
      })
      expect(await reminders.list(member)).toHaveLength(0)
      await expect(reminders.complete(member, r.id)).rejects.toThrow('not found')
      await appDb.close()
    })
  })
}
