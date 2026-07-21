import type { DbCellValue, DbColumnDraft, DbColumnType, DbRowView, DbTableView } from '@bn/schema'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ErrorNote, Field, Modal, SubmitButton, useSubmit } from '../components'
import { trpc } from '../trpc'

const COLUMN_TYPES: { value: DbColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'email', label: 'Email' },
]

const cellString = (v: DbCellValue | undefined): string => (v == null ? '' : String(v))

// ---- sidebar section ----

/** Top-level "Data" section: user-defined tables, peers to Notebooks/Sites/Wikis. */
export function DataNav() {
  const utils = trpc.useUtils()
  const tables = trpc.tables.list.useQuery()
  const navigate = useNavigate()
  const create = trpc.tables.create.useMutation({
    onSuccess: async (table) => {
      await utils.tables.list.invalidate()
      navigate({ to: '/data/$tableId', params: { tableId: table.id } })
    },
  })

  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-wide font-semibold mb-1 px-2 flex items-center"
        style={{ color: 'var(--text-3)' }}
      >
        Data
        <button
          type="button"
          title="New table"
          className="ml-auto text-xs px-1"
          disabled={create.isPending}
          onClick={() => create.mutate({ name: 'Untitled table', personal: false })}
        >
          ＋
        </button>
      </div>
      {tables.data?.map((table) => (
        <Link
          key={table.id}
          to="/data/$tableId"
          params={{ tableId: table.id }}
          className="block truncate px-2 py-1 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: 'var(--text-2)' }}
          activeProps={{ style: { color: 'var(--accent)', background: 'var(--accent-soft)' } }}
          title={table.name}
        >
          ▦ {table.name}
          {table.personal && <span className="ml-1 text-[10px]">⛭</span>}
        </Link>
      ))}
      {tables.data?.length === 0 && (
        <div className="text-xs px-2 py-1" style={{ color: 'var(--text-3)' }}>
          none yet —{' '}
          <button
            type="button"
            className="underline"
            onClick={() => create.mutate({ name: 'Untitled table', personal: false })}
          >
            new table
          </button>
        </div>
      )}
    </div>
  )
}

// ---- table page ----

export function DataPage() {
  const { tableId } = useParams({ from: '/app/data/$tableId' })
  const table = trpc.tables.get.useQuery({ tableId })

  // remount the grid when the table identity changes so local row state resets
  return table.data ? (
    <TableView key={tableId} table={table.data} />
  ) : (
    <div className="max-w-6xl mx-auto px-10 py-8 text-sm" style={{ color: 'var(--text-3)' }}>
      {table.isLoading ? 'Loading…' : 'Table not found.'}
    </div>
  )
}

