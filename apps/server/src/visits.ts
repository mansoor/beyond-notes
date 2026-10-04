/**
 * Built-in visit counts for published sites: how many views and visitors each
 * page had per day, and which sites sent them. Counted on the server as the
 * page is served — no script, no cookie, nothing sent anywhere.
 *
 * Privacy by construction:
 * - only daily totals are stored, never a visit, an IP address or a browser;
 * - "unique visitor" is a hash of IP and browser with a random salt that
 *   changes every day and is never written down, so nobody can be followed
 *   from one day to the next (or recognised at all once the day is over);
 * - bots and link previews aren't counted.
 *
 * Whether a site is counted is an edition's call (a paid feature); this module
 * counts, buffers in memory, and writes once a minute.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Repo } from './repo'

const BOT =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|slack|preview|monitor|uptime|curl|wget|python-requests|headless|lighthouse/i
// past this many distinct visitors in a day the dedupe set stops growing;
// further visits still count as views (and as new visitors, an overcount)
const SEEN_CAP = 500_000

export type VisitInput = {
  spaceId: string
  /** the page path, no query string */
  path: string
  ip: string
  userAgent: string
  referer: string | null
  /** the site's own host, so internal navigation isn't a "referrer" */
  siteHost: string
}

const today = (now: Date) => now.toISOString().slice(0, 10)

/** A referrer's host, or null for none / the site itself / something unusable. */
export function referrerHost(referer: string | null, siteHost: string): string | null {
  if (!referer) return null
  try {
    const u = new URL(referer)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const own =
      siteHost
        .toLowerCase()
        .split(':')[0]
        ?.replace(/^www\./, '') ?? ''
    return host && host !== own ? host.slice(0, 200) : null
  } catch {
    return null
  }
}

export function createVisitRecorder(deps: {
  repo: Repo
  now?: () => Date
  onError?: (err: unknown) => void
}) {
  const now = deps.now ?? (() => new Date())
  let day = today(now())
  let salt = randomBytes(32)
  let seen = new Set<string>()
  // spaceId|day|path → counts, and spaceId|day|host → views, waiting to be written
  let visits = new Map<
    string,
    { spaceId: string; day: string; path: string; views: number; visitors: number }
  >()
  let refs = new Map<string, { spaceId: string; day: string; host: string; views: number }>()

  function rollDay() {
    const d = today(now())
    if (d === day) return
    // a new day: new salt, and yesterday's visitors are forgotten for good
    day = d
    salt = randomBytes(32)
    seen = new Set()
  }

  function bump(spaceId: string, path: string, newVisitor: boolean) {
    const key = `${spaceId}|${day}|${path}`
    const row = visits.get(key) ?? { spaceId, day, path, views: 0, visitors: 0 }
    row.views += 1
    if (newVisitor) row.visitors += 1
    visits.set(key, row)
  }

  return {
    /** Count one page view. Returns false when it wasn't counted (a bot). */
    record(v: VisitInput): boolean {
      if (!v.userAgent || BOT.test(v.userAgent)) return false
      rollDay()
      const who = createHash('sha256')
        .update(salt)
        .update(v.spaceId)
        .update('\0')
        .update(v.ip)
        .update('\0')
        .update(v.userAgent)
        .digest('base64url')
        .slice(0, 22)
      const path = (v.path || '/').slice(0, 300)
      const isNew = (key: string) => {
        if (seen.has(key)) return false
        if (seen.size < SEEN_CAP) seen.add(key)
        return true
      }
      // the site as a whole (path ''), and the page
      bump(v.spaceId, '', isNew(`${v.spaceId}||${who}`))
      bump(v.spaceId, path, isNew(`${v.spaceId}|${path}|${who}`))
      const host = referrerHost(v.referer, v.siteHost)
      if (host) {
        const key = `${v.spaceId}|${day}|${host}`
        const row = refs.get(key) ?? { spaceId: v.spaceId, day, host, views: 0 }
        row.views += 1
        refs.set(key, row)
      }
      return true
    },

    /** Write what's been counted since the last flush. Never throws. */
    async flush(): Promise<void> {
      const v = [...visits.values()]
      const r = [...refs.values()]
      visits = new Map()
      refs = new Map()
      if (v.length === 0 && r.length === 0) return
      try {
        await deps.repo.addSiteVisits(v)
        await deps.repo.addSiteReferrers(r)
      } catch (err) {
        deps.onError?.(err)
      }
    },

    /** Drop daily rows older than `days`. */
    async prune(days: number): Promise<void> {
      const cutoff = today(new Date(now().getTime() - days * 86_400_000))
      await deps.repo.deleteSiteVisitsBefore(cutoff)
    },
  }
}

export type VisitRecorder = ReturnType<typeof createVisitRecorder>
