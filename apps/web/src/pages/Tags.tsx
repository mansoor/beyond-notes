import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { trpc } from '../trpc'

const KIND_ICON = { page: '📄', memo: '💭' } as const

export function TagsPage() {
  const tags = trpc.tags.all.useQuery()
  const [selected, setSelected] = useState<string | null>(null)
  const items = trpc.tags.items.useQuery({ tag: selected ?? '' }, { enabled: selected !== null })

  return (
    <div className="max-w-2xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-1">Tags</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Write <code>#a-tag</code> anywhere — notes, day notes, thoughts, tasks — and it shows up
        here. The flat view across your whole tree.
      </p>

      {tags.data?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          No tags yet. Try adding <code>#project</code> to a note.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-8">
        {tags.data?.map(({ tag, count }) => (
          <button
            key={tag}
            type="button"
            onClick={() => setSelected(selected === tag ? null : tag)}
            className="rounded-full border px-3 py-1 text-sm"
            style={{
              borderColor: selected === tag ? 'var(--accent)' : 'var(--border)',
              background: selected === tag ? 'var(--accent-soft)' : 'var(--panel)',
              color: selected === tag ? 'var(--accent)' : 'var(--text-2)',
              fontWeight: selected === tag ? 600 : 400,
            }}
          >
            #{tag} <span style={{ opacity: 0.6 }}>{count}</span>
          </button>
        ))}
      </div>

      {selected && (
        <section>
          <h2
            className="text-sm font-semibold uppercase tracking-wide mb-2"
            style={{ color: 'var(--text-3)' }}
          >
            #{selected}
          </h2>
          {items.data?.map((item) => (
            <TagItemRow key={`${item.kind}:${item.id}`} item={item} />
          ))}
          {items.data?.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              Nothing carries this tag any more.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function TagItemRow(props: {
  item: {
    kind: 'page' | 'memo'
    id: string
    title: string
    context: string
    dateKey: string | null
  }
}) {
  const { item } = props
  const inner = (
    <div
      className="flex items-center gap-3 border-b py-2.5 hover:bg-black/5 dark:hover:bg-white/5 rounded px-2 -mx-2"
      style={{ borderColor: 'var(--border)' }}
    >
      <span>{KIND_ICON[item.kind]}</span>
      <span className="text-sm font-medium truncate flex-1">{item.title}</span>
      <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
        {item.context}
        {item.dateKey ? ` · ${item.dateKey}` : ''}
      </span>
    </div>
  )
  if (item.kind === 'memo') return <Link to="/inbox">{inner}</Link>
  if (item.dateKey) {
    return (
      <Link to="/day/$date" params={{ date: item.dateKey }}>
        {inner}
      </Link>
    )
  }
  return (
    <Link to="/p/$pageId" params={{ pageId: item.id }}>
      {inner}
    </Link>
  )
}
