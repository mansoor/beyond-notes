import { type DbColumn, type DbColumnDraft, validateRowCells } from '@bn/schema'
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
      return {
        id,
        name: c.name,
        type: c.type,
        required: c.required,
        choices: c.type === 'select' ? c.choices : [],
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
  }
}

export type TablesService = ReturnType<typeof createTablesService>
