import { describe, expect, it } from 'vitest'
import { TABLE_EMBED_JS, tableEmbedHtml } from './tableembed'

describe('tableEmbedHtml', () => {
  it('renders a table layout with escaped cells', () => {
    const html = tableEmbedHtml({
      columns: ['Name', 'Note'],
      rows: [['Ann', '<b>x</b>']],
      layout: 'table',
      pageSize: 0,
    })
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('bn-embed-table')
    expect(html).toContain('bn-embed-item')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;') // escaped, not raw
    expect(html).not.toContain('data-pagesize')
  })

  it('links url cells and never linkifies a non-http value', () => {
    const html = tableEmbedHtml({
      columns: ['Home', 'Note'],
      columnTypes: ['url', 'text'],
      rows: [['https://example.com/x', 'javascript:alert(1)']],
      layout: 'table',
      pageSize: 0,
    })
    expect(html).toContain(
      '<a href="https://example.com/x" target="_blank" rel="noopener nofollow">https://example.com/x</a>',
    )
    // a non-url column with a javascript: value stays inert, escaped text
    expect(html).not.toContain('<a href="javascript')
    expect(html).toContain('javascript:alert(1)'.replace(/"/g, '&quot;'))
  })

  it('does not linkify a url column whose value is not http(s)', () => {
    const html = tableEmbedHtml({
      columns: ['Link'],
      columnTypes: ['url'],
      rows: [['javascript:alert(1)']],
      layout: 'table',
      pageSize: 0,
    })
    expect(html).not.toContain('<a href')
  })

  it('honours pagesize and the cards / list layouts', () => {
    expect(
      tableEmbedHtml({ columns: ['A'], rows: [['1']], layout: 'table', pageSize: 5 }),
    ).toContain('data-pagesize="5"')
    expect(
      tableEmbedHtml({ columns: ['A'], rows: [['1']], layout: 'cards', pageSize: 0 }),
    ).toContain('bn-embed-cards')
    expect(
      tableEmbedHtml({ columns: ['A'], rows: [['1']], layout: 'list', pageSize: 0 }),
    ).toContain('bn-embed-list')
  })

  it('shows an empty state and ships self-contained JS', () => {
    expect(tableEmbedHtml({ columns: ['A'], rows: [], layout: 'table', pageSize: 0 })).toContain(
      'No rows',
    )
    expect(TABLE_EMBED_JS).not.toMatch(/https?:\/\//)
  })
})
