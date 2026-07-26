import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDailyService } from './daily'
import { createDb } from './db'
import { createRepo } from './repo'

async function setup() {
  const db = createDb('file::memory:')
  await db.migrate('./drizzle')
  const repo = createRepo(db)
  const daily = createDailyService(repo)
  const { user } = await createAuthService(repo).setup({
    name: 'M',
    email: 'm@x.dev',
    password: 'longpassword1',
  })
  return { repo, daily, user }
}

describe('daily.journalTimeline (sqlite)', () => {
  it('lists days newest-first with a preview, and paginates by cursor', async () => {
    const { daily, user } = await setup()
    await daily.appendToDay(user, '2026-07-20', 'twentieth entry')
    await daily.appendToDay(user, '2026-07-22', 'twenty-second entry')
    await daily.appendToDay(user, '2026-07-21', 'twenty-first entry')

    const all = await daily.journalTimeline(user, { limit: 40, cursor: 0 })
    expect(all.items.map((i) => i.date)).toEqual(['2026-07-22', '2026-07-21', '2026-07-20'])
    expect(all.items[0]?.preview).toContain('twenty-second')
    expect(all.nextCursor).toBeNull()

    const first = await daily.journalTimeline(user, { limit: 2, cursor: 0 })
    expect(first.items.map((i) => i.date)).toEqual(['2026-07-22', '2026-07-21'])
    expect(first.nextCursor).toBe(2)
    const second = await daily.journalTimeline(user, { limit: 2, cursor: 2 })
    expect(second.items.map((i) => i.date)).toEqual(['2026-07-20'])
    expect(second.nextCursor).toBeNull()
  })

  it('excludes a day that was opened but never written in', async () => {
    const { daily, user } = await setup()
    await daily.appendToDay(user, '2026-07-20', 'a real entry')
    await daily.day(user, '2026-07-21') // opens Today for the 21st — creates an empty day page
    const t = await daily.journalTimeline(user, { limit: 40, cursor: 0 })
    // only the day with actual text shows; the empty shell does not
    expect(t.items.map((i) => i.date)).toEqual(['2026-07-20'])
  })

  it('skips the tasks-inbox sentinel page', async () => {
    const { daily, user } = await setup()
    await daily.tasksInboxPage(user) // creates the 'inbox' sentinel in the journal space
    await daily.appendToDay(user, '2026-07-20', 'a real day')
    const t = await daily.journalTimeline(user, { limit: 40, cursor: 0 })
    expect(t.items.map((i) => i.date)).toEqual(['2026-07-20'])
  })

  it('counts topic notes and previews the main note', async () => {
    const { daily, user } = await setup()
    await daily.appendToDay(user, '2026-07-20', 'main note body')
    await daily.createDayNote(user, '2026-07-20', 'Work')
    const t = await daily.journalTimeline(user, { limit: 40, cursor: 0 })
    expect(t.items[0]?.notes).toBe(2)
    expect(t.items[0]?.preview).toContain('main note body')
  })
})
