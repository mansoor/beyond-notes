import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'

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

for (const dialect of dialects) {
  describe(`where a new page lands (${dialect.name})`, () => {
    async function setup() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      let tick = 1_700_000_000_000
      const pages = createPagesService(repo, {
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
      const space = await pages.createSpace(admin, {
        name: 'Notes',
        category: 'notebook',
        personal: false,
      })
      const add = (title: string, parentId: string | null = null, afterPageId?: string) =>
        pages.createPage(admin, { spaceId: space.id, parentId, title, afterPageId })
      /** titles in the order the sidebar would draw them */
      const order = async (parentId: string | null = null) =>
        (await pages.tree(admin, space.id))
          .filter((p) => p.parentId === parentId)
          .sort((a, b) => a.position - b.position)
          .map((p) => p.title)
      return { pages, admin, space, add, order, repo }
    }

    it('appends when nothing says otherwise — the notebook-level +', async () => {
      const { add, order } = await setup()
      await add('A')
      await add('B')
      await add('C')
      expect(await order()).toEqual(['A', 'B', 'C'])
    })

    it('drops a sibling directly below the page you asked from', async () => {
      const { add, order } = await setup()
      const a = await add('A')
      await add('B')
      await add('C')

      await add('A2', null, a.id)
      expect(await order()).toEqual(['A', 'A2', 'B', 'C'])
    })

    it('adding a sibling from the last page still lands at the end', async () => {
      const { add, order } = await setup()
      await add('A')
      const b = await add('B')
      await add('B2', null, b.id)
      expect(await order()).toEqual(['A', 'B', 'B2'])
    })

    it('leaves no duplicate or skipped positions behind', async () => {
      const { add, pages, admin, space } = await setup()
      const a = await add('A')
      await add('B')
      await add('C')
      await add('A2', null, a.id)
      await add('A3', null, a.id)

      const roots = (await pages.tree(admin, space.id))
        .filter((p) => p.parentId === null)
        .sort((x, y) => x.position - y.position)
      expect(roots.map((p) => p.title)).toEqual(['A', 'A3', 'A2', 'B', 'C'])
      expect(roots.map((p) => p.position)).toEqual([0, 1, 2, 3, 4])
    })

    it('inserts among children, not among roots', async () => {
      const { add, order } = await setup()
      const parent = await add('Parent')
      const x = await add('X', parent.id)
      await add('Y', parent.id)

      await add('X2', parent.id, x.id)
      expect(await order(parent.id)).toEqual(['X', 'X2', 'Y'])
      // the root group is untouched
      expect(await order(null)).toEqual(['Parent'])
    })

    it('counts hidden siblings when placing, so restoring one cannot collide', async () => {
      const { add, order, pages, admin, space, repo } = await setup()
      const a = await add('A')
      const b = await add('B')
      await add('C')
      await pages.archivePage(admin, b.id) // still occupies position 1

      await add('A2', null, a.id)

      // the archived page keeps a position of its own, distinct from everyone
      const all = (await repo.listPagesInSpace(space.id))
        .filter((p) => p.parentId === null)
        .sort((x, y) => x.position - y.position)
      expect(all.map((p) => p.position)).toEqual([0, 1, 2, 3])
      expect(new Set(all.map((p) => p.position)).size).toBe(4)
      expect(await order()).toEqual(['A', 'A2', 'C'])

      await pages.restorePage(admin, b.id)
      expect(await order()).toEqual(['A', 'A2', 'B', 'C'])
    })

    it('falls back to appending when the sibling it names is gone', async () => {
      const { add, order } = await setup()
      await add('A')
      await add('B')
      // a stale sidebar naming a page that no longer exists must still create
      // the page rather than fail the click
      await add('C', null, 'no-such-page')
      expect(await order()).toEqual(['A', 'B', 'C'])
    })
  })
}
