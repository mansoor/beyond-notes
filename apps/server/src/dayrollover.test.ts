import { msUntilNextMidnight } from '@bn/schema'
import { describe, expect, it } from 'vitest'

/**
 * The day view schedules a wake-up on this number, so being wrong means either
 * a missed rollover or a busy-loop at midnight.
 */
describe('msUntilNextMidnight', () => {
  const at = (iso: string) => new Date(iso)

  it('counts to the next local midnight', () => {
    // 23:00 local -> one hour
    expect(msUntilNextMidnight(at('2026-07-21T23:00:00'))).toBe(60 * 60 * 1000)
    // 00:00 local -> a full day, not zero
    expect(msUntilNextMidnight(at('2026-07-21T00:00:00'))).toBe(24 * 60 * 60 * 1000)
  })

  it('never returns zero or a negative wait', () => {
    // a millisecond before midnight still schedules forward
    expect(msUntilNextMidnight(at('2026-07-21T23:59:59.999'))).toBeGreaterThan(0)
  })

  it('crosses month and year boundaries', () => {
    expect(msUntilNextMidnight(at('2026-07-31T23:30:00'))).toBe(30 * 60 * 1000)
    expect(msUntilNextMidnight(at('2026-12-31T23:30:00'))).toBe(30 * 60 * 1000)
  })

  it('lands on midnight even on the days that are not 24 hours long', () => {
    // the two DST switches: adding 24h would miss midnight by an hour in a zone
    // that observes them, so the wait is computed from tomorrow's date instead
    for (const iso of ['2026-03-08T01:30:00', '2026-11-01T00:30:00', '2026-06-15T12:00:00']) {
      const now = at(iso)
      const then = new Date(now.getTime() + msUntilNextMidnight(now))
      expect([then.getHours(), then.getMinutes(), then.getSeconds()]).toEqual([0, 0, 0])
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      expect(then.getDate()).toBe(tomorrow.getDate())
    }
  })
})
