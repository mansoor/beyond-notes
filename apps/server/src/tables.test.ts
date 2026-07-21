import { type DbColumn, validateRowCells } from '@bn/schema'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { createRepo } from './repo'
import { TablesError, createTablesService } from './tables'

/** Narrow away `undefined` from an indexed access without a non-null assertion. */
function req<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('expected a value')
  return x
}

const dialects: Array<{ name: string; make: () => Promise<AppDb> }> = [
  {
    name: 'sqlite',
    make: async () => {
      const db = createDb('file::memory:')
      await db.migrate('./drizzle')
      return db
    },
  },
]

if (process.env.TEST_PG_URL) {
  dialects.push({
    name: 'pg',
    make: async () => {
      const db = createDb(process.env.TEST_PG_URL as string)
      await db.db.execute(sql.raw('drop schema public cascade'))
      await db.db.execute(sql.raw('create schema public'))
      await db.db.execute(sql.raw('drop schema if exists drizzle cascade'))
      await db.migrate('./drizzle')
      return db
    },
  })
}

describe('validateRowCells (pure)', () => {
  const cols: DbColumn[] = [
    { id: 'c_name', name: 'Name', type: 'text', required: true, choices: [] },
    { id: 'c_age', name: 'Age', type: 'number', required: false, choices: [] },
    { id: 'c_when', name: 'When', type: 'date', required: false, choices: [] },
    { id: 'c_mail', name: 'Email', type: 'email', required: false, choices: [] },
    { id: 'c_prio', name: 'Priority', type: 'select', required: false, choices: ['Low', 'High'] },
    { id: 'c_done', name: 'Done', type: 'checkbox', required: false, choices: [] },
  ]

  it('coerces numbers and checkboxes', () => {
    const r = validateRowCells(cols, { c_name: 'Ann', c_age: '42', c_done: 'true' })
    expect(r).toEqual({
      ok: true,
      cells: {
        c_name: 'Ann',
        c_age: 42,
        c_when: null,
        c_mail: null,
        c_prio: null,
        c_done: true,
      },
    })
  })

  it('rejects a non-numeric number, bad date, bad email, and out-of-set select', () => {
    expect(validateRowCells(cols, { c_name: 'x', c_age: 'abc' }).ok).toBe(false)
    expect(validateRowCells(cols, { c_name: 'x', c_when: '2020/01/01' }).ok).toBe(false)
    expect(validateRowCells(cols, { c_name: 'x', c_mail: 'nope' }).ok).toBe(false)
    expect(validateRowCells(cols, { c_name: 'x', c_prio: 'Mid' }).ok).toBe(false)
  })

  it('drops orphan keys from removed columns', () => {
    const r = validateRowCells(cols, { c_name: 'x', c_gone: 'stale' })
    expect(r.ok).toBe(true)
    if (r.ok) expect('c_gone' in r.cells).toBe(false)
  })

  it('enforces required only when requireAll is set', () => {
    expect(validateRowCells(cols, { c_age: 1 }).ok).toBe(true) // grid: required not enforced
    const strict = validateRowCells(cols, { c_age: 1 }, { requireAll: true })
    expect(strict.ok).toBe(false) // form: missing required Name
  })

  it('enforces column constraints and prefers a custom message', () => {
    const cc: DbColumn[] = [
      {
        id: 'c_age',
        name: 'Age',
        type: 'number',
        required: false,
        choices: [],
        constraints: { min: 18, max: 99, message: 'Age must be 18–99.' },
      },
      {
        id: 'c_code',
        name: 'Code',
        type: 'text',
        required: false,
        choices: [],
        constraints: { minLength: 3, pattern: '^[A-Z]+$' },
      },
    ]
    const low = validateRowCells(cc, { c_age: 10 })
    expect(low.ok).toBe(false)
    if (!low.ok) expect(low.error).toBe('Age must be 18–99.') // custom message wins
    expect(validateRowCells(cc, { c_age: 50 }).ok).toBe(true)
    expect(validateRowCells(cc, { c_code: 'ab' }).ok).toBe(false) // too short
    expect(validateRowCells(cc, { c_code: 'abc' }).ok).toBe(false) // fails the pattern
    expect(validateRowCells(cc, { c_code: 'ABC' }).ok).toBe(true)
  })
})

