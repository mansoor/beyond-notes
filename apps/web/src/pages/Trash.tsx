import { useState } from 'react'
import { trpc } from '../trpc'

const TYPE_ICON = { doc: '📄', blog: '📰', gallery: '🖼' } as const

export function TrashPage() {
  const utils = trpc.useUtils()
  const trashed = trpc.pages.trashed.useQuery()
  const invalidate = () =>
    Promise.all([
      utils.pages.trashed.invalidate(),
      utils.pages.tree.invalidate(),
      utils.tasks.agenda.invalidate(),
      utils.pins.list.invalidate(),
    ])
  const restore = trpc.pages.restoreTrashed.useMutation({ onSuccess: invalidate })
  const purge = trpc.pages.deleteForever.useMutation({ onSuccess: invalidate })
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null)

  return (
    <div className="max-w-5xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-1">Trash</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Deleted pages wait here for 30 days before they purge for good. Restoring puts a page (and
        everything under it) back where it was; published pages return to the site too.
      </p>

      {trashed.data?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          The trash is empty.
        </p>
      )}

      {trashed.data?.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 border-b py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <span>{TYPE_ICON[item.pageType]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{item.title}</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {item.spaceName} · deleted by {item.trashedByName} ·{' '}
              {new Date(item.trashedAt).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              · purges {new Date(item.purgeAt).toLocaleDateString()}
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
          {confirmPurge === item.id ? (
            <button
              type="button"
              className="rounded-lg px-3 py-1 text-xs text-white"
              style={{ background: 'var(--danger)' }}
              disabled={purge.isPending}
              onClick={() => {
                purge.mutate({ pageId: item.id })
                setConfirmPurge(null)
              }}
            >
              Really delete forever
            </button>
          ) : (
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--danger)' }}
              onClick={() => setConfirmPurge(item.id)}
            >
              Delete forever
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
