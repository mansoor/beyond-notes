import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pgTables, sqliteTables } from '@bn/schema'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

export type Dialect = 'pg' | 'sqlite'

// The logical table shape is identical across dialects; the concrete drizzle
// types differ, so the shared data layer is typed at its public boundary
// (repo.ts) rather than here.
export type Tables = typeof pgTables | typeof sqliteTables

export interface AppDb {
  dialect: Dialect
  db: any
  tables: Tables
  migrate(migrationsDir: string): Promise<void>
  close(): Promise<void>
}

export function createDb(databaseUrl: string): AppDb {
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    const client = postgres(databaseUrl, { max: 10, onnotice: () => {} })
    const db = drizzlePg(client)
    return {
      dialect: 'pg',
      db,
      tables: pgTables,
      migrate: async (dir) => {
        await migratePg(db, { migrationsFolder: join(dir, 'pg') })
      },
      close: async () => {
        await client.end()
      },
    }
  }

  const file = databaseUrl.replace(/^file:/, '')
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzleSqlite(sqlite)
  return {
    dialect: 'sqlite',
    db,
    tables: sqliteTables,
    migrate: async (dir) => {
      migrateSqlite(db, { migrationsFolder: join(dir, 'sqlite') })
    },
    close: async () => {
      sqlite.close()
    },
  }
}
