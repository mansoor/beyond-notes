/**
 * Analytics for published sites.
 *
 * Three deliberate constraints:
 *
 * 1. **Published pages only.** The app itself never phones anywhere; this is
 *    markup in a snapshot's chrome, not a dependency of Beyond Notes.
 * 2. **Off unless chosen.** 'none' is the default and emits nothing at all —
 *    no tag, no preconnect, no comment.
 * 3. **Every value is validated, not escaped.** These strings end up inside a
 *    `<script src>` and a `data-` attribute, where escaping is not enough:
 *    a site id of `x" onload="…` must be *rejected*, not encoded. Anything
 *    that fails the shape check emits nothing rather than a broken tag.
 *
 * Plausible and Umami are self-hostable, which is why they lead; both accept a
 * host so the script comes from your own server rather than a vendor's.
 */

export type AnalyticsProvider = 'none' | 'plausible' | 'umami' | 'ga4'

export type AnalyticsConfig = {
  provider: AnalyticsProvider
  /** Plausible: the domain. Umami: website id. GA4: measurement id. */
  siteId: string | null
  /** Self-hosted Plausible/Umami origin; empty means the vendor's own. */
  host: string | null
}

/** A hostname (optionally with a port), nothing else — no scheme, no path. */
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{2,5})?$/i
/** Ids across all three providers are alphanumerics with - _ . and nothing else. */
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/

function safeHost(host: string | null, fallback: string): string | null {
  if (!host) return fallback
  const trimmed = host
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  return HOST_RE.test(trimmed) ? trimmed : null
}

/**
 * The tag(s) for a site's analytics choice, or '' when there is nothing to add
 * — including when the configuration is malformed, which is the safe direction
 * to fail for something that injects a script.
 */
export function analyticsHtml(config: AnalyticsConfig | null | undefined): string {
  if (!config || config.provider === 'none') return ''
  const id = (config.siteId ?? '').trim()
  if (!ID_RE.test(id)) return ''

  if (config.provider === 'plausible') {
    const host = safeHost(config.host, 'plausible.io')
    if (!host) return ''
    return `<script defer data-domain="${id}" src="https://${host}/js/script.js"></script>`
  }

  if (config.provider === 'umami') {
    const host = safeHost(config.host, 'cloud.umami.is')
    if (!host) return ''
    return `<script defer src="https://${host}/script.js" data-website-id="${id}"></script>`
  }

  // GA4 is the one that cannot be self-hosted; it is here because people ask
  // for it, not because it fits the rest of this project's posture
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id}')</script>`
}
