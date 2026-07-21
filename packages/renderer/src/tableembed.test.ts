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
