import { useState } from 'react'
import { trpc } from '../trpc'

const TYPE_ICON = { doc: '📄', blog: '📰', gallery: '🖼' } as const

export function ArchivePage() {
  const utils = trpc.useUtils()
  const archived = trpc.pages.archived.useQuery()
  const invalidate = () =>
    Promise.all([
      utils.pages.archived.invalidate(),
      utils.pages.trashed.invalidate(),
      utils.pages.tree.invalidate(),
      utils.tasks.agenda.invalidate(),
    ])
  const restore = trpc.pages.restore.useMutation({ onSuccess: invalidate })
  const del = trpc.pages.delete.useMutation({ onSuccess: invalidate })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const archivedTables = trpc.tables.archived.useQuery()
  const tablesInvalidate = () =>
    Promise.all([utils.tables.archived.invalidate(), utils.tables.list.invalidate()])
  const restoreTable = trpc.tables.restore.useMutation({ onSuccess: tablesInvalidate })
  const deleteTable = trpc.tables.delete.useMutation({ onSuccess: tablesInvalidate })
  const [confirmDeleteTable, setConfirmDeleteTable] = useState<string | null>(null)

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
              Really move to Trash
            </button>
          ) : (
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--danger)' }}
              title="Moves to Trash; purges for good after 30 days"
              onClick={() => setConfirmDelete(item.id)}
            >
              Delete
            </button>
          )}
        </div>
      ))}

      {(archivedTables.data?.length ?? 0) > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Data tables</h2>
          {archivedTables.data?.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-b py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <span>▦</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{item.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {item.databaseName} ·{' '}
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
                disabled={restoreTable.isPending}
                onClick={() => restoreTable.mutate({ tableId: item.id })}
              >
                Restore
              </button>
              {confirmDeleteTable === item.id ? (
                <button
                  type="button"
                  className="rounded-lg px-3 py-1 text-xs text-white"
                  style={{ background: 'var(--danger)' }}
                  disabled={deleteTable.isPending}
                  onClick={() => {
                    deleteTable.mutate({ tableId: item.id })
                    setConfirmDeleteTable(null)
                  }}
                >
                  Really delete forever
                </button>
              ) : (
                <button
                  type="button"
                  className="text-xs underline"
                  style={{ color: 'var(--danger)' }}
                  title="Deletes the table and all its rows for good"
                  onClick={() => setConfirmDeleteTable(item.id)}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
