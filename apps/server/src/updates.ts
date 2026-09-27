/**
 * "Is there a newer version?" Asks the releases feed at most twice a day and
 * compares versions. Off with UPDATE_CHECK=false. The only thing sent is an
 * ordinary GET to the feed; nothing about this instance goes with it.
 */

export type UpdateInfo = {
  current: string
  latest: string | null
  available: boolean
  url: string | null
}

const CACHE_MS = 12 * 60 * 60 * 1000

/** Compare "1.2.3" style versions; a leading "v" and any suffix are ignored. */
export function newerThan(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      ?.split('.')
      .map((n) => Number.parseInt(n, 10) || 0) ?? []
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export function createUpdateChecker(opts: {
  current: string
  feedUrl: string
  enabled: boolean
  fetch?: typeof fetch
  now?: () => number
}) {
  const fetcher = opts.fetch ?? fetch
  const now = opts.now ?? Date.now
  let cached: { at: number; info: UpdateInfo } | null = null
  let inflight: Promise<UpdateInfo> | null = null
  const none: UpdateInfo = { current: opts.current, latest: null, available: false, url: null }

  async function fetchLatest(): Promise<UpdateInfo> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const res = await fetcher(opts.feedUrl, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'beyond-notes' },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) return none
      const body = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean }
      if (!body.tag_name || body.draft) return none
      const latest = body.tag_name.replace(/^v/i, '')
      return {
        current: opts.current,
        latest,
        available: newerThan(latest, opts.current),
        url: body.html_url ?? null,
      }
    } catch {
      return none
    }
  }

  return {
    async check(): Promise<UpdateInfo> {
      if (!opts.enabled) return none
      if (cached && now() - cached.at < CACHE_MS) return cached.info
      inflight ??= fetchLatest().finally(() => {
        inflight = null
      })
      const info = await inflight
      cached = { at: now(), info }
      return info
    },
  }
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>
