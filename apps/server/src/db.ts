import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

/** What migrate() may do first: keep a copy of the database it's about to change. */
export type MigrateOptions = {
  /** folder for a pre-upgrade copy; unset = no copy */
  snapshotDir?: string
  log?: (msg: string) => void
}

export interface AppDb {
  dialect: Dialect
  db: any
  tables: Tables
  migrate(migrationsDir: string, opts?: MigrateOptions): Promise<void>
  close(): Promise<void>
}

/** How many migrations ship with this build (drizzle's journal). */
function shippedMigrations(dir: string): number {
  try {
    const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8'))
    return Array.isArray(journal.entries) ? journal.entries.length : 0
  } catch {
    return 0
  }
}

const KEEP_SNAPSHOTS = 3

export function createDb(databaseUrl: string): AppDb {
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    const client = postgres(databaseUrl, { max: 10, onnotice: () => {} })
    const db = drizzlePg(client)
    return {
      dialect: 'pg',
      db,
      tables: pgTables,
      migrate: async (dir, opts = {}) => {
        // pg_dump isn't something the app can run for you: say so loudly
        // before an upgrade changes the schema
        try {
          const rows = await client`select count(*)::int as n from drizzle.__drizzle_migrations`
          const pending = shippedMigrations(join(dir, 'pg')) - Number(rows[0]?.n ?? 0)
          if (pending > 0) {
            opts.log?.(
              `Applying ${pending} database migration(s). Take a pg_dump first if you have not: this upgrade changes the schema.`,
            )
          }
        } catch {
          // a brand-new database has no migrations table yet
        }
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
    migrate: async (dir, opts = {}) => {
      // Before an upgrade changes the schema, keep an exact copy of the
      // database (VACUUM INTO: consistent, fast, and nothing to install). A
      // bad upgrade is then a file copy away from undone.
      if (opts.snapshotDir && file !== ':memory:') {
        let applied = -1
        try {
          const row = sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as {
            n: number
          }
          applied = row.n
        } catch {
          // no migrations table: a brand-new database, nothing to protect
        }
        const pending = shippedMigrations(join(dir, 'sqlite')) - applied
        if (applied > 0 && pending > 0) {
          mkdirSync(opts.snapshotDir, { recursive: true })
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const target = join(opts.snapshotDir, `pre-upgrade-${stamp}.db`)
          sqlite.prepare('VACUUM INTO ?').run(target)
          opts.log?.(`Applying ${pending} database migration(s); saved a copy first: ${target}`)
          const old = readdirSync(opts.snapshotDir)
            .filter((f) => f.startsWith('pre-upgrade-') && f.endsWith('.db'))
            .sort()
          for (const f of old.slice(0, Math.max(0, old.length - KEEP_SNAPSHOTS))) {
            rmSync(join(opts.snapshotDir, f), { force: true })
          }
        }
      }
      migrateSqlite(db, { migrationsFolder: join(dir, 'sqlite') })
    },
    close: async () => {
      sqlite.close()
    },
  }
}
