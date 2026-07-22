import { describe, expect, it } from 'vitest'
import { normalizeLevels, outlineMarkdown, rewriteAnchors, scanHeadings } from './importplan'

const README = `# Beyond Notes

Beyond Notes is a note-taking app that doesn't stop at notes.

Second intro paragraph.

## Table of contents

1. [Quick start](#quick-start)
2. [Features](#features)

## Quick start

Run it with docker.

### Docker run

\`\`\`bash
# this heading-looking comment must not split the page
docker run -p 3800:3800 beyond-notes
\`\`\`

### Docker Compose

Compose is nicer.

#### Postgres variant

Deep headings stay inside the page.

## Features

What you get.
`

describe('scanHeadings', () => {
  it('ignores headings inside fenced code', () => {
    const titles = scanHeadings(README.split('\n')).map((h) => h.title)
    expect(titles).toContain('Quick start')
    expect(titles).not.toContain('this heading-looking comment must not split the page')
  })

  it('strips links and emphasis from a heading', () => {
    const [heading] = scanHeadings(['## **Bold** and [linked](http://x.test)'])
    expect(heading?.title).toBe('Bold and linked')
  })
})

describe('outlineMarkdown', () => {
  const plan = outlineMarkdown(README)

  it('takes the H1 as the document title, not a page', () => {
    expect(plan.title).toBe('Beyond Notes')
    expect(plan.nodes.map((n) => n.title)).not.toContain('Beyond Notes')
  })

  it('turns the prose before the first section into Introduction', () => {
    const intro = plan.nodes[0]
    expect(intro?.title).toBe('Introduction')
    expect(intro?.level).toBe(0)
    expect(intro?.markdown).toContain("doesn't stop at notes")
    expect(intro?.markdown).toContain('Second intro paragraph.')
  })

  it('drops the table of contents and says so', () => {
    expect(plan.nodes.map((n) => n.title)).not.toContain('Table of contents')
    expect(plan.warnings.join(' ')).toMatch(/Table of contents/i)
  })

  it('nests H3 under H2 and leaves H4 inside the page', () => {
    const byTitle = new Map(plan.nodes.map((n) => [n.title, n]))
    expect(byTitle.get('Quick start')?.level).toBe(0)
    expect(byTitle.get('Docker run')?.level).toBe(1)
    expect(byTitle.get('Docker Compose')?.level).toBe(1)
    expect(byTitle.has('Postgres variant')).toBe(false)
    expect(byTitle.get('Docker Compose')?.markdown).toContain('#### Postgres variant')
  })

  it("gives a parent page only its own prose, not its children's", () => {
    const quickStart = plan.nodes.find((n) => n.title === 'Quick start')
    expect(quickStart?.markdown).toBe('Run it with docker.')
  })

  it('keeps the code fence intact in the page that owns it', () => {
    const dockerRun = plan.nodes.find((n) => n.title === 'Docker run')
    expect(dockerRun?.markdown).toContain('docker run -p 3800:3800')
    expect(dockerRun?.markdown.match(/```/g)).toHaveLength(2)
  })

  it('records the anchor each section had', () => {
    expect(plan.nodes.find((n) => n.title === 'Quick start')?.anchor).toBe('quick-start')
  })

  it('falls back to one page when there are no headings', () => {
    const flat = outlineMarkdown('just a paragraph, nothing else', { label: 'notes.md' })
    expect(flat.nodes).toHaveLength(1)
    expect(flat.nodes[0]?.markdown).toBe('just a paragraph, nothing else')
  })

  it('handles a document that only uses H1s as its sections', () => {
    const out = outlineMarkdown('# One\n\ntext\n\n# Two\n\nmore')
    expect(out.nodes.map((n) => [n.title, n.level])).toEqual([
      ['Introduction', 0],
      ['Two', 0],
    ])
  })

  it('offsets every level when a base level is given', () => {
    const out = outlineMarkdown('## A\n\nx\n\n### B\n\ny', { baseLevel: 2 })
    expect(out.nodes.map((n) => n.level)).toEqual([2, 3])
  })
})

describe('normalizeLevels', () => {
  it('pulls an impossible jump back to one level deeper', () => {
    const nodes = [0, 3, 1, 2, 9].map((level, i) => ({
      key: `k${i}`,
      title: `t${i}`,
      level,
      kind: 'section' as const,
      markdown: '',
      excerpt: '',
    }))
    expect(normalizeLevels(nodes).map((n) => n.level)).toEqual([0, 1, 1, 2, 3])
  })
})

describe('rewriteAnchors', () => {
  const map = new Map([['quick-start', '/p/abc']])

  it('points an in-document anchor at the page it became', () => {
    expect(rewriteAnchors('see [Quick start](#quick-start) now', map)).toBe(
      'see [Quick start](/p/abc) now',
    )
  })

  it('leaves an unknown anchor alone rather than guessing', () => {
    expect(rewriteAnchors('[gone](#nowhere)', map)).toBe('[gone](#nowhere)')
  })

  it('does not touch real links', () => {
    expect(rewriteAnchors('[x](https://e.test/#quick-start)', map)).toBe(
      '[x](https://e.test/#quick-start)',
    )
  })
})
