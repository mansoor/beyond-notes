import { useState } from 'react'
import { trpc } from '../trpc'

const TYPE_ICON = { doc: '📄', blog: '📰', gallery: '🖼' } as const

export function ArchivePage() {
  const utils = trpc.useUtils()
  const archived = trpc.pages.archived.useQuery()
  const invalidate = () =>
    Promise.all([
      utils.pages.archived.invalidate(),
      utils.pages.tree.invalidate(),
      utils.tasks.agenda.invalidate(),
    ])
  const restore = trpc.pages.restore.useMutation({ onSuccess: invalidate })
  const del = trpc.pages.delete.useMutation({ onSuccess: invalidate })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  return (
    <div className="max-w-5xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-1">Archive</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Archived pages leave the sidebar, search, and the task list — but nothing is lost. Restore
        puts a page (and everything under it) back where it was.
      </p>

      {archived.data?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Nothing archived. The page menu (⋯) in the sidebar has an Archive action.
        </p>
      )}

      {archived.data?.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 border-b py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <span>{TYPE_ICON[item.pageType]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{item.title}</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {item.spaceName} · archived by {item.archivedByName} ·{' '}
              {new Date(item.archivedAt).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border px-3 py-1 text-xs"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            disabled={restore.isPending}
            onClick={() => restore.mutate({ pageId: item.id })}
          >
            Restore
          </button>
          {confirmDelete === item.id ? (
            <button
              type="button"
              className="rounded-lg px-3 py-1 text-xs text-white"
              style={{ background: 'var(--danger)' }}
              disabled={del.isPending}
              onClick={() => {
                del.mutate({ pageId: item.id })
                setConfirmDelete(null)
              }}
            >
              Really delete
            </button>
          ) : (
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--danger)' }}
              onClick={() => setConfirmDelete(item.id)}
            >
              Delete forever
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