function TableView(props: { table: DbTableView }) {
  const { table } = props
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const rowsQuery = trpc.tables.rows.list.useQuery({ tableId: table.id })

  const [rows, setRows] = useState<DbRowView[]>([])
  // rows.list is only refetched on structural changes (mount, column edits),
  // never after a cell save — so this reseed can't clobber an in-flight edit.
  useEffect(() => {
    if (rowsQuery.data) setRows(rowsQuery.data)
  }, [rowsQuery.data])

  const [editingCols, setEditingCols] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const updateRow = trpc.tables.rows.update.useMutation()
  const createRow = trpc.tables.rows.create.useMutation({
    onSuccess: (row) => setRows((prev) => [...prev, row]),
  })
  const deleteRow = trpc.tables.rows.delete.useMutation()
  const deleteTable = trpc.tables.delete.useMutation({
    onSuccess: async () => {
      await utils.tables.list.invalidate()
      navigate({ to: '/' })
    },
  })

  const commitCell = (rowId: string, colId: string, value: DbCellValue) => {
    let nextCells: Record<string, DbCellValue> = {}
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r
        nextCells = { ...r.cells, [colId]: value }
        return { ...r, cells: nextCells }
      }),
    )
    updateRow.mutate({ rowId, cells: nextCells })
  }

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId))
    deleteRow.mutate({ rowId })
  }

  return (
    <div className="max-w-6xl mx-auto px-10 py-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">▦</span>
        <h1 className="text-2xl font-bold truncate">{table.name}</h1>
        {table.personal && (
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }} title="Personal table">
            ⛭ personal
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <HeaderBtn label="Columns" onClick={() => setEditingCols(true)} />
          <HeaderBtn label="Rename" onClick={() => setRenaming(true)} />
          <HeaderBtn
            label="Delete"
            danger
            onClick={() => {
              if (confirm(`Delete "${table.name}" and all its rows? This cannot be undone.`)) {
                deleteTable.mutate({ tableId: table.id })
              }
            }}
          />
        </div>
      </div>
      {table.description && (
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          {table.description}
        </p>
      )}

      {table.columns.length === 0 ? (
        <div className="mt-6 text-sm" style={{ color: 'var(--text-3)' }}>
          This table has no columns yet.{' '}
          <button type="button" className="underline" onClick={() => setEditingCols(true)}>
            Add columns
          </button>{' '}
          to start entering data.
        </div>
      ) : (
        <div
          className="mt-4 overflow-x-auto border rounded-lg"
          style={{ borderColor: 'var(--border)' }}
        >
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: 'var(--panel)' }}>
                {table.columns.map((col) => (
                  <th
                    key={col.id}
                    className="text-left font-medium px-3 py-2 border-b whitespace-nowrap"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
                  >
                    {col.name}
                    {col.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                    <span className="ml-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {col.type === 'text' ? '' : col.type}
                    </span>
                  </th>
                ))}
                <th className="w-8 border-b" style={{ borderColor: 'var(--border)' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="group">
                  {table.columns.map((col) => (
                    <td
                      key={col.id}
                      className="px-2 py-1 border-b align-top"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <CellEditor
                        type={col.type}
                        choices={col.choices}
                        value={row.cells[col.id] ?? null}
                        onCommit={(v) => commitCell(row.id, col.id, v)}
                      />
                    </td>
                  ))}
                  <td
                    className="px-1 border-b text-center"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <button
                      type="button"
                      title="Delete row"
                      className="opacity-0 group-hover:opacity-100 text-xs px-1"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => removeRow(row.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={table.columns.length + 1}
                    className="px-3 py-4 text-center"
                    style={{ color: 'var(--text-3)' }}
                  >
                    No rows yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {table.columns.length > 0 && (
        <button
          type="button"
          className="mt-3 text-sm rounded-lg border px-3 py-1.5"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          disabled={createRow.isPending}
          onClick={() => createRow.mutate({ tableId: table.id, cells: {} })}
        >
          ＋ Add row
        </button>
      )}

      {editingCols && (
        <ColumnsModal
          table={table}
          onClose={() => setEditingCols(false)}
          onSaved={async () => {
            await Promise.all([
              utils.tables.get.invalidate({ tableId: table.id }),
              utils.tables.rows.list.invalidate({ tableId: table.id }),
            ])
            setEditingCols(false)
          }}
        />
      )}
      {renaming && (
        <RenameModal
          table={table}
          onClose={() => setRenaming(false)}
          onSaved={async () => {
            await Promise.all([
              utils.tables.get.invalidate({ tableId: table.id }),
              utils.tables.list.invalidate(),
            ])
            setRenaming(false)
          }}
        />
      )}
    </div>
  )
}

function HeaderBtn(props: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="text-xs rounded-lg border px-2.5 py-1"
      style={{
        borderColor: 'var(--border)',
        color: props.danger ? 'var(--danger)' : 'var(--text-2)',
      }}
    >
      {props.label}
    </button>
  )
}

/** One inline cell editor. Commits on blur (text-like) or change (checkbox/select/date). */
function CellEditor(props: {
  type: DbColumnType
  choices: string[]
  value: DbCellValue
  onCommit: (v: DbCellValue) => void
}) {
  const { type, value, onCommit } = props
  const [draft, setDraft] = useState(cellString(value))
  useEffect(() => setDraft(cellString(value)), [value])

  const inputStyle = {
    background: 'transparent',
    borderColor: 'var(--border)',
  } as const
  const base = 'w-full min-w-[8rem] rounded border px-2 py-1 text-sm outline-none'

  if (type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onCommit(e.target.checked)}
      />
    )
  }
  if (type === 'select') {
    return (
      <select
        className={base}
        style={inputStyle}
        value={cellString(value)}
        onChange={(e) => onCommit(e.target.value || null)}
      >
        <option value="">—</option>
        {props.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    )
  }
  if (type === 'longtext') {
    return (
      <textarea
        className={`${base} min-h-[2.2rem] resize-y`}
        style={inputStyle}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== cellString(value) && onCommit(draft)}
      />
    )
  }
  const htmlType =
    type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'email' ? 'email' : 'text'
  return (
    <input
      type={htmlType}
      className={base}
      style={inputStyle}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== cellString(value) && onCommit(draft || null)}
    />
  )
}

// ---- column editor ----

type ColDraft = DbColumnDraft & { choicesText: string }

