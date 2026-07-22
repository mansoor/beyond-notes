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

  it('always reserves the TOC column so pages do not shift', () => {
    const base = {
      siteTitle: 'Docs',
      footer: '',
      pageTitle: 'P',
      contentHtml: '<p>x</p>',
      nav: [],
      basePath: '',
    }
    // no headings, one heading, many headings — the aside is present every time
    expect(docsShell(base)).toContain('<aside class="toc">')
    expect(docsShell({ ...base, toc: [{ level: 2, text: 'Only', id: 'only' }] })).toContain(
      '<aside class="toc">',
    )
  })

  it('centers search and shows socials in the header only when social links exist', () => {
    const base = {
      siteTitle: 'Docs',
      footer: '',
      pageTitle: 'P',
      contentHtml: '<p>x</p>',
      nav: [],
      basePath: '',
    }
    const plain = docsShell(base)
    expect(plain).not.toContain('<header class="hassocial">')
    expect(plain).not.toContain('class="socials"')

    const withSocial = docsShell({
      ...base,
      social: [
        { platform: 'github', url: 'https://github.com/acme' },
        { platform: 'x', url: 'https://x.com/acme' },
      ],
    })
    expect(withSocial).toContain('<header class="hassocial">')
    expect(withSocial).toContain('class="socials"')
    expect(withSocial).toContain('https://github.com/acme')
    // the search box is still there, now centered
    expect(withSocial).toContain('name="q"')
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

  it('renders per-page icons and puts the twisty after the link (readme-style)', () => {
    const html = docsShell({
      ...base,
      nav: [
        {
          title: 'Parent',
          path: '/parent',
          icon: '📘',
          children: [{ title: 'Child', path: '/parent/child', children: [] }],
        },
        { title: 'Leaf', path: '/leaf', icon: '📄', children: [] },
      ],
    })
    // the icon sits before the title
    expect(html).toContain('<span class="ico">📘</span>')
    expect(html).toContain('<span class="ico">📄</span>')
    // in a parent row the link precedes the twisty (arrow on the right edge)
    const grp = /<span class="grp">[\s\S]*?<\/span>\s*<ul>/.exec(html)?.[0] ?? ''
    expect(grp.indexOf('<a ')).toBeGreaterThanOrEqual(0)
    expect(grp.indexOf('<a ')).toBeLessThan(grp.indexOf('<button'))
  })

  it('renders Material Symbols names via the font, and loads it only when used', () => {
    const withMaterial = docsShell({
      ...base,
      nav: [{ title: 'Home', path: '/home', icon: 'rocket_launch', children: [] }],
    })
    // material name → msym class + the self-hosted @font-face is injected
    expect(withMaterial).toContain('<span class="ico msym">rocket_launch</span>')
    expect(withMaterial).toContain('/api/assets/material-symbols.woff2')

    // an emoji icon stays literal and does NOT pull in the 4MB font
    const withEmoji = docsShell({
      ...base,
      nav: [{ title: 'Home', path: '/home', icon: '🏠', children: [] }],
    })
    expect(withEmoji).toContain('<span class="ico">🏠</span>')
    expect(withEmoji).not.toContain('material-symbols.woff2')

    // no icons at all → no font either
    expect(docsShell(base)).not.toContain('material-symbols.woff2')
  })
})

