import { describe, expect, it } from 'vitest'
import { sitePage } from './site'

const base = {
  siteTitle: 'Acme',
  footer: '',
  basePath: '',
  title: 'Home',
  contentHtml: '<p>hi</p>',
  theme: 'paper' as const,
}

describe('site header nav icons', () => {
  it('renders a page icon before the menu title and loads the font only when named', () => {
    const withMaterial = sitePage({
      ...base,
      nav: [{ title: 'Docs', path: '/docs', icon: 'rocket_launch' }],
    })
    expect(withMaterial).toContain('<span class="ico msym">rocket_launch</span>')
    expect(withMaterial).toContain('/api/assets/material-symbols.woff2')

    const withEmoji = sitePage({
      ...base,
      nav: [{ title: 'Docs', path: '/docs', icon: '🚀' }],
    })
    expect(withEmoji).toContain('<span class="ico">🚀</span>')
    // an emoji does not pull in the icon font
    expect(withEmoji).not.toContain('material-symbols.woff2')

    const noIcon = sitePage({ ...base, nav: [{ title: 'Docs', path: '/docs' }] })
    expect(noIcon).not.toContain('class="ico"')
    expect(noIcon).not.toContain('material-symbols.woff2')
  })
})
