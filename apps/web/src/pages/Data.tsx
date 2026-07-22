import type {
  CaptchaMode,
  DatabaseView,
  DbCellValue,
  DbColumnConstraints,
  DbColumnDraft,
  DbColumnType,
  DbRowView,
  DbTableView,
  FormBlock,
  FormConfig,
  FormFieldPlacement,
} from '@bn/schema'
import {
  FORM_MAX_COLUMNS,
  formWidthChoices,
  normalizeFormLayout,
  normalizeFormOrder,
} from '@bn/schema'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ErrorNote, Field, Modal, SubmitButton, useMenuAnchor, useSubmit } from '../components'
import { catToken, dbToken, useSidebarPrefs } from '../sidebarprefs'
import { NewSpaceModal } from '../spaces'
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

/** Top-level "Databases" section: each database holds tables, a peer to the
 * Notebooks/Sites/Wikis spaces above it. */
export function DatabasesNav() {
  const databases = trpc.databases.list.useQuery()
  const tables = trpc.tables.list.useQuery()
  const prefs = useSidebarPrefs()
  // the same dialog the other sections use, so a database is named (and can get
  // its first table) at creation instead of arriving as "Untitled database"
  const [creating, setCreating] = useState(false)

  // hidden from Settings › Appearance — the section leaves the sidebar whole
  if (prefs.isHidden(catToken('database'))) return null

  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-wide font-semibold mb-1 px-2 flex items-center"
        style={{ color: 'var(--text-3)' }}
      >
        Databases
        <button
          type="button"
          title="New database"
          className="ml-auto text-xs px-1"
          onClick={() => setCreating(true)}
        >
          ＋
        </button>
      </div>
      {creating && <NewSpaceModal preset="database" onClose={() => setCreating(false)} />}
      {(databases.data ?? [])
        .filter((database) => !prefs.isHidden(dbToken(database.id)))
        .map((database) => (
          <DatabaseItem
            key={database.id}
            database={database}
            tables={(tables.data ?? []).filter((t) => t.databaseId === database.id)}
          />
        ))}
      {databases.data?.length === 0 && (
        <div className="text-xs px-2 py-1" style={{ color: 'var(--text-3)' }}>
          none yet —{' '}
          <button type="button" className="underline" onClick={() => setCreating(true)}>
            new database
          </button>
        </div>
      )}
    </div>
  )
}

function DatabaseItem(props: { database: DatabaseView; tables: DbTableView[] }) {
  const { database } = props
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuStyle = useMenuAnchor(menuOpen, btnRef, 144)
  const [renaming, setRenaming] = useState(false)
  const params = useParams({ strict: false }) as { tableId?: string }

  const createTable = trpc.tables.create.useMutation({
    onSuccess: async (table) => {
      await utils.tables.list.invalidate()
      navigate({ to: '/data/$tableId', params: { tableId: table.id } })
    },
  })
  const del = trpc.databases.delete.useMutation({
    onSuccess: () =>
      Promise.all([utils.databases.list.invalidate(), utils.tables.list.invalidate()]),
  })

  return (
    <div className="mb-1">
      <div
        className="group flex items-center gap-1 px-2 py-1 rounded text-sm font-medium"
        style={{ color: 'var(--text-2)' }}
      >
        <button type="button" onClick={() => setExpanded(!expanded)} className="w-4 text-xs">
          {expanded ? '▾' : '▸'}
        </button>
        <span className="truncate">{database.name}</span>
        {database.personal && (
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }} title="Personal">
            ⛭
          </span>
        )}
        <span className="ml-auto opacity-0 group-hover:opacity-100 flex items-center">
          <button
            type="button"
            title="New table"
            className="text-xs px-1"
            style={{ color: 'var(--text-3)' }}
            onClick={() => createTable.mutate({ databaseId: database.id, name: 'Untitled table' })}
          >
            ＋
          </button>
          <span className="relative">
            <button
              ref={btnRef}
              type="button"
              title="Database menu"
              className="text-xs px-1"
              style={{ color: 'var(--text-3)' }}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                className="z-50 rounded-lg border py-1 text-sm shadow-lg"
                style={{ ...menuStyle, background: 'var(--panel)', borderColor: 'var(--border)' }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ color: 'var(--text)' }}
                  onClick={() => {
                    setMenuOpen(false)
                    setRenaming(true)
                  }}
                >
                  Rename
                </button>
                <a
                  href={`/api/export/database/${database.id}`}
                  download
                  className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ color: 'var(--text)' }}
                  onClick={() => setMenuOpen(false)}
                >
                  Export CSV (zip)
                </a>
                <button
                  type="button"
                  className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => {
                    setMenuOpen(false)
                    if (
                      confirm(
                        `Delete "${database.name}" and every table and row inside it? This cannot be undone.`,
                      )
                    ) {
                      del.mutate({ databaseId: database.id })
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </span>
        </span>
      </div>
      {expanded &&
        props.tables.map((table) => (
          <TableRow key={table.id} table={table} active={params.tableId === table.id} />
        ))}
      {expanded && props.tables.length === 0 && (
        <div className="text-xs py-1" style={{ paddingLeft: 26, color: 'var(--text-3)' }}>
          empty —{' '}
          <button
            type="button"
            className="underline"
            onClick={() => createTable.mutate({ databaseId: database.id, name: 'Untitled table' })}
          >
            add a table
          </button>
        </div>
      )}
      {renaming && <RenameDatabaseModal database={database} onClose={() => setRenaming(false)} />}
    </div>
  )
}

