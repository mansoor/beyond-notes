import { describe, expect, it } from 'vitest'
import { shareBarHtml, socialLinksHtml } from './chrome'
import { galleryHtml } from './render'

const items = [
  { url: '/api/files/a1', thumbUrl: '/api/files/a1/thumb', caption: 'one' },
  { url: '/api/files/b2', thumbUrl: '/api/files/b2/thumb', caption: '' },
]

describe('gallery layouts', () => {
  it('grid and mosaic use thumbnails in a simple container', () => {
    const grid = galleryHtml(items, 'grid')
    expect(grid).toContain('class="gallery grid"')
    expect(grid).toContain('/api/files/a1/thumb')
    const mosaic = galleryHtml(items, 'mosaic')
    expect(mosaic).toContain('class="gallery mosaic"')
  })

  it('carousel and filmstrip get a track, nav buttons, and full-size images', () => {
    for (const layout of ['carousel', 'filmstrip'] as const) {
      const html = galleryHtml(items, layout)
      expect(html).toContain(`class="gallery ${layout}"`)
      expect(html).toContain('class="track"')
      expect(html).toContain('gnav prev')
      expect(html).toContain('gnav next')
      expect(html).toContain('src="/api/files/a1"') // full image, not thumb
    }
  })

  it('default layout stays grid (legacy snapshots keep rendering)', () => {
    expect(galleryHtml(items)).toContain('class="gallery grid"')
    expect(galleryHtml([], 'carousel')).toBe('')
  })
})

describe('autoplay', () => {
  it('carousel carries the interval as a data attribute; grid never does', () => {
    expect(galleryHtml(items, 'carousel', 7)).toContain('data-autoplay="7"')
    expect(galleryHtml(items, 'carousel', null)).not.toContain('data-autoplay')
    expect(galleryHtml(items, 'grid', 7)).not.toContain('data-autoplay')
  })
})

describe('social links + share bar', () => {
  it('renders known platforms as icon links and drops junk', () => {
    const html = socialLinksHtml([
      { platform: 'github', url: 'https://github.com/x' },
      { platform: 'email', url: 'mailto:a@b.c' },
      // @ts-expect-error unknown platform must be ignored, not crash
      { platform: 'myspace', url: 'https://myspace.com/x' },
      { platform: 'x', url: '' },
    ])
    expect(html).toContain('href="https://github.com/x"')
    expect(html).toContain('href="mailto:a@b.c"')
    expect(html).not.toContain('myspace')
    expect((html.match(/<a /g) ?? []).length).toBe(2)
    expect(socialLinksHtml([])).toBe('')
  })

  it('share bar links carry the encoded url and title', () => {
    const html = shareBarHtml({ url: 'https://ex.com/a b', title: 'Hello & Co' })
    expect(html).toContain('twitter.com/intent/tweet?url=https%3A%2F%2Fex.com%2Fa%20b')
    expect(html).toContain('facebook.com/sharer')
    expect(html).toContain('linkedin.com/shareArticle')
    expect(html).toContain('mailto:?subject=Hello%20%26%20Co')
    expect(html).toContain('data-url="https://ex.com/a b"')
  })
})
