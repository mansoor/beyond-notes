import {
  type DbCellValue,
  type DbColumn,
  type DbColumnConstraints,
  type DbColumnDraft,
  type FormConfig,
  validateRowCells,
} from '@bn/schema'
import { zipSync } from 'fflate'
import { nanoid } from 'nanoid'
import type { DbDatabaseRow, DbRowRow, DbTableRow, Repo, UserRow } from './repo'

export class TablesError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'BAD_REQUEST',
    message: string,
  ) {
    super(message)
  }
}

function fileSafe(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'table'
  )
}

function csvCell(v: DbCellValue): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function tableToCsv(columns: DbColumn[], rows: DbRowRow[]): string {
  const header = columns.map((c) => csvCell(c.name)).join(',')
  const body = rows.map((r) => {
    let cells: Record<string, DbCellValue> = {}
    try {
      const parsed = JSON.parse(r.cells)
      if (parsed && typeof parsed === 'object') cells = parsed
    } catch {}
    return columns.map((c) => csvCell(cells[c.id] ?? null)).join(',')
  })
  return [header, ...body].join('\r\n')
}

/** Keep only the constraint fields that apply to the column's type, dropping
 * empty objects so unconstrained columns stay clean. */
function pruneConstraints(
  type: DbColumn['type'],
  raw: DbColumnConstraints | undefined,
): DbColumnConstraints | undefined {
  if (!raw) return undefined
  const out: DbColumnConstraints = {}
  if (type === 'number') {
    if (raw.min != null) out.min = raw.min
    if (raw.max != null) out.max = raw.max
  } else if (type === 'text' || type === 'longtext' || type === 'email') {
    if (raw.minLength != null) out.minLength = raw.minLength
    if (raw.maxLength != null) out.maxLength = raw.maxLength
    if (raw.pattern) out.pattern = raw.pattern
  }
  if (raw.message && Object.keys(out).length > 0) out.message = raw.message
  return Object.keys(out).length > 0 ? out : undefined
}

/** A fresh table opens with one text column so the grid has something to edit. */
function defaultColumns(): DbColumn[] {
  return [{ id: nanoid(8), name: 'Name', type: 'text', required: false, choices: [] }]
}

function parseColumns(raw: string): DbColumn[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DbColumn[]) : []
  } catch {
    return []
  }
}

function parseForm(raw: string | null): FormConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as FormConfig) : null
  } catch {
    return null
  }
}

function assertAccess(db: DbDatabaseRow | null, user: UserRow): asserts db is DbDatabaseRow {
  if (!db) throw new TablesError('NOT_FOUND', 'Database not found.')
  // personal databases are invisible to everyone but their owner (spaces rule)
  if (db.ownerId !== null && db.ownerId !== user.id) {
    throw new TablesError('NOT_FOUND', 'Database not found.')
  }
}

