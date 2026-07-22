import { pageAfterRemoval, pageSubtreeIds } from '@bn/schema'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'

/** A flat tree the way `pages.tree` hands it to the sidebar. */
const node = (id: string, parentId: string | null, position: number) => ({ id, parentId, position })

//   a (0)          b (1)          c (2)
//     a1 (0)
//     a2 (1)
//       a2x (0)
const tree = [
  node('a', null, 0),
  node('a1', 'a', 0),
  node('a2', 'a', 1),
  node('a2x', 'a2', 0),
  node('b', null, 1),
  node('c', null, 2),
]

describe('pageSubtreeIds', () => {
  it('takes the page and everything under it, however deep', () => {
    expect(pageSubtreeIds(tree, 'a').sort()).toEqual(['a', 'a1', 'a2', 'a2x'])
    expect(pageSubtreeIds(tree, 'a2').sort()).toEqual(['a2', 'a2x'])
    expect(pageSubtreeIds(tree, 'b')).toEqual(['b'])
  })
})

describe('where the editor goes when the open page is deleted', () => {
  it('prefers the next sibling', () => {
    expect(pageAfterRemoval(tree, 'a')).toBe('b')
    expect(pageAfterRemoval(tree, 'a1')).toBe('a2')
  })

  it('falls back to the previous sibling when it was the last one', () => {
    expect(pageAfterRemoval(tree, 'c')).toBe('b')
    expect(pageAfterRemoval(tree, 'a2')).toBe('a1')
  })

  it('falls back to the parent when it was an only child', () => {
    expect(pageAfterRemoval(tree, 'a2x')).toBe('a2')
  })

  it('returns null when the space is left with nothing to show', () => {
    expect(pageAfterRemoval([node('solo', null, 0)], 'solo')).toBeNull()
    // an only child whose parent is going too has nowhere to land
    expect(pageAfterRemoval([node('p', null, 0), node('kid', 'p', 0)], 'p')).toBeNull()
  })

  it('never lands on a page that is going away with it', () => {
    // deleting `a` takes a1/a2/a2x — none of them may be the answer
    expect(pageSubtreeIds(tree, 'a')).not.toContain(pageAfterRemoval(tree, 'a'))
  })

  it('reads sibling order from position, not from array order', () => {
    const shuffled = [node('z', null, 2), node('x', null, 0), node('y', null, 1)]
    expect(pageAfterRemoval(shuffled, 'x')).toBe('y')
    expect(pageAfterRemoval(shuffled, 'z')).toBe('y')
  })

  it('answers null for a page that is not in the list at all', () => {
    expect(pageAfterRemoval(tree, 'nope')).toBeNull()
  })
})

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
  describe(`a trashed page stops accepting edits (${dialect.name})`, () => {
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
      return { pages, admin, space }
    }

    it('refuses the autosave a still-open editor would send', async () => {
      const { pages, admin, space } = await setup()
      const page = await pages.createPage(admin, {
        spaceId: space.id,
        parentId: null,
        title: 'Doomed',
      })

      // it saves fine while it exists
      const before = await pages.getPage(admin, page.id)
      const saved = await pages.saveDocument(admin, {
        pageId: page.id,
        content: '[{"id":"b1","type":"paragraph"}]',
        baseUpdatedAt: before.doc.updatedAt.toISOString(),
      })

      await pages.trashPage(admin, page.id)

      // the editor left open on it still holds a valid baseUpdatedAt, so
      // nothing but an explicit check stops this write
      await expect(
        pages.saveDocument(admin, {
          pageId: page.id,
          content: '[{"id":"b1","type":"paragraph"},{"id":"ghost","type":"paragraph"}]',
          baseUpdatedAt: saved.updatedAt,
        }),
      ).rejects.toThrow(/Trash/)

      // and the write did not land — restoring must not resurrect a ghost edit
      const after = await pages.getPage(admin, page.id)
      expect(after.doc.content).not.toContain('ghost')
    })

    it('refuses too when the page went as part of a parent subtree', async () => {
      const { pages, admin, space } = await setup()
      const parent = await pages.createPage(admin, {
        spaceId: space.id,
        parentId: null,
        title: 'Parent',
      })
      const child = await pages.createPage(admin, {
        spaceId: space.id,
        parentId: parent.id,
        title: 'Child',
      })
      const before = await pages.getPage(admin, child.id)

      await pages.trashPage(admin, parent.id)

      await expect(
        pages.saveDocument(admin, {
          pageId: child.id,
          content: '[{"id":"b1","type":"paragraph"}]',
          baseUpdatedAt: before.doc.updatedAt.toISOString(),
        }),
      ).rejects.toThrow(/Trash/)
    })

    it('an archived page is only hidden, so it still saves', async () => {
      const { pages, admin, space } = await setup()
      const page = await pages.createPage(admin, {
        spaceId: space.id,
        parentId: null,
        title: 'Filed away',
      })
      const before = await pages.getPage(admin, page.id)

      await pages.archivePage(admin, page.id)

      const saved = await pages.saveDocument(admin, {
        pageId: page.id,
        content: '[{"id":"b1","type":"paragraph"}]',
        baseUpdatedAt: before.doc.updatedAt.toISOString(),
      })
      expect(saved.updatedAt).toBeTruthy()
    })
  })
}
