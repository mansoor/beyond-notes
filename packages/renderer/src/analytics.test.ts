import { describe, expect, it } from 'vitest'
import { type AnalyticsConfig, analyticsHtml } from './analytics'

const cfg = (over: Partial<AnalyticsConfig>): AnalyticsConfig => ({
  provider: 'none',
  siteId: null,
  host: null,
  ...over,
})

describe('analyticsHtml', () => {
  it('emits nothing at all when off — no tag, no comment', () => {
    expect(analyticsHtml(null)).toBe('')
    expect(analyticsHtml(cfg({ provider: 'none', siteId: 'x.com' }))).toBe('')
  })

  it('uses the vendor host by default and a self-hosted one when given', () => {
    expect(analyticsHtml(cfg({ provider: 'plausible', siteId: 'example.com' }))).toBe(
      '<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>',
    )
    expect(
      analyticsHtml(cfg({ provider: 'plausible', siteId: 'example.com', host: 'stats.mine.dev' })),
    ).toContain('https://stats.mine.dev/js/script.js')
    expect(analyticsHtml(cfg({ provider: 'umami', siteId: 'abc-123', host: 'u.mine.dev' }))).toBe(
      '<script defer src="https://u.mine.dev/script.js" data-website-id="abc-123"></script>',
    )
  })

  it('accepts a host pasted with its scheme or a trailing slash', () => {
    const html = analyticsHtml(
      cfg({ provider: 'plausible', siteId: 'example.com', host: 'https://stats.mine.dev/' }),
    )
    expect(html).toContain('src="https://stats.mine.dev/js/script.js"')
    expect(html).not.toContain('https://https://')
  })

  it('wires GA4 through gtag', () => {
    const html = analyticsHtml(cfg({ provider: 'ga4', siteId: 'G-ABC123' }))
    expect(html).toContain('googletagmanager.com/gtag/js?id=G-ABC123')
    expect(html).toContain("gtag('config','G-ABC123')")
  })

  it('refuses a malformed id rather than encoding it into a script tag', () => {
    // escaping is not enough here: these land in src= and data- attributes, so
    // anything that is not plainly an id must produce no tag at all
    for (const bad of [
      'x" onload="alert(1)',
      "x' onerror='alert(1)",
      '</script><script>alert(1)</script>',
      'has space',
      '',
      'a'.repeat(65),
    ]) {
      expect(analyticsHtml(cfg({ provider: 'plausible', siteId: bad }))).toBe('')
      expect(analyticsHtml(cfg({ provider: 'ga4', siteId: bad }))).toBe('')
    }
  })

  it('refuses a malformed host the same way', () => {
    for (const bad of ['evil.com/../x', 'a b.com', 'javascript:alert(1)', 'x.com"onload="y']) {
      expect(analyticsHtml(cfg({ provider: 'umami', siteId: 'ok-1', host: bad }))).toBe('')
    }
  })
})
