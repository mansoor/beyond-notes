import { isComingUp, shiftDayKey } from '@bn/schema'
import { describe, expect, it } from 'vitest'

/**
 * The rule behind the Today page's "Coming up" list. It had no upper bound for
 * reminders at all, which is how one due in nine months ended up on today's
 * page — so the horizon is the thing worth pinning down.
 */
describe('isComingUp', () => {
  const today = '2026-07-21'
  const week = { today, horizonDays: 7 }

  it('takes what lands inside the horizon', () => {
    expect(isComingUp({ dueDate: '2026-07-22' }, week)).toBe(true)
    expect(isComingUp({ dueDate: '2026-07-28' }, week)).toBe(true) // exactly 7 days
  })

  it('leaves out what is beyond it — the nine-months-away reminder', () => {
    expect(isComingUp({ dueDate: '2026-07-29' }, week)).toBe(false)
    expect(isComingUp({ dueDate: '2027-04-15' }, week)).toBe(false)
  })

  it('leaves overdue and today to the column, not the rail', () => {
    expect(isComingUp({ dueDate: today }, week)).toBe(false)
    expect(isComingUp({ dueDate: '2026-07-01' }, week)).toBe(false)
  })

  it('still surfaces a distant reminder once its heads-up window opens', () => {
    // passport renewal 9 months out, asking for 30 days' notice: silent for now…
    const passport = { dueDate: '2027-04-15', headsUpDays: 30 }
    expect(isComingUp(passport, week)).toBe(false)
    // …and shown the day that window opens, horizon or no horizon
    expect(isComingUp(passport, { today: '2027-03-16', horizonDays: 7 })).toBe(true)
  })

  it('honours a longer horizon', () => {
    const far = { dueDate: '2026-08-15' }
    expect(isComingUp(far, week)).toBe(false)
    expect(isComingUp(far, { today, horizonDays: 30 })).toBe(true)
  })

  it('treats no heads-up as no exception', () => {
    expect(isComingUp({ dueDate: '2027-04-15', headsUpDays: null }, week)).toBe(false)
  })
})

describe('shiftDayKey', () => {
  it('crosses months, years and a leap day without drifting', () => {
    expect(shiftDayKey('2026-07-31', 1)).toBe('2026-08-01')
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDayKey('2028-02-28', 1)).toBe('2028-02-29') // 2028 is a leap year
    expect(shiftDayKey('2026-07-21', 0)).toBe('2026-07-21')
  })
})