for (const dialect of dialects) {
  describe(`tables service (${dialect.name})`, () => {
    async function setup() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      let tick = 1_700_000_000_000
      const tables = createTablesService(repo, {
        now: () => {
          tick += 10
          return new Date(tick)
        },
      })
      const { user: admin } = await auth.setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      const invite = await auth.createInvite(admin.id, { role: 'member' })
      const { user: member } = await auth.acceptInvite({
        token: invite.token,
        name: 'P',
        email: 'p@x.dev',
        password: 'longpassword2',
      })
      return { repo, tables, admin, member }
    }

    it('creates a table with a default column and one row round-trips', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'CRM', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'Contacts' })
      const cols = await tables.updateColumns(admin, {
        tableId: table.id,
        columns: [
          { name: 'Name', type: 'text', required: true, choices: [] },
          { name: 'Age', type: 'number', required: false, choices: [] },
        ],
      })
      expect(cols).toHaveLength(2)
      expect(cols[0]?.id).toBeTruthy() // server assigned ids

      const nameId = req(cols[0]).id
      const ageId = req(cols[1]).id
      const row = await tables.insertRow(admin, {
        tableId: table.id,
        cells: { [nameId]: 'Ann', [ageId]: '30' },
      })
      const stored = JSON.parse(row.cells)
      expect(stored[ageId]).toBe(30) // coerced to a number at the boundary

      const rows = await tables.listRows(admin, table.id)
      expect(rows).toHaveLength(1)
    })

    it('preserves column ids across a rename so rows keep their cells', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'T' })
      const c1 = req(
        (
          await tables.updateColumns(admin, {
            tableId: table.id,
            columns: [{ name: 'First', type: 'text', required: false, choices: [] }],
          })
        )[0],
      )
      await tables.insertRow(admin, { tableId: table.id, cells: { [c1.id]: 'value' } })
      // rename the column (same id) — the row's cell must still resolve
      const renamed = req(
        (
          await tables.updateColumns(admin, {
            tableId: table.id,
            columns: [{ id: c1.id, name: 'Renamed', type: 'text', required: false, choices: [] }],
          })
        )[0],
      )
      expect(renamed.id).toBe(c1.id)
      const rows = await tables.listRows(admin, table.id)
      expect(JSON.parse(req(rows[0]).cells)[c1.id]).toBe('value')
    })

    it('hides a personal database (and its tables) from other members', async () => {
      const { tables, admin, member } = await setup()
      const privateDb = await tables.createDatabase(admin, { name: 'Private', personal: true })
      const sharedDb = await tables.createDatabase(admin, { name: 'Shared', personal: false })
      const secret = await tables.createTable(admin, { databaseId: privateDb.id, name: 'Secret' })
      const shared = await tables.createTable(admin, { databaseId: sharedDb.id, name: 'Shared' })

      const memberDbs = await tables.listDatabases(member)
      expect(memberDbs.map((d) => d.id)).toContain(sharedDb.id)
      expect(memberDbs.map((d) => d.id)).not.toContain(privateDb.id)

      const memberTables = await tables.listTables(member)
      expect(memberTables.map((t) => t.id)).toContain(shared.id)
      expect(memberTables.map((t) => t.id)).not.toContain(secret.id)

      await expect(tables.getTable(member, secret.id)).rejects.toBeInstanceOf(TablesError)
      await expect(
        tables.createTable(member, { databaseId: privateDb.id, name: 'X' }),
      ).rejects.toBeInstanceOf(TablesError)
    })

    it('rejects a row whose value fails its column type', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'T' })
      const c = req(
        (
          await tables.updateColumns(admin, {
            tableId: table.id,
            columns: [{ name: 'Count', type: 'number', required: false, choices: [] }],
          })
        )[0],
      )
      await expect(
        tables.insertRow(admin, { tableId: table.id, cells: { [c.id]: 'not-a-number' } }),
      ).rejects.toBeInstanceOf(TablesError)
    })

    it('accepts a valid form submission and enforces required fields', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'Contact' })
      const cols = await tables.updateColumns(admin, {
        tableId: table.id,
        columns: [
          { name: 'Name', type: 'text', required: true, choices: [] },
          { name: 'Email', type: 'email', required: true, choices: [] },
          { name: 'Internal', type: 'text', required: false, choices: [] },
        ],
      })
      const nameId = req(cols[0]).id
      const emailId = req(cols[1]).id
      const internalId = req(cols[2]).id

      // only expose Name + Email on the form (Internal stays grid-only)
      await tables.updateForm(admin, {
        tableId: table.id,
        form: {
          enabled: true,
          fields: [nameId, emailId],
          title: 'Say hi',
          description: '',
          submitLabel: 'Send',
          successMessage: 'Got it.',
          notify: false,
          captcha: 'none',
        },
      })

      // a submission missing the required Name is rejected
      await expect(tables.submitForm(table.id, { [emailId]: 'a@b.com' })).rejects.toBeInstanceOf(
        TablesError,
      )

      // a valid submission is stored as a form row; an unexposed field is ignored
      const { row } = await tables.submitForm(table.id, {
        [nameId]: 'Ann',
        [emailId]: 'ann@example.com',
        [internalId]: 'should be dropped',
      })
      expect(row.source).toBe('form')
      const cells = JSON.parse(row.cells)
      expect(cells[nameId]).toBe('Ann')
      expect(internalId in cells).toBe(false)
    })

    it('refuses submissions to a missing or disabled form', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'T' })
      // no form configured yet
      await expect(tables.submitForm(table.id, {})).rejects.toBeInstanceOf(TablesError)

      // a disabled form is also closed to the public
      await tables.updateForm(admin, {
        tableId: table.id,
        form: {
          enabled: false,
          fields: [],
          title: '',
          description: '',
          submitLabel: 'Submit',
          successMessage: 'ok',
          notify: false,
          captcha: 'none',
        },
      })
      await expect(tables.submitForm(table.id, {})).rejects.toBeInstanceOf(TablesError)
    })

    it('prunes form fields down to real columns', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'T' })
      const cols = await tables.updateColumns(admin, {
        tableId: table.id,
        columns: [{ name: 'Real', type: 'text', required: false, choices: [] }],
      })
      const realId = req(cols[0]).id
      const form = await tables.updateForm(admin, {
        tableId: table.id,
        form: {
          enabled: true,
          fields: [realId, 'ghost-column-id'],
          title: '',
          description: '',
          submitLabel: 'Submit',
          successMessage: 'ok',
          notify: false,
          captcha: 'none',
        },
      })
      expect(form?.fields).toEqual([realId])
    })

    it('duplicates a table with its rows but not its form', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'T' })
      const cols = await tables.updateColumns(admin, {
        tableId: table.id,
        columns: [{ name: 'X', type: 'text', required: false, choices: [] }],
      })
      const x = req(cols[0]).id
      await tables.insertRow(admin, { tableId: table.id, cells: { [x]: 'a' } })
      await tables.updateForm(admin, {
        tableId: table.id,
        form: {
          enabled: true,
          fields: [x],
          title: '',
          description: '',
          submitLabel: 'Submit',
          successMessage: 'ok',
          notify: false,
          captcha: 'none',
        },
      })
      const copy = await tables.duplicateTable(admin, table.id)
      expect(copy.name).toBe('T (copy)')
      expect(copy.form).toBeNull() // a copy never inherits the public form
      const rows = await tables.listRows(admin, copy.id)
      expect(rows).toHaveLength(1)
      expect(JSON.parse(req(rows[0]).cells)[x]).toBe('a')
    })

    it('archives a table out of the sidebar list and restores it', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'T' })

      await tables.archiveTable(admin, table.id)
      expect((await tables.listTables(admin)).find((t) => t.id === table.id)).toBeUndefined()
      const archived = await tables.listArchivedTables(admin)
      expect(archived.map((a) => a.table.id)).toContain(table.id)
      expect(archived[0]?.database.name).toBe('D')

      await tables.restoreTable(admin, table.id)
      expect((await tables.listTables(admin)).find((t) => t.id === table.id)?.id).toBe(table.id)
      expect(await tables.listArchivedTables(admin)).toHaveLength(0)
    })

    it('moves a table to another database', async () => {
      const { tables, admin } = await setup()
      const a = await tables.createDatabase(admin, { name: 'A', personal: false })
      const b = await tables.createDatabase(admin, { name: 'B', personal: false })
      const table = await tables.createTable(admin, { databaseId: a.id, name: 'T' })
      await tables.moveTable(admin, { tableId: table.id, databaseId: b.id })
      expect((await tables.getTable(admin, table.id)).databaseId).toBe(b.id)
      // and it no longer lists under the old database
      expect((await tables.listTables(admin)).find((t) => t.id === table.id)?.databaseId).toBe(b.id)
    })

    it('exports a table as CSV with headers and quoting', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'Contacts' })
      const cols = await tables.updateColumns(admin, {
        tableId: table.id,
        columns: [
          { name: 'Name', type: 'text', required: false, choices: [] },
          { name: 'Note', type: 'text', required: false, choices: [] },
        ],
      })
      const nameId = req(cols[0]).id
      const noteId = req(cols[1]).id
      await tables.insertRow(admin, {
        tableId: table.id,
        cells: { [nameId]: 'Ann', [noteId]: 'a, "b"' },
      })
      const { filename, csv } = await tables.exportTableCsv(admin, table.id)
      expect(filename).toBe('Contacts.csv')
      const lines = csv.split('\r\n')
      expect(lines[0]).toBe('Name,Note')
      // commas and quotes are escaped per RFC 4180
      expect(lines[1]).toBe('Ann,"a, ""b"""')
    })

    it('exports a whole database as a non-empty zip', async () => {
      const { tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      await tables.createTable(admin, { databaseId: database.id, name: 'One' })
      await tables.createTable(admin, { databaseId: database.id, name: 'Two' })
      const { filename, data } = await tables.exportDatabaseZip(admin, database.id)
      expect(filename).toBe('D.zip')
      expect(data.length).toBeGreaterThan(0)
      // PK zip magic
      expect(data.subarray(0, 2).toString('latin1')).toBe('PK')
    })

    it('cascades tables and rows when a database is deleted', async () => {
      const { repo, tables, admin } = await setup()
      const database = await tables.createDatabase(admin, { name: 'D', personal: false })
      const table = await tables.createTable(admin, { databaseId: database.id, name: 'T' })
      const c = req(
        (
          await tables.updateColumns(admin, {
            tableId: table.id,
            columns: [{ name: 'X', type: 'text', required: false, choices: [] }],
          })
        )[0],
      )
      await tables.insertRow(admin, { tableId: table.id, cells: { [c.id]: 'a' } })

      // deleting a single table takes its rows
      await tables.deleteTable(admin, table.id)
      expect(await repo.listDbRows(table.id)).toHaveLength(0)
      expect(await repo.getDbTable(table.id)).toBeNull()

      // deleting the database cascades to any remaining tables and their rows
      const t2 = await tables.createTable(admin, { databaseId: database.id, name: 'T2' })
      await tables.insertRow(admin, { tableId: t2.id, cells: {} })
      await tables.deleteDatabase(admin, database.id)
      expect(await repo.getDbTable(t2.id)).toBeNull()
      expect(await repo.getDbDatabase(database.id)).toBeNull()
    })
  })
}
