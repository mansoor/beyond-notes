import { describe, expect, it } from 'vitest'
import { blocknoteToHtml, plainText } from './render'
import { slugify } from './slug'

const text = (t: string, styles: Record<string, boolean> = {}) => ({
  type: 'text',
  text: t,
  styles,
})

describe('blocknoteToHtml (golden)', () => {
  it('renders every core block type exactly', () => {
    const doc = JSON.stringify([
      { id: '1', type: 'heading', props: { level: 1 }, content: [text('Install')], children: [] },
      {
        id: '2',
        type: 'paragraph',
        content: [
          text('Plain '),
          text('bold', { bold: true }),
          text(' and '),
          text('code', { code: true }),
        ],
        children: [],
      },
      { id: '3', type: 'bulletListItem', content: [text('one')], children: [] },
      {
        id: '4',
        type: 'bulletListItem',
        content: [text('two')],
        children: [{ id: '4a', type: 'bulletListItem', content: [text('nested')], children: [] }],
      },
      { id: '5', type: 'numberedListItem', content: [text('first')], children: [] },
      {
        id: '6',
        type: 'checkListItem',
        props: { checked: true },
        content: [text('done thing')],
        children: [],
      },
      {
        id: '7',
        type: 'checkListItem',
        props: { checked: false },
        content: [text('todo thing')],
        children: [],
      },
      {
        id: '8',
        type: 'codeBlock',
        props: { language: 'bash' },
        content: [text('docker compose up -d')],
        children: [],
      },
      { id: '9', type: 'quote', content: [text('wisdom')], children: [] },
      {
        id: '10',
        type: 'paragraph',
        content: [{ type: 'link', href: 'https://example.com', content: [text('a link')] }],
        children: [],
      },
    ])
    expect(blocknoteToHtml(doc)).toBe(
      // headings carry an id + copyable anchor (v0.6); code blocks carry the
      // language on the <pre> so the copy button and highlighting can see it
      '<h2 id="install">Install<a class="hanchor" href="#install" aria-label="Link to this section">#</a></h2>' +
        '<p>Plain <strong>bold</strong> and <code>code</code></p>' +
        '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>' +
        '<ol><li>first</li></ol>' +
        '<ul class="checklist"><li class="check done"><input type="checkbox" disabled checked> done thing</li>' +
        '<li class="check"><input type="checkbox" disabled> todo thing</li></ul>' +
        '<pre data-lang="bash"><code class="language-bash">docker compose up -d</code></pre>' +
        '<blockquote>wisdom</blockquote>' +
        '<p><a href="https://example.com">a link</a></p>',
    )
  })

  it('renders per-block text alignment, including justify', () => {
    const doc = JSON.stringify([
      {
        id: '1',
        type: 'paragraph',
        props: { textAlignment: 'justify' },
        content: [text('spread')],
      },
      { id: '2', type: 'paragraph', props: { textAlignment: 'center' }, content: [text('middle')] },
      {
        id: '3',
        type: 'heading',
        props: { level: 1, textAlignment: 'right' },
        content: [text('Ttl')],
      },
      // 'left' is the implicit default and gets no inline style
      { id: '4', type: 'paragraph', props: { textAlignment: 'left' }, content: [text('plain')] },
    ])
    const html = blocknoteToHtml(doc)
    expect(html).toContain('<p style="text-align:justify">spread</p>')
    expect(html).toContain('<p style="text-align:center">middle</p>')
    expect(html).toContain('<h2 id="ttl" style="text-align:right">')
    expect(html).toContain('<p>plain</p>')
  })

  it('escapes user content and drops unsafe hrefs', () => {
    const doc = JSON.stringify([
      {
        id: '1',
        type: 'paragraph',
        content: [text('<script>alert(1)</script> & "quotes"')],
        children: [],
      },
      {
        id: '2',
        type: 'paragraph',
        content: [{ type: 'link', href: 'javascript:alert(1)', content: [text('evil')] }],
        children: [],
      },
      {
        id: '3',
        type: 'codeBlock',
        props: { language: '"><img onerror' },
        content: [text('<b>')],
        children: [],
      },
    ])
    const html = blocknoteToHtml(doc)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<p>evil</p>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('onerror>')
  })

  it('tolerates malformed input', () => {
    expect(blocknoteToHtml('not json')).toBe('')
    expect(blocknoteToHtml('{"not":"array"}')).toBe('')
    expect(blocknoteToHtml('[{"type":"mystery"}]')).toBe('<p></p>')
  })
})

describe('plainText', () => {
  it('flattens to searchable lines', () => {
    const doc = JSON.stringify([
      { id: '1', type: 'heading', props: { level: 1 }, content: [text('Install')], children: [] },
      {
        id: '2',
        type: 'paragraph',
        content: [text('Use '), { type: 'link', href: 'https://x', content: [text('docker')] }],
        children: [],
      },
    ])
    expect(plainText(doc)).toBe('Install\nUse docker')
  })
})

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Getting Started')).toBe('getting-started')
    expect(slugify('  Émigré — café!! ')).toBe('emigre-cafe')
    expect(slugify('___')).toBe('page')
  })
})