export function createTablesService(repo: Repo, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  async function requireDatabase(databaseId: string, user: UserRow): Promise<DbDatabaseRow> {
    const database = await repo.getDbDatabase(databaseId)
    assertAccess(database, user)
    return database
  }

  /** A table plus the database that governs its access. */
  async function requireTable(
    tableId: string,
    user: UserRow,
  ): Promise<{ table: DbTableRow; database: DbDatabaseRow }> {
    const table = await repo.getDbTable(tableId)
    if (!table) throw new TablesError('NOT_FOUND', 'Table not found.')
    const database = await repo.getDbDatabase(table.databaseId)
    assertAccess(database, user)
    return { table, database }
  }

  /** Assign stable ids to new columns, preserve existing ones, and drop the
   * choices of non-select columns. */
  function normalizeColumns(drafts: DbColumnDraft[]): DbColumn[] {
    const used = new Set<string>()
    return drafts.map((c) => {
      const id = c.id && !used.has(c.id) ? c.id : nanoid(8)
      used.add(id)
      const constraints = pruneConstraints(c.type, c.constraints)
      return {
        id,
        name: c.name,
        type: c.type,
        required: c.required,
        choices: c.type === 'select' ? c.choices : [],
        ...(constraints ? { constraints } : {}),
      }
    })
  }

  return {
    // ---- databases ----

    /** Databases this user can see: household ones plus their own personal ones. */
    async listDatabases(user: UserRow): Promise<DbDatabaseRow[]> {
      const all = await repo.listDbDatabases()
      return all
        .filter((d) => d.ownerId === null || d.ownerId === user.id)
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
    },

    async createDatabase(
      user: UserRow,
      input: { name: string; personal: boolean },
    ): Promise<DbDatabaseRow> {
      const all = await repo.listDbDatabases()
      const row: DbDatabaseRow = {
        id: nanoid(),
        ownerId: input.personal ? user.id : null,
        name: input.name,
        position: all.length,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertDbDatabase(row)
      return row
    },

    async renameDatabase(
      user: UserRow,
      input: { databaseId: string; name: string },
    ): Promise<void> {
      await requireDatabase(input.databaseId, user)
      await repo.updateDbDatabase(input.databaseId, { name: input.name, updatedAt: now() })
    },

    async deleteDatabase(user: UserRow, databaseId: string): Promise<void> {
      await requireDatabase(databaseId, user)
      await repo.deleteDbDatabase(databaseId)
    },

    // ---- tables ----

    /** Every table across the databases this user can see. */
    async listTables(user: UserRow): Promise<DbTableRow[]> {
      const dbs = await this.listDatabases(user)
      const ids = new Set(dbs.map((d) => d.id))
      const all = await repo.listDbTables()
      return all
        .filter((tb) => ids.has(tb.databaseId))
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
    },

    async getTable(user: UserRow, tableId: string): Promise<DbTableRow> {
      return (await requireTable(tableId, user)).table
    },

    async createTable(
      user: UserRow,
      input: { databaseId: string; name: string },
    ): Promise<DbTableRow> {
      await requireDatabase(input.databaseId, user)
      const existing = await repo.listDbTablesInDatabase(input.databaseId)
      const row: DbTableRow = {
        id: nanoid(),
        databaseId: input.databaseId,
        name: input.name,
        description: '',
        columns: JSON.stringify(defaultColumns()),
        form: null,
        position: existing.length,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertDbTable(row)
      return row
    },

    async renameTable(
      user: UserRow,
      input: { tableId: string; name: string; description: string | null },
    ): Promise<void> {
      await requireTable(input.tableId, user)
      await repo.updateDbTable(input.tableId, {
        name: input.name,
        description: input.description?.trim() ?? '',
        updatedAt: now(),
      })
    },

    async updateColumns(
      user: UserRow,
      input: { tableId: string; columns: DbColumnDraft[] },
    ): Promise<DbColumn[]> {
      await requireTable(input.tableId, user)
      const columns = normalizeColumns(input.columns)
      await repo.updateDbTable(input.tableId, {
        columns: JSON.stringify(columns),
        updatedAt: now(),
      })
      return columns
    },

    /** Set (or clear, with null) the table's public intake form. Fields are
     * pruned to real columns so a deleted column never lingers in the form. */
    async updateForm(
      user: UserRow,
      input: { tableId: string; form: FormConfig | null },
    ): Promise<FormConfig | null> {
      const { table } = await requireTable(input.tableId, user)
      let form: FormConfig | null = null
      if (input.form) {
        const columnIds = new Set(parseColumns(table.columns).map((c) => c.id))
        form = { ...input.form, fields: input.form.fields.filter((id) => columnIds.has(id)) }
      }
      await repo.updateDbTable(input.tableId, {
        form: form ? JSON.stringify(form) : null,
        updatedAt: now(),
      })
      return form
    },

    async deleteTable(user: UserRow, tableId: string): Promise<void> {
      await requireTable(tableId, user)
      await repo.deleteDbTable(tableId)
    },

    // ---- rows ----

    async listRows(user: UserRow, tableId: string): Promise<DbRowRow[]> {
      await requireTable(tableId, user)
      return (await repo.listDbRows(tableId)).sort(
        (a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
      )
    },

    async insertRow(
      user: UserRow,
      input: { tableId: string; cells: Record<string, unknown> },
    ): Promise<DbRowRow> {
      const { table } = await requireTable(input.tableId, user)
      // grid edits don't enforce `required` — a row is filled after it's added
      const checked = validateRowCells(parseColumns(table.columns), input.cells)
      if (!checked.ok) throw new TablesError('BAD_REQUEST', checked.error)
      const existing = await repo.listDbRows(input.tableId)
      const row: DbRowRow = {
        id: nanoid(),
        tableId: input.tableId,
        cells: JSON.stringify(checked.cells),
        source: 'manual',
        position: existing.length,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertDbRow(row)
      return row
    },

    async updateRow(
      user: UserRow,
      input: { rowId: string; cells: Record<string, unknown> },
    ): Promise<void> {
      const existing = await repo.getDbRow(input.rowId)
      if (!existing) throw new TablesError('NOT_FOUND', 'Row not found.')
      const { table } = await requireTable(existing.tableId, user)
      const checked = validateRowCells(parseColumns(table.columns), input.cells)
      if (!checked.ok) throw new TablesError('BAD_REQUEST', checked.error)
      await repo.updateDbRow(input.rowId, {
        cells: JSON.stringify(checked.cells),
        updatedAt: now(),
      })
    },

    async deleteRow(user: UserRow, rowId: string): Promise<void> {
      const existing = await repo.getDbRow(rowId)
      if (!existing) return
      await requireTable(existing.tableId, user)
      await repo.deleteDbRow(rowId)
    },

    // ---- public form intake (no user; the intake is public by design) ----

    /**
     * Accept one public submission for a table's form. Validates the exposed
     * fields (required enforced here, unlike grid edits), writes a `form` row,
     * and returns enough context for the caller to notify. Honeypot and rate
     * limiting live at the HTTP edge, not here.
     */
    async submitForm(
      tableId: string,
      values: Record<string, unknown>,
      opts: { verifyCaptcha?: (form: FormConfig) => boolean | Promise<boolean> } = {},
    ): Promise<{ table: DbTableRow; database: DbDatabaseRow; row: DbRowRow; form: FormConfig }> {
      const table = await repo.getDbTable(tableId)
      if (!table) throw new TablesError('NOT_FOUND', 'Form not found.')
      const form = parseForm(table.form)
      if (!form || !form.enabled) throw new TablesError('NOT_FOUND', 'Form not found.')
      const database = await repo.getDbDatabase(table.databaseId)
      if (!database) throw new TablesError('NOT_FOUND', 'Form not found.')

      // captcha before field validation, so a failed challenge reveals nothing
      if ((form.captcha ?? 'none') !== 'none' && opts.verifyCaptcha) {
        const ok = await opts.verifyCaptcha(form)
        if (!ok) throw new TablesError('BAD_REQUEST', 'Please complete the verification challenge.')
      }

      // only the columns the form actually exposes are accepted
      const exposed = new Set(form.fields)
      const columns = parseColumns(table.columns).filter((c) => exposed.has(c.id))
      const checked = validateRowCells(columns, values, { requireAll: true })
      if (!checked.ok) throw new TablesError('BAD_REQUEST', checked.error)

      const existing = await repo.listDbRows(tableId)
      const row: DbRowRow = {
        id: nanoid(),
        tableId,
        cells: JSON.stringify(checked.cells),
        source: 'form',
        position: existing.length,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertDbRow(row)
      return { table, database, row, form }
    },

    // ---- export ----

    async exportTableCsv(
      user: UserRow,
      tableId: string,
    ): Promise<{ filename: string; csv: string }> {
      const { table } = await requireTable(tableId, user)
      const columns = parseColumns(table.columns)
      const rows = (await repo.listDbRows(tableId)).sort(
        (a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
      )
      return { filename: `${fileSafe(table.name)}.csv`, csv: tableToCsv(columns, rows) }
    },

    /** Every table in a database as a zip of CSVs. */
    async exportDatabaseZip(
      user: UserRow,
      databaseId: string,
    ): Promise<{ filename: string; data: Buffer }> {
      const database = await requireDatabase(databaseId, user)
      const tables = (await repo.listDbTablesInDatabase(databaseId)).sort(
        (a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
      )
      const files: Record<string, Uint8Array> = {}
      const taken = new Set<string>()
      const enc = new TextEncoder()
      for (const table of tables) {
        let name = fileSafe(table.name)
        let n = 2
        while (taken.has(name.toLowerCase())) name = `${fileSafe(table.name)} ${n++}`
        taken.add(name.toLowerCase())
        const rows = (await repo.listDbRows(table.id)).sort(
          (a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
        )
        files[`${name}.csv`] = enc.encode(tableToCsv(parseColumns(table.columns), rows))
      }
      return {
        filename: `${fileSafe(database.name)}.zip`,
        data: Buffer.from(zipSync(files, { level: 6 })),
      }
    },
  }
}

export type TablesService = ReturnType<typeof createTablesService>