function ColumnsModal(props: { table: DbTableView; onClose: () => void; onSaved: () => void }) {
  const update = trpc.tables.updateColumns.useMutation()
  const [cols, setCols] = useState<ColDraft[]>(
    props.table.columns.map((c) => ({ ...c, choicesText: c.choices.join(', ') })),
  )

  const set = (i: number, patch: Partial<ColDraft>) =>
    setCols((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const move = (i: number, dir: -1 | 1) =>
    setCols((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j] as ColDraft, next[i] as ColDraft]
      return next
    })
  const remove = (i: number) => setCols((prev) => prev.filter((_, j) => j !== i))
  const add = () =>
    setCols((prev) => [
      ...prev,
      {
        name: `Column ${prev.length + 1}`,
        type: 'text',
        required: false,
        choices: [],
        choicesText: '',
      },
    ])

  const { busy, error, onSubmit } = useSubmit(async () => {
    await update.mutateAsync({
      tableId: props.table.id,
      columns: cols.map((c) => ({
        id: c.id,
        name: c.name.trim() || 'Column',
        type: c.type,
        required: c.required,
        choices:
          c.type === 'select'
            ? c.choicesText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
      })),
    })
    props.onSaved()
  })

  return (
    <Modal title={`Columns — ${props.table.name}`} onClose={props.onClose} dirty width="lg">
      <form onSubmit={onSubmit}>
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {cols.map((col, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: order is the identity here
              key={i}
              className="flex flex-wrap items-center gap-2 py-2 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <input
                className="rounded-lg border px-2 py-1.5 text-sm flex-1 min-w-[8rem]"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                value={col.name}
                onChange={(e) => set(i, { name: e.target.value })}
                placeholder="Column name"
              />
              <select
                className="rounded-lg border px-2 py-1.5 text-sm"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                value={col.type}
                onChange={(e) => set(i, { type: e.target.value as DbColumnType })}
              >
                {COLUMN_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-2)' }}>
                <input
                  type="checkbox"
                  checked={col.required}
                  onChange={(e) => set(i, { required: e.target.checked })}
                />
                required
              </label>
              {col.type === 'select' && (
                <input
                  className="rounded-lg border px-2 py-1.5 text-xs w-full"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  value={col.choicesText}
                  onChange={(e) => set(i, { choicesText: e.target.value })}
                  placeholder="Choices, comma-separated (e.g. Low, Medium, High)"
                />
              )}
              <div className="flex items-center gap-0.5 ml-auto">
                <IconBtn label="↑" title="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconBtn
                  label="↓"
                  title="Move down"
                  disabled={i === cols.length - 1}
                  onClick={() => move(i, 1)}
                />
                <IconBtn label="✕" title="Delete column" danger onClick={() => remove(i)} />
              </div>
            </div>
          ))}
          {cols.length === 0 && (
            <p className="text-sm py-3" style={{ color: 'var(--text-3)' }}>
              No columns. Add one to start.
            </p>
          )}
        </div>
        <button
          type="button"
          className="mt-2 text-sm underline"
          style={{ color: 'var(--text-2)' }}
          onClick={add}
        >
          + add column
        </button>
        <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
          Removing a column hides its data from the grid; renaming or reordering never touches your
          rows.
        </p>
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <ErrorNote message={error} />
          <SubmitButton label="Save columns" busy={busy} />
        </div>
      </form>
    </Modal>
  )
}

function IconBtn(props: {
  label: string
  title: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="w-6 h-6 rounded border text-xs disabled:opacity-30"
      style={{
        borderColor: 'var(--border)',
        color: props.danger ? 'var(--danger)' : 'var(--text-2)',
      }}
    >
      {props.label}
    </button>
  )
}

function RenameModal(props: { table: DbTableView; onClose: () => void; onSaved: () => void }) {
  const rename = trpc.tables.rename.useMutation()
  const [name, setName] = useState(props.table.name)
  const [description, setDescription] = useState(props.table.description ?? '')
  const { busy, error, onSubmit } = useSubmit(async () => {
    await rename.mutateAsync({
      tableId: props.table.id,
      name: name.trim(),
      description: description.trim() || null,
    })
    props.onSaved()
  })
  const dirty = name !== props.table.name || description !== (props.table.description ?? '')
  return (
    <Modal title="Rename table" onClose={props.onClose} dirty={dirty}>
      <form onSubmit={onSubmit}>
        <Field label="Name" value={name} onChange={setName} autoFocus />
        <Field label="Description (optional)" value={description} onChange={setDescription} />
        <ErrorNote message={error} />
        <SubmitButton label="Save" busy={busy} />
      </form>
    </Modal>
  )
}
