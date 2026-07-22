import { describe, expect, it } from 'vitest'
import {
  type PostListItem,
  albumCardsHtml,
  categoryFilterHtml,
  siteBlogIndex,
  sitePage,
  sitePost,
} from './site'

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

const posts: PostListItem[] = [
  {
    title: 'Shipping it',
    path: '/blog/shipping-it',
    date: '2026-07-01',
    snippet: 'A container and a prayer',
    cover: '/api/files/img1/thumb',
    category: 'Engineering',
  },
  {
    title: 'On attention',
    path: '/blog/on-attention',
    date: '2026-06-02',
    snippet: 'The scarce thing',
    cover: null,
    category: 'Essays',
  },
]

const blogBase = {
  ...base,
  title: 'Blog',
  introHtml: '<p>Writing</p>',
  posts,
  rssPath: '/rss.xml',
  nav: [],
  pagination: { page: 1, totalPages: 1, blogPath: '/blog' },
}

describe('blog post layouts', () => {
  it('defaults to the dated list', () => {
    const html = siteBlogIndex(blogBase)
    expect(html).toContain('<div class="postlist">')
    // (the grid's CSS is always in the stylesheet — it is the markup that must be absent)
    expect(html).not.toContain('<div class="postgrid">')
    expect(html).toContain('class="date">2026-07-01')
  })

  it('renders cards with covers when the blog asks for a grid', () => {
    const html = siteBlogIndex({ ...blogBase, layout: 'grid' })
    expect(html).toContain('<div class="postgrid">')
    expect(html).not.toContain('<div class="postlist">')
    expect(html).toContain('<img class="pcover" src="/api/files/img1/thumb"')
    // a post with no cover still gets a card, with a placeholder tile
    expect(html).toContain('class="pcover empty"')
    expect(html).toContain('<span class="ptitle">On attention</span>')
    // cards are single links — a nested <a> for the category would be invalid
    expect(html).toContain('<span class="cat">Essays</span>')
  })

  it('says something different when a filter is what emptied the list', () => {
    expect(siteBlogIndex({ ...blogBase, posts: [] })).toContain('No posts yet.')
    expect(siteBlogIndex({ ...blogBase, posts: [], activeCategory: 'essays' })).toContain(
      'No posts in this category.',
    )
  })
})

describe('categories', () => {
  it('offers every category plus a way back to everything', () => {
    const html = categoryFilterHtml({
      categories: ['Engineering', 'Essays'],
      active: 'essays',
      basePath: '',
      path: '/blog',
    })
    expect(html).toContain('href="/blog"')
    expect(html).toContain('href="/blog?category=engineering"')
    // the one in force is marked, the others are not
    expect(html).toContain('<a class="on" href="/blog?category=essays">Essays</a>')
    expect(html).toContain('<a class="" href="/blog?category=engineering">')
  })

  it('renders nothing when a blog has no categories at all', () => {
    expect(categoryFilterHtml({ categories: [], active: null, basePath: '', path: '/blog' })).toBe(
      '',
    )
  })

  it('keeps the filter on the pager — paging must not silently widen it', () => {
    const html = siteBlogIndex({
      ...blogBase,
      categories: ['Essays'],
      activeCategory: 'essays',
      pagination: { page: 1, totalPages: 3, blogPath: '/blog' },
    })
    expect(html).toContain('href="/blog?category=essays&amp;page=2"')
  })

  it('links a post back to its siblings, and labels albums', () => {
    const post = sitePost({
      ...base,
      nav: [],
      title: 'On attention',
      date: '2026-06-02',
      contentHtml: '<p>x</p>',
      blogPath: '/blog',
      blogTitle: 'Blog',
      category: 'Field notes',
    })
    expect(post).toContain('href="/blog?category=field-notes"')
    expect(post).toContain('>Field notes</a>')

    const albums = albumCardsHtml(
      [{ title: 'Iceland', path: '/photos/iceland', coverUrl: null, count: 4, category: 'Travel' }],
      '',
    )
    expect(albums).toContain('<span class="cat">Travel</span>')
  })

  it('escapes a category rather than trusting the name', () => {
    const html = categoryFilterHtml({
      categories: ['<img src=x onerror=alert(1)>'],
      active: null,
      basePath: '',
      path: '/blog',
    })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})

describe('site layout width', () => {
  it('gives header, main and footer the same content column so their edges align', () => {
    const html = sitePage({
      ...base,
      nav: [{ title: 'Home', path: '/', active: true }],
      contentHtml: '<h1>Hi</h1>',
    })
    // one shared variable, referenced by all three — a regression to separate
    // pixel widths (the header once ran 1140 vs main's 880) would break this
    expect(html).toContain('--site-w:960px')
    expect(html).toContain('header{padding:18px 40px;max-width:var(--site-w)')
    expect(html).toContain('main{max-width:var(--site-w)')
    expect(html).toMatch(/footer\{[^}]*max-width:var\(--site-w\)/)
    // no stray fixed max-widths left on the chrome
    expect(html).not.toContain('max-width:1140px')
  })
})
