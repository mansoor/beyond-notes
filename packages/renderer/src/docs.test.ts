import { describe, expect, it } from 'vitest'
import { highlightCode } from './highlight'
import { blocknoteToHtml, extractHeadings } from './render'
import { docsShell } from './theme'

const heading = (id: string, text: string, level = 1) => ({
  id,
  type: 'heading',
  props: { level },
  content: [{ type: 'text', text, styles: {} }],
  children: [],
})

const code = (text: string, language: string) => ({
  id: `c${language}`,
  type: 'codeBlock',
  props: { language },
  content: [{ type: 'text', text, styles: {} }],
  children: [],
})

describe('heading anchors + TOC', () => {
  it('gives headings slugged ids and an anchor link', () => {
    const html = blocknoteToHtml(JSON.stringify([heading('a', 'Getting Started')]))
    expect(html).toContain('<h2 id="getting-started">')
    expect(html).toContain('href="#getting-started"')
    expect(html).toContain('class="hanchor"')
  })

  it('dedupes repeated heading text so ids stay unique', () => {
    const doc = JSON.stringify([
      heading('a', 'Setup'),
      heading('b', 'Setup'),
      heading('c', 'Setup'),
    ])
    const html = blocknoteToHtml(doc)
    expect(html).toContain('id="setup"')
    expect(html).toContain('id="setup-2"')
    expect(html).toContain('id="setup-3"')
    // the TOC agrees with the rendered ids — the whole point of sharing the rule
    expect(extractHeadings(doc).map((t) => t.id)).toEqual(['setup', 'setup-2', 'setup-3'])
  })

  it('extracts levels and text, and survives junk input', () => {
    const doc = JSON.stringify([heading('a', 'Top', 1), heading('b', 'Nested', 2)])
    expect(extractHeadings(doc)).toEqual([
      { level: 2, text: 'Top', id: 'top' },
      { level: 3, text: 'Nested', id: 'nested' },
    ])
    expect(extractHeadings('not json')).toEqual([])
    expect(extractHeadings('[]')).toEqual([])
  })

  it('renders the TOC only when there are at least two headings', () => {
    const base = {
      siteTitle: 'Docs',
      footer: '',
      pageTitle: 'P',
      contentHtml: '<p>x</p>',
      nav: [],
      basePath: '',
    }
    const one = docsShell({ ...base, toc: [{ level: 2, text: 'Only', id: 'only' }] })
    expect(one).not.toContain('On this page')
    const two = docsShell({
      ...base,
      toc: [
        { level: 2, text: 'One', id: 'one' },
        { level: 3, text: 'Two', id: 'two' },
      ],
    })
    expect(two).toContain('On this page')
    expect(two).toContain('href="#one"')
    expect(two).toContain('class="lvl3"')
  })
})

describe('docs chrome', () => {
  const base = {
    siteTitle: 'Docs',
    footer: '',
    pageTitle: 'Config',
    contentHtml: '<p>body</p>',
    nav: [],
    basePath: '',
  }

  it('shows breadcrumbs, last-updated, and an edit link only when given', () => {
    const bare = docsShell(base)
    expect(bare).not.toContain('class="crumbs"')
    expect(bare).not.toContain('Last updated')
    expect(bare).not.toContain('Edit this page')

    const full = docsShell({
      ...base,
      crumbs: [{ title: 'Guide', path: '/guide' }],
      updatedAt: '2026-07-20T10:00:00.000Z',
      editUrl: 'http://app.test/p/abc',
    })
    expect(full).toContain('href="/guide"')
    expect(full).toContain('Last updated 2026-07-20')
    expect(full).toContain('href="http://app.test/p/abc"')
  })

  it('collapses nav sections off the active trail and expands the active one', () => {
    const html = docsShell({
      ...base,
      nav: [
        {
          title: 'Open',
          path: '/open',
          children: [{ title: 'Child', path: '/open/child', active: true, children: [] }],
        },
        {
          title: 'Shut',
          path: '/shut',
          children: [{ title: 'Other', path: '/shut/other', children: [] }],
        },
      ],
    })
    expect(html).toContain('data-sec="/open"')
    expect(html).toMatch(/<li class="" data-sec="\/open"/)
    expect(html).toMatch(/<li class="collapsed" data-sec="\/shut"/)
  })

  it('noindex only when asked', () => {
    expect(docsShell(base)).not.toContain('noindex')
    expect(docsShell({ ...base, noindex: true })).toContain('content="noindex"')
  })
})

describe('syntax highlighting', () => {
  it('marks keywords, strings, and comments without dropping text', () => {
    const html = blocknoteToHtml(JSON.stringify([code('const x = "hi" // note\n', 'javascript')]))
    expect(html).toContain('<span class="tok-kw">const</span>')
    expect(html).toContain('<span class="tok-str">&quot;hi&quot;</span>')
    expect(html).toContain('<span class="tok-com">// note</span>')
    expect(html).toContain('data-lang="javascript"')
  })

  it('escapes hostile code even inside tokens', () => {
    const out = highlightCode('const a = "<script>alert(1)</script>"', 'js')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('leaves unknown languages as plain escaped text', () => {
    const out = highlightCode('<b>x</b> weird', 'brainfuck')
    expect(out).toBe('&lt;b&gt;x&lt;/b&gt; weird')
  })

  it('keeps every character of the input', () => {
    const src = 'def f(a, b):\n  return a + b  # sum\n'
    const stripped = highlightCode(src, 'python')
      .replace(/<[^>]+>/g, '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&')
    expect(stripped).toBe(src)
  })
})
