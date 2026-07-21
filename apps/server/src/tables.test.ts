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
      const table = await tables.createTable(admin, { name: 'Contacts', personal: false })
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
      const table = await tables.createTable(admin, { name: 'T', personal: false })
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

    it('hides a personal table from other members', async () => {
      const { tables, admin, member } = await setup()
      const personal = await tables.createTable(admin, { name: 'Private', personal: true })
      const household = await tables.createTable(admin, { name: 'Shared', personal: false })

      const memberList = await tables.listTables(member)
      expect(memberList.map((t) => t.id)).toContain(household.id)
      expect(memberList.map((t) => t.id)).not.toContain(personal.id)

      await expect(tables.getTable(member, personal.id)).rejects.toBeInstanceOf(TablesError)
    })

    it('rejects a row whose value fails its column type', async () => {
      const { tables, admin } = await setup()
      const table = await tables.createTable(admin, { name: 'T', personal: false })
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

    it('cascades rows when a table is deleted', async () => {
      const { repo, tables, admin } = await setup()
      const table = await tables.createTable(admin, { name: 'T', personal: false })
      const c = req(
        (
          await tables.updateColumns(admin, {
            tableId: table.id,
            columns: [{ name: 'X', type: 'text', required: false, choices: [] }],
          })
        )[0],
      )
      await tables.insertRow(admin, { tableId: table.id, cells: { [c.id]: 'a' } })
      await tables.deleteTable(admin, table.id)
      expect(await repo.listDbRows(table.id)).toHaveLength(0)
      expect(await repo.getDbTable(table.id)).toBeNull()
    })
  })
}