function RenameDatabaseModal(props: { database: DatabaseView; onClose: () => void }) {
  const utils = trpc.useUtils()
  const rename = trpc.databases.rename.useMutation()
  const [name, setName] = useState(props.database.name)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await rename.mutateAsync({ databaseId: props.database.id, name: name.trim() })
    await utils.databases.list.invalidate()
    props.onClose()
  })
  return (
    <Modal title="Rename database" onClose={props.onClose} dirty={name !== props.database.name}>
      <form onSubmit={onSubmit}>
        <Field label="Name" value={name} onChange={setName} autoFocus />
        <ErrorNote message={error} />
        <SubmitButton label="Save" busy={busy} />
      </form>
    </Modal>
  )
}

function TableRow(props: { table: DbTableView; active: boolean }) {
  const { table } = props
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuStyle = useMenuAnchor(menuOpen, btnRef, 160)
  const [action, setAction] = useState<null | 'rename' | 'move'>(null)

  const refresh = () =>
    Promise.all([utils.tables.list.invalidate(), utils.databases.list.invalidate()])
  const duplicate = trpc.tables.duplicate.useMutation({
    onSuccess: async (copy) => {
      await utils.tables.list.invalidate()
      navigate({ to: '/data/$tableId', params: { tableId: copy.id } })
    },
  })
  const del = trpc.tables.delete.useMutation({
    onSuccess: async () => {
      await utils.tables.list.invalidate()
      navigate({ to: '/' })
    },
  })
  const archive = trpc.tables.archive.useMutation({
    onSuccess: async () => {
      await utils.tables.list.invalidate()
      if (props.active) navigate({ to: '/' })
    },
  })
  const item = 'block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5'

  return (
    <div
      className="group flex items-center rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
      style={{ background: props.active ? 'var(--accent-soft)' : undefined }}
    >
      <Link
        to="/data/$tableId"
        params={{ tableId: table.id }}
        className="block truncate flex-1"
        style={{
          paddingLeft: 26,
          paddingTop: 2,
          paddingBottom: 2,
          color: props.active ? 'var(--accent)' : 'var(--text-2)',
        }}
        title={table.name}
      >
        ▦ {table.name}
      </Link>
      <span className="relative pr-1">
        <button
          ref={btnRef}
          type="button"
          title="Table menu"
          className="hidden group-hover:block text-xs px-1"
          style={{ color: 'var(--text-3)' }}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="z-50 rounded-lg border py-1 text-sm shadow-lg"
            style={{ ...menuStyle, background: 'var(--panel)', borderColor: 'var(--border)' }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className={item}
              style={{ color: 'var(--text)' }}
              onClick={() => {
                setMenuOpen(false)
                setAction('rename')
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className={item}
              style={{ color: 'var(--text)' }}
              onClick={() => {
                setMenuOpen(false)
                duplicate.mutate({ tableId: table.id })
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className={item}
              style={{ color: 'var(--text)' }}
              onClick={() => {
                setMenuOpen(false)
                setAction('move')
              }}
            >
              Move to…
            </button>
            <a
              href={`/api/export/table/${table.id}`}
              download
              className={item}
              style={{ color: 'var(--text)' }}
              onClick={() => setMenuOpen(false)}
            >
              Export CSV
            </a>
            <button
              type="button"
              className={item}
              style={{ color: 'var(--text)' }}
              title="Hide from the sidebar; restore any time from Archive"
              onClick={() => {
                setMenuOpen(false)
                archive.mutate({ tableId: table.id })
              }}
            >
              Archive
            </button>
            <button
              type="button"
              className={item}
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                setMenuOpen(false)
                if (confirm(`Delete "${table.name}" and all its rows? This cannot be undone.`)) {
                  del.mutate({ tableId: table.id })
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
      </span>
      {action === 'rename' && (
        <RenameModal
          table={table}
          onClose={() => setAction(null)}
          onSaved={async () => {
            await refresh()
            setAction(null)
          }}
        />
      )}
      {action === 'move' && (
        <MoveTableModal
          table={table}
          onClose={() => setAction(null)}
          onSaved={async () => {
            await refresh()
            setAction(null)
          }}
        />
      )}
    </div>
  )
}

function MoveTableModal(props: { table: DbTableView; onClose: () => void; onSaved: () => void }) {
  const databases = trpc.databases.list.useQuery()
  const move = trpc.tables.move.useMutation()
  const [databaseId, setDatabaseId] = useState(props.table.databaseId)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await move.mutateAsync({ tableId: props.table.id, databaseId })
    props.onSaved()
  })
  return (
    <Modal
      title={`Move "${props.table.name}"`}
      onClose={props.onClose}
      dirty={databaseId !== props.table.databaseId}
    >
      <form onSubmit={onSubmit}>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Database</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={databaseId}
            onChange={(e) => setDatabaseId(e.target.value)}
          >
            {databases.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === props.table.databaseId ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <ErrorNote message={error} />
        <SubmitButton label="Move" busy={busy} />
      </form>
    </Modal>
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
  const [editingForm, setEditingForm] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const databases = trpc.databases.list.useQuery()
  const databaseName = databases.data?.find((d) => d.id === table.databaseId)?.name

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

  const [cellError, setCellError] = useState<string | null>(null)

  const commitCell = (rowId: string, colId: string, value: DbCellValue) => {
    let nextCells: Record<string, DbCellValue> = {}
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r
        nextCells = { ...r.cells, [colId]: value }
        return { ...r, cells: nextCells }
      }),
    )
    updateRow.mutate(
      { rowId, cells: nextCells },
      {
        onError: (e) => {
          // a constraint rejected the value — tell the user and revert to server truth
          setCellError(e.message)
          rowsQuery.refetch()
        },
        onSuccess: () => setCellError(null),
      },
    )
  }

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId))
    deleteRow.mutate({ rowId })
  }

  return (
    <div className="max-w-6xl mx-auto px-10 py-8">
      {databaseName && (
        <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
          {databaseName} /
        </div>
      )}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">▦</span>
        <h1 className="text-2xl font-bold truncate">{table.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <HeaderBtn label="Columns" onClick={() => setEditingCols(true)} />
          <HeaderBtn
            label={table.form?.enabled ? 'Form ●' : 'Form'}
            onClick={() => setEditingForm(true)}
          />
          <HeaderBtn label="Embed" onClick={() => setEmbedOpen(true)} />
          <a
            href={`/api/export/table/${table.id}`}
            download
            className="text-xs rounded-lg border px-2.5 py-1"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            title="Download this table as a CSV (opens in Excel)"
          >
            Export CSV
          </a>
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
      {cellError && (
        <div
          className="mt-2 mb-1 text-sm rounded-lg border px-3 py-2 flex items-start gap-2"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          <span className="flex-1">{cellError}</span>
          <button type="button" onClick={() => setCellError(null)} title="Dismiss">
            ✕
          </button>
        </div>
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
                    className="px-1 border-b text-center whitespace-nowrap"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {row.source === 'form' && (
                      <span
                        className="text-[10px] mr-1"
                        style={{ color: 'var(--text-3)' }}
                        title="Submitted through the form"
                      >
                        ✉
                      </span>
                    )}
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
      {editingForm && (
        <FormModal
          table={table}
          onClose={() => setEditingForm(false)}
          onSaved={async () => {
            await Promise.all([
              utils.tables.get.invalidate({ tableId: table.id }),
              utils.tables.list.invalidate(),
            ])
            setEditingForm(false)
          }}
        />
      )}
      {embedOpen && <EmbedModal table={table} onClose={() => setEmbedOpen(false)} />}
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

function ConstraintInput(props: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  wide?: boolean
}) {
  return (
    <input
      className={`rounded border px-2 py-1 text-xs ${props.wide ? 'flex-1 min-w-[10rem]' : 'w-24'}`}
      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

type ColDraft = DbColumnDraft & {
  choicesText: string
  cMin: string
  cMax: string
  cMinLen: string
  cMaxLen: string
  cPattern: string
  cMessage: string
}

const hasConstraints = (t: DbColumnType) =>
  t === 'number' || t === 'text' || t === 'longtext' || t === 'email'

const numOrUndef = (s: string): number | undefined => {
  const n = Number(s.trim())
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined
}

function ColumnsModal(props: { table: DbTableView; onClose: () => void; onSaved: () => void }) {
  const update = trpc.tables.updateColumns.useMutation()
  const [cols, setCols] = useState<ColDraft[]>(
    props.table.columns.map((c) => ({
      ...c,
      choicesText: c.choices.join(', '),
      cMin: c.constraints?.min?.toString() ?? '',
      cMax: c.constraints?.max?.toString() ?? '',
      cMinLen: c.constraints?.minLength?.toString() ?? '',
      cMaxLen: c.constraints?.maxLength?.toString() ?? '',
      cPattern: c.constraints?.pattern ?? '',
      cMessage: c.constraints?.message ?? '',
    })),
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
        cMin: '',
        cMax: '',
        cMinLen: '',
        cMaxLen: '',
        cPattern: '',
        cMessage: '',
      },
    ])

  const { busy, error, onSubmit } = useSubmit(async () => {
    await update.mutateAsync({
      tableId: props.table.id,
      columns: cols.map((c) => {
        const constraints: DbColumnConstraints = {}
        if (c.type === 'number') {
          const mn = numOrUndef(c.cMin)
          const mx = numOrUndef(c.cMax)
          if (mn !== undefined) constraints.min = mn
          if (mx !== undefined) constraints.max = mx
        } else if (c.type === 'text' || c.type === 'longtext' || c.type === 'email') {
          const mnl = numOrUndef(c.cMinLen)
          const mxl = numOrUndef(c.cMaxLen)
          if (mnl !== undefined) constraints.minLength = mnl
          if (mxl !== undefined) constraints.maxLength = mxl
          if (c.cPattern.trim()) constraints.pattern = c.cPattern.trim()
        }
        if (c.cMessage.trim() && Object.keys(constraints).length > 0)
          constraints.message = c.cMessage.trim()
        return {
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
          ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
        }
      }),
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
              {hasConstraints(col.type) && (
                <div className="w-full flex flex-wrap items-center gap-2 pl-1">
                  <span className="text-[10px] uppercase" style={{ color: 'var(--text-3)' }}>
                    rules
                  </span>
                  {col.type === 'number' ? (
                    <>
                      <ConstraintInput
                        placeholder="min"
                        value={col.cMin}
                        onChange={(v) => set(i, { cMin: v })}
                      />
                      <ConstraintInput
                        placeholder="max"
                        value={col.cMax}
                        onChange={(v) => set(i, { cMax: v })}
                      />
                    </>
                  ) : (
                    <>
                      <ConstraintInput
                        placeholder="min length"
                        value={col.cMinLen}
                        onChange={(v) => set(i, { cMinLen: v })}
                      />
                      <ConstraintInput
                        placeholder="max length"
                        value={col.cMaxLen}
                        onChange={(v) => set(i, { cMaxLen: v })}
                      />
                      <ConstraintInput
                        placeholder="pattern (regex)"
                        value={col.cPattern}
                        onChange={(v) => set(i, { cPattern: v })}
                        wide
                      />
                    </>
                  )}
                  <ConstraintInput
                    placeholder="custom error message"
                    value={col.cMessage}
                    onChange={(v) => set(i, { cMessage: v })}
                    wide
                  />
                </div>
              )}
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

const DEFAULT_SUCCESS = 'Thanks — your response was received.'
/** on · field name · label/text · position · width · move & remove */
const FIELD_GRID = '2rem minmax(7rem,1fr) minmax(9rem,1.4fr) 4.5rem 4.5rem 4rem'

function FormModal(props: { table: DbTableView; onClose: () => void; onSaved: () => void }) {
  const update = trpc.tables.updateForm.useMutation()
  const existing = props.table.form
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [fields, setFields] = useState<string[]>(
    existing?.fields ?? props.table.columns.map((c) => c.id),
  )
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [submitLabel, setSubmitLabel] = useState(existing?.submitLabel ?? 'Submit')
  const [successMessage, setSuccessMessage] = useState(existing?.successMessage ?? DEFAULT_SUCCESS)
  const [notify, setNotify] = useState(existing?.notify ?? false)
  const [captcha, setCaptcha] = useState<CaptchaMode>(existing?.captcha ?? 'none')
  const [copied, setCopied] = useState(false)
  const [columns, setColumns] = useState(existing?.columns ?? 1)
  const [layout, setLayout] = useState<Record<string, FormFieldPlacement>>(existing?.layout ?? {})
  const [labels, setLabels] = useState<Record<string, string>>(existing?.labels ?? {})
  const [blocks, setBlocks] = useState<FormBlock[]>(existing?.blocks ?? [])
  // every row in the builder, ticked or not: the saved order for what is on
  // the form, then any column it does not mention
  const [order, setOrder] = useState<string[]>(() =>
    normalizeFormOrder(
      [...props.table.columns.map((c) => c.id), ...(existing?.blocks ?? []).map((b) => b.id)],
      existing?.order,
    ),
  )

  const embed = `[[form:${props.table.id}]]`
  const toggleField = (id: string) =>
    setFields((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))

  const blockById = new Map(blocks.map((b) => [b.id, b]))
  // rows are the whole builder order; what is saved is the part that is on
  const rows = order.filter(
    (id) => blockById.has(id) || props.table.columns.some((c) => c.id === id),
  )
  const ordered = rows.filter((id) => fields.includes(id))
  const onForm = rows.filter((id) => blockById.has(id) || fields.includes(id))
  // the placements actually in force: everything on the form, clamped to the grid
  const placed = normalizeFormLayout(onForm, columns, layout)
  const place = (id: string, patch: Partial<FormFieldPlacement>) =>
    setLayout((prev) => ({
      ...normalizeFormLayout(onForm, columns, prev),
      [id]: { ...(placed[id] ?? { col: 1, width: 1 }), ...patch },
    }))

  const addBlock = (kind: FormBlock['kind']) => {
    const id = `blk_${Math.random().toString(36).slice(2, 10)}`
    setBlocks((prev) => [...prev, { id, kind, text: '' }])
    setOrder((prev) => [...prev, id])
  }
  const dropBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
    setOrder((prev) => prev.filter((x) => x !== id))
  }
  /** Move a row one step; the grid fills in this order, so this IS the layout. */
  const move = (id: string, by: -1 | 1) =>
    setOrder((prev) => {
      const at = prev.indexOf(id)
      const to = at + by
      if (at < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      next[at] = next[to] as string
      next[to] = id
      return next
    })

  const { busy, error, onSubmit } = useSubmit(async () => {
    const form: FormConfig = {
      enabled,
      fields: ordered,
      columns,
      layout: placed,
      labels,
      blocks,
      order: onForm,
      title: title.trim(),
      description: description.trim(),
      submitLabel: submitLabel.trim() || 'Submit',
      successMessage: successMessage.trim() || DEFAULT_SUCCESS,
      notify,
      captcha,
    }
    await update.mutateAsync({ tableId: props.table.id, form })
    props.onSaved()
  })

  const removeForm = async () => {
    await update.mutateAsync({ tableId: props.table.id, form: null })
    props.onSaved()
  }

  const copyEmbed = () => {
    navigator.clipboard
      ?.writeText(embed)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <Modal title={`Form — ${props.table.name}`} onClose={props.onClose} dirty width="xl">
      <form onSubmit={onSubmit}>
        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable this form (accept public submissions)
        </label>

        <label className="block mb-3">
          <span className="block text-sm font-medium mb-1">Layout</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={columns}
            onChange={(e) => {
              const next = Number(e.target.value)
              setColumns(next)
              // narrowing the grid can strand a field — refit everything
              setLayout((prev) => normalizeFormLayout(ordered, next, prev))
            }}
          >
            {Array.from({ length: FORM_MAX_COLUMNS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'Single column' : `${n} columns`}
              </option>
            ))}
          </select>
        </label>

        {/* one table: what is on the form, what it is called, and where it sits
            are the same decision, and splitting them meant reading three lists
            to answer it */}
        <div className="mb-4">
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-sm font-medium">Fields configuration</span>
            <span className="ml-auto flex items-center gap-2 text-xs">
              <button
                type="button"
                className="underline"
                style={{ color: 'var(--accent)' }}
                onClick={() => addBlock('divider')}
              >
                ＋ separator
              </button>
              <button
                type="button"
                className="underline"
                style={{ color: 'var(--accent)' }}
                onClick={() => addBlock('text')}
              >
                ＋ text
              </button>
            </span>
          </div>
          {props.table.columns.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Add columns first — the form is generated from them.
            </p>
          ) : (
            <div
              className="rounded-lg border overflow-hidden"
              style={{ borderColor: 'var(--border)' }}
            >
              <div
                className="grid text-[11px] uppercase tracking-wide px-3 py-1.5"
                style={{
                  gridTemplateColumns: FIELD_GRID,
                  background: 'var(--panel)',
                  color: 'var(--text-3)',
                }}
              >
                <span>On</span>
                <span>Field name</span>
                <span>Label / text</span>
                <span>Position</span>
                <span>Width</span>
                <span />
              </div>
              {rows.map((id) => {
                const block = blockById.get(id)
                const col = props.table.columns.find((c) => c.id === id)
                const on = block ? true : fields.includes(id)
                const at = placed[id] ?? layout[id] ?? { col: 1, width: 1 }
                // a field that is off the form, or a form with no grid, has
                // nothing to place — the controls stay visible but inert so
                // the table does not reflow as boxes are ticked
                const inert = !on || columns === 1
                return (
                  <div
                    key={id}
                    className="grid items-center gap-2 px-3 py-1.5 border-t text-sm"
                    style={{ gridTemplateColumns: FIELD_GRID, borderColor: 'var(--border)' }}
                  >
                    {block ? (
                      <span
                        className="text-xs"
                        style={{ color: 'var(--text-3)' }}
                        title="Always shown"
                      >
                        —
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        className="justify-self-start"
                        aria-label={`Show ${col?.name ?? id} on the form`}
                        checked={on}
                        onChange={() => toggleField(id)}
                      />
                    )}
                    <span className="truncate" style={{ opacity: on ? 1 : 0.55 }}>
                      {block ? (
                        <em style={{ color: 'var(--text-2)' }}>
                          {block.kind === 'divider' ? 'Separator' : 'Text'}
                        </em>
                      ) : (
                        <>
                          {col?.name ?? id}{' '}
                          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                            {col?.type}
                            {col?.required ? ' · required' : ''}
                          </span>
                        </>
                      )}
                    </span>
                    {block?.kind === 'divider' ? (
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        a horizontal rule
                      </span>
                    ) : (
                      <input
                        className="w-full rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                        disabled={!on}
                        maxLength={block ? 500 : 200}
                        placeholder={block ? 'Text — [link](https://…) allowed' : col?.name}
                        value={block ? block.text : (labels[id] ?? '')}
                        onChange={(e) => {
                          const value = e.target.value
                          if (block) {
                            setBlocks((prev) =>
                              prev.map((b) => (b.id === id ? { ...b, text: value } : b)),
                            )
                          } else {
                            setLabels((prev) => ({ ...prev, [id]: value }))
                          }
                        }}
                      />
                    )}
                    <select
                      className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                      aria-label="Position"
                      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                      disabled={inert}
                      value={at.col}
                      onChange={(e) => place(id, { col: Number(e.target.value) })}
                    >
                      {Array.from({ length: columns }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                      aria-label="Width"
                      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                      disabled={inert}
                      value={at.width}
                      onChange={(e) => place(id, { width: Number(e.target.value) })}
                    >
                      {/* a field in the last position can only be one wide */}
                      {formWidthChoices(at.col, columns).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span className="flex items-center gap-1 justify-self-end text-xs">
                      <button
                        type="button"
                        title="Move up"
                        aria-label="Move up"
                        style={{ color: 'var(--text-3)' }}
                        onClick={() => move(id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        aria-label="Move down"
                        style={{ color: 'var(--text-3)' }}
                        onClick={() => move(id, 1)}
                      >
                        ↓
                      </button>
                      {block && (
                        <button
                          type="button"
                          title="Remove"
                          aria-label="Remove"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => dropBlock(id)}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
            {columns === 1
              ? 'Everything appears in this order, one per row. Choose a multi-column layout to place items side by side.'
              : 'Items fill the grid in the order above; a new row starts when the position is already taken. Narrow screens fall back to fewer columns.'}{' '}
            A label overrides the column name and may carry a link, written as{' '}
            <code>[terms](https://example.com/terms)</code>.
          </p>
        </div>

        <Field label="Heading (optional)" value={title} onChange={setTitle} />
        <Field label="Intro text (optional)" value={description} onChange={setDescription} />
        <Field label="Submit button label" value={submitLabel} onChange={setSubmitLabel} />
        <Field label="Success message" value={successMessage} onChange={setSuccessMessage} />

        <label className="flex items-center gap-2 my-3 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify me on each submission (via configured email / ntfy)
        </label>

        <label className="block mb-3">
          <span className="block text-sm font-medium mb-1">Spam protection</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={captcha}
            onChange={(e) => setCaptcha(e.target.value as CaptchaMode)}
          >
            <option value="none">None (honeypot + rate limit only)</option>
            <option value="basic">Basic — a simple math question (self-hosted)</option>
            <option value="recaptcha">Google reCAPTCHA (configure keys in Settings)</option>
          </select>
          {captcha === 'recaptcha' && (
            <span className="block text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
              Falls back to the basic challenge until reCAPTCHA keys are set in Settings.
            </span>
          )}
        </label>

        <div
          className="mb-4 rounded-lg border p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        >
          <span className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>
            Embed on a website or wiki page — paste this token where the form should appear:
          </span>
          <div className="flex items-center gap-2">
            <code className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg)' }}>
              {embed}
            </code>
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--text-2)' }}
              onClick={copyEmbed}
            >
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
            The form reflects these settings live on the published page — no republish needed.
          </p>
        </div>

        <ErrorNote message={error} />
        <SubmitButton label="Save form" busy={busy} />
        {existing && (
          <button
            type="button"
            className="mt-2 w-full text-center text-sm underline"
            style={{ color: 'var(--danger)' }}
            onClick={removeForm}
            disabled={busy}
          >
            Remove form
          </button>
        )}
      </form>
    </Modal>
  )
}

function EmbedModal(props: { table: DbTableView; onClose: () => void }) {
  const [copied, setCopied] = useState('')
  const base = `[[table='${props.table.id}']]`
  const full = `[[table='${props.table.id}' layout=table pagesize=10]]`
  const copy = (text: string, tag: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(tag)
        setTimeout(() => setCopied(''), 1500)
      })
      .catch(() => {})
  }
  const Snippet = (p: { text: string; tag: string }) => (
    <div className="flex items-center gap-2 mb-2">
      <code
        className="text-xs px-2 py-1 rounded flex-1 break-all"
        style={{ background: 'var(--bg)' }}
      >
        {p.text}
      </code>
      <button
        type="button"
        className="text-xs underline"
        style={{ color: 'var(--text-2)' }}
        onClick={() => copy(p.text, p.tag)}
      >
        {copied === p.tag ? 'copied' : 'copy'}
      </button>
    </div>
  )
  return (
    <Modal title={`Embed — ${props.table.name}`} onClose={props.onClose} width="lg">
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Paste a token into a website or wiki page to show this table&apos;s rows read-only. It
        reflects the live data — no republish needed.
      </p>
      <Snippet text={base} tag="base" />
      <Snippet text={full} tag="full" />
      <div className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
        <p className="font-medium mb-1" style={{ color: 'var(--text-2)' }}>
          Options (all optional):
        </p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>
            <code>layout=</code> table · cards · list
          </li>
          <li>
            <code>columns=</code> comma-separated column names to show (and their order)
          </li>
          <li>
            <code>pagesize=</code> rows per page (adds pagination)
          </li>
          <li>
            <code>limit=</code> max rows · <code>sort=</code> Column or Column:desc ·{' '}
            <code>filter=</code> Column:value
          </li>
        </ul>
        <p className="mt-2">
          Only tables in a shared (non-personal) database can be shown publicly.
        </p>
      </div>
    </Modal>
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