describe('mermaid diagrams', () => {
  const diagram = 'flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]'

  it('emits a mermaid pre whose text decodes back to the exact source', () => {
    const html = blocknoteToHtml(JSON.stringify([code(diagram, 'mermaid')]))
    expect(html).toContain('<pre class="mermaid">')
    // arrows survive as entities in the markup...
    expect(html).toContain('--&gt;')
    expect(html).not.toContain('<pre data-lang="mermaid"')
    // ...and decode back to the source the renderer will parse
    const inner = /<pre class="mermaid">([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? ''
    const decoded = inner
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&')
    expect(decoded).toBe(diagram)
  })

  it('escapes hostile diagram source like any other user content', () => {
    const html = blocknoteToHtml(
      JSON.stringify([code('flowchart LR\n A["<img src=x onerror=alert(1)>"]', 'mermaid')]),
    )
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('is recognised case-insensitively and does not get highlighted', () => {
    const html = blocknoteToHtml(JSON.stringify([code(diagram, 'Mermaid')]))
    expect(html).toContain('<pre class="mermaid">')
    expect(html).not.toContain('tok-kw')
  })

  it('the code copy button never targets diagrams (it would corrupt the source)', () => {
    // regression: appending a "copy" button to every <pre> put the word "copy"
    // inside the diagram text mermaid reads back, breaking every diagram
    const shell = docsShell({
      siteTitle: 'Docs',
      footer: '',
      pageTitle: 'P',
      contentHtml: '<pre class="mermaid">flowchart LR</pre>',
      nav: [],
      basePath: '',
    })
    expect(shell).toContain("querySelectorAll('main pre:not(.mermaid)')")
    expect(shell).not.toContain("querySelectorAll('main pre')")
  })

  it('loads the library from this instance, never a CDN', () => {
    const shell = docsShell({
      siteTitle: 'Docs',
      footer: '',
      pageTitle: 'P',
      contentHtml: '<pre class="mermaid">flowchart LR</pre>',
      nav: [],
      basePath: '',
    })
    expect(shell).toContain("'/api/assets/mermaid.js'")
    expect(shell).not.toMatch(/https?:\/\/[^"']*mermaid/)
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

describe('docs search box', () => {
  const html = docsShell({
    siteTitle: 'My Wiki',
    footer: '',
    basePath: '',
    nav: [],
    pageTitle: 'Home',
    contentHtml: '<p>hi</p>',
  })

  it('is twice the old width and holds a recents dropdown', () => {
    expect(html).toContain('width:360px') // was 180px
    expect(html).toContain('<div class="recents" hidden>')
    // the browser's own history popup would sit on top of ours
    expect(html).toContain('autocomplete="off"')
  })

  it("keeps the history in the visitor's browser, keyed per site", () => {
    // never posted anywhere: the only storage is localStorage, namespaced by the
    // form action so two wikis on one origin cannot see each other's searches
    expect(html).toContain("'bn-recent:'+(form.getAttribute('action')||'/')")
    expect(html).toContain('localStorage')
  })

  it('builds suggestions with textContent, never innerHTML', () => {
    const script = html.slice(html.indexOf('bn-recent'), html.indexOf('bn-recent') + 2500)
    expect(script).toContain('textContent')
    expect(script).not.toContain('innerHTML')
  })
})

describe('visitor-controlled appearance', () => {
  const withToggle = docsShell({
    siteTitle: 'W',
    footer: 'f',
    basePath: '',
    nav: [],
    pageTitle: 'Home',
    contentHtml: '<p>x</p>',
    appearance: 'toggle',
  })
  const withAuto = docsShell({
    siteTitle: 'W',
    footer: 'f',
    basePath: '',
    nav: [],
    pageTitle: 'Home',
    contentHtml: '<p>x</p>',
    appearance: 'auto',
  })

  it('offers the switch, last in the header so it sits rightmost', () => {
    expect(withToggle).toContain('class="appear"')
    expect(withToggle.indexOf('class="appear"')).toBeGreaterThan(withToggle.indexOf('<form'))
  })

  it('starts from the OS but lets an explicit choice win', () => {
    expect(withToggle).toContain('@media(prefers-color-scheme:dark)')
    expect(withToggle).toContain(':root[data-appear=light]')
    expect(withToggle).toContain(':root[data-appear=dark]')
  })

  it('applies a remembered choice in <head>, before the first paint', () => {
    const head = withToggle.slice(0, withToggle.indexOf('</head>'))
    expect(head).toContain("localStorage.getItem('bn-appear')")
  })

  it('ships none of it when the site did not ask for it', () => {
    // note: the body has always carried data-appearance="…", which is a
    // different thing — check for the toggle's own artefacts specifically
    expect(withAuto).not.toContain('class="appear"')
    expect(withAuto).not.toContain('bn-appear')
    expect(withAuto).not.toContain('[data-appear=')
  })

  it('credits Beyond Notes with a link home', () => {
    expect(withAuto).toContain(
      '<a href="https://github.com/mansoor/beyond-notes" target="_blank" rel="noopener">Beyond Notes</a>',
    )
  })
})
