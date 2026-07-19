import { describe, expect, it } from 'vitest'
import { blocknoteToMarkdown, markdownToBlocks } from './markdown'

const text = (t: string, styles: Record<string, boolean> = {}) => ({
  type: 'text',
  text: t,
  styles,
})

describe('blocknoteToMarkdown', () => {
  it('serializes the common block types', () => {
    const blocks = [
      { id: '1', type: 'heading', props: { level: 2 }, content: [text('Plans')], children: [] },
      {
        id: '2',
        type: 'paragraph',
        props: {},
        content: [text('Some '), text('bold', { bold: true }), text(' text')],
        children: [],
      },
      {
        id: '3',
        type: 'checkListItem',
        props: { checked: true },
        content: [text('done thing')],
        children: [],
      },
      {
        id: '4',
        type: 'checkListItem',
        props: { checked: false },
        content: [text('todo thing')],
        children: [],
      },
      { id: '5', type: 'bulletListItem', props: {}, content: [text('a point')], children: [] },
      {
        id: '6',
        type: 'codeBlock',
        props: { language: 'ts' },
        content: [text('const x = 1')],
        children: [],
      },
      { id: '7', type: 'quote', props: {}, content: [text('wise words')], children: [] },
      {
        id: '8',
        type: 'image',
        props: { url: '/api/files/abc', caption: 'sunset' },
        content: [],
        children: [],
      },
    ]
    const md = blocknoteToMarkdown(JSON.stringify(blocks))
    expect(md).toContain('## Plans')
    expect(md).toContain('Some **bold** text')
    expect(md).toContain('- [x] done thing')
    expect(md).toContain('- [ ] todo thing')
    expect(md).toContain('- a point')
    expect(md).toContain('```ts\nconst x = 1\n```')
    expect(md).toContain('> wise words')
    expect(md).toContain('![sunset](/api/files/abc)')
  })

  it('serializes links and nested list children', () => {
    const blocks = [
      {
        id: '1',
        type: 'bulletListItem',
        props: {},
        content: [{ type: 'link', href: 'https://x.dev', content: [text('site')] }],
        children: [
          { id: '2', type: 'bulletListItem', props: {}, content: [text('nested')], children: [] },
        ],
      },
    ]
    const md = blocknoteToMarkdown(JSON.stringify(blocks))
    expect(md).toContain('- [site](https://x.dev)')
    expect(md).toContain('  - nested')
  })
})

describe('markdownToBlocks', () => {
  it('parses structure back into blocks', () => {
    const md = [
      '# Title',
      '',
      'A paragraph with **bold** and `code`.',
      '',
      '- [ ] open task',
      '- [x] closed task',
      '- plain bullet',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '```js',
      'let a = 2',
      '```',
      '',
      '![cap](img.png)',
    ].join('\n')
    const blocks = markdownToBlocks(md) as any[]
    const types = blocks.map((b) => b.type)
    expect(types).toEqual([
      'heading',
      'paragraph',
      'checkListItem',
      'checkListItem',
      'bulletListItem',
      'numberedListItem',
      'numberedListItem',
      'quote',
      'codeBlock',
      'image',
    ])
    expect(blocks[0].props.level).toBe(1)
    expect(blocks[2].props.checked).toBe(false)
    expect(blocks[3].props.checked).toBe(true)
    const para = blocks[1].content
    expect(para.some((i: any) => i.styles?.bold && i.text === 'bold')).toBe(true)
    expect(para.some((i: any) => i.styles?.code && i.text === 'code')).toBe(true)
    expect(blocks[8].content[0].text).toBe('let a = 2')
    expect(blocks[9].props.url).toBe('img.png')
    // every block gets a unique id (the tasks index depends on it)
    const ids = new Set(blocks.map((b) => b.id))
    expect(ids.size).toBe(blocks.length)
  })

  it('round-trips: serialize -> parse -> serialize is stable', () => {
    const md = [
      '## Notes',
      '',
      'Hello *there* world.',
      '',
      '- [ ] buy milk @2026-08-01',
      '- a bullet',
    ].join('\n')
    const once = blocknoteToMarkdown(JSON.stringify(markdownToBlocks(md)))
    const twice = blocknoteToMarkdown(JSON.stringify(markdownToBlocks(once)))
    expect(twice).toBe(once)
  })

  it('soft-wrapped paragraph lines join; unknown syntax degrades to paragraphs', () => {
    const blocks = markdownToBlocks('line one\nline two\n\n| a | table |\n| - | - |') as any[]
    expect(blocks[0].content[0].text).toBe('line one line two')
    expect(blocks.length).toBeGreaterThan(1) // table rows survive as text, not lost
  })
})
