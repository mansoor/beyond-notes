import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { PagesError, createPagesService } from './pages'
import { createRepo } from './repo'
import type { UserRow } from './repo'

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
  describe(`pages service (${dialect.name})`, () => {
    async function setup() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      // ticking clock: every now() call advances 10ms, so timestamp-based
      // optimistic locking is deterministic even on a fast machine
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
      const invite = await auth.createInvite(admin.id, { role: 'member' })
      const { user: member } = await auth.acceptInvite({
        token: invite.token,
        name: 'P',
        email: 'p@x.dev',
        password: 'longpassword2',
      })
      return { appDb, repo, pages, admin, member }
    }

    async function makeTree(pages: ReturnType<typeof createPagesService>, user: UserRow) {
      const space = await pages.createSpace(user, {
        name: 'Notes',
        category: 'notebook',
        personal: false,
      })
      const a = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'A' })
      const b = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'B' })
      const a1 = await pages.createPage(user, { spaceId: space.id, parentId: a.id, title: 'A1' })
      const a1x = await pages.createPage(user, { spaceId: space.id, parentId: a1.id, title: 'A1X' })
      return { space, a, b, a1, a1x }
    }

    it('creates spaces and nested pages with sibling ordering', async () => {
      const { appDb, pages, admin } = await setup()
      const { space, a, b, a1 } = await makeTree(pages, admin)

      const tree = await pages.tree(admin, space.id)
      expect(tree).toHaveLength(4)
      const roots = tree.filter((p) => p.parentId === null)
      expect(roots.map((p) => p.title)).toEqual(['A', 'B'])
      expect(roots.map((p) => p.position)).toEqual([0, 1])
      expect(tree.find((p) => p.id === a1.id)?.parentId).toBe(a.id)

      // every page gets a working document
      const { doc } = await pages.getPage(admin, b.id)
      expect(doc.content).toBe('[]')
      await appDb.close()
    })

    it('personal spaces are invisible to other members', async () => {
      const { appDb, pages, admin, member } = await setup()
      const personal = await pages.createSpace(admin, {
        name: 'Private',
        category: 'notebook',
        personal: true,
      })
      const page = await pages.createPage(admin, {
        spaceId: personal.id,
        parentId: null,
        title: 'Secret',
      })

      expect((await pages.listSpaces(member)).map((s) => s.name)).not.toContain('Private')
      await expect(pages.tree(member, personal.id)).rejects.toThrow('Space not found')
      await expect(pages.getPage(member, page.id)).rejects.toThrow('Space not found')
      // shared spaces are visible to everyone
      const shared = await pages.createSpace(admin, {
        name: 'Shared',
        category: 'wiki',
        personal: false,
      })
      expect((await pages.listSpaces(member)).map((s) => s.id)).toContain(shared.id)
      await appDb.close()
    })

    it('move reparents, reorders, and compacts old siblings', async () => {
      const { appDb, pages, admin } = await setup()
      const { space, a, b, a1 } = await makeTree(pages, admin)

      // move A1 to root, before A
      await pages.movePage(admin, { pageId: a1.id, parentId: null, index: 0 })
      let tree = await pages.tree(admin, space.id)
      const roots = tree.filter((p) => p.parentId === null).sort((x, y) => x.position - y.position)
      expect(roots.map((p) => p.title)).toEqual(['A1', 'A', 'B'])

      // reorder within root: move B to index 0
      await pages.movePage(admin, { pageId: b.id, parentId: null, index: 0 })
      tree = await pages.tree(admin, space.id)
      const roots2 = tree.filter((p) => p.parentId === null).sort((x, y) => x.position - y.position)
      expect(roots2.map((p) => p.title)).toEqual(['B', 'A1', 'A'])
      expect(roots2.map((p) => p.position)).toEqual([0, 1, 2])
      await appDb.close()
    })

    it('rejects cyclic moves', async () => {
      const { appDb, pages, admin } = await setup()
      const { a, a1, a1x } = await makeTree(pages, admin)

      await expect(
        pages.movePage(admin, { pageId: a.id, parentId: a.id, index: 0 }),
      ).rejects.toThrow('into itself')
      await expect(
        pages.movePage(admin, { pageId: a.id, parentId: a1x.id, index: 0 }),
      ).rejects.toThrow('own subpage')
      await expect(
        pages.movePage(admin, { pageId: a.id, parentId: a1.id, index: 0 }),
      ).rejects.toThrow('own subpage')
      await appDb.close()
    })

    it('delete cascades to the whole subtree and its documents', async () => {
      const { appDb, repo, pages, admin } = await setup()
      const { space, a, b, a1, a1x } = await makeTree(pages, admin)

      await pages.deletePage(admin, a.id)
      const tree = await pages.tree(admin, space.id)
      expect(tree.map((p) => p.id)).toEqual([b.id])
      expect(await repo.getDocument(a1.id)).toBeNull()
      expect(await repo.getDocument(a1x.id)).toBeNull()
      await appDb.close()
    })

    it('page types follow the section: wiki docs-only, notebook no blog, site anything', async () => {
      const { appDb, pages, admin } = await setup()
      const mk = async (category: 'wiki' | 'notebook' | 'site') => {
        const space = await pages.createSpace(admin, { name: category, category, personal: false })
        return pages.createPage(admin, { spaceId: space.id, parentId: null, title: 'p' })
      }
      const wikiPage = await mk('wiki')
      const notePage = await mk('notebook')
      const sitePage = await mk('site')

      await expect(pages.setPageType(admin, wikiPage.id, 'blog')).rejects.toThrow('cannot contain')
      await expect(pages.setPageType(admin, wikiPage.id, 'gallery')).rejects.toThrow(
        'cannot contain',
      )
      await expect(pages.setPageType(admin, notePage.id, 'blog')).rejects.toThrow('cannot contain')
      await pages.setPageType(admin, notePage.id, 'gallery')
      await pages.setPageType(admin, sitePage.id, 'blog')
      await pages.setPageType(admin, sitePage.id, 'gallery')
      // the way back to a plain page is always open
      await pages.setPageType(admin, notePage.id, 'doc')
      await appDb.close()
    })

    it('saveDocument enforces the optimistic lock', async () => {
      const { appDb, pages, admin } = await setup()
      const { a } = await makeTree(pages, admin)
      const { doc } = await pages.getPage(admin, a.id)

      const first = await pages.saveDocument(admin, {
        pageId: a.id,
        content: '[{"type":"paragraph"}]',
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })

      // stale base → conflict
      await expect(
        pages.saveDocument(admin, {
          pageId: a.id,
          content: '[{"type":"paragraph","stale":true}]',
          baseUpdatedAt: doc.updatedAt.toISOString(),
        }),
      ).rejects.toThrow('another window')

      // fresh base → accepted
      const second = await pages.saveDocument(admin, {
        pageId: a.id,
        content: '[{"type":"heading"}]',
        baseUpdatedAt: first.updatedAt,
      })
      expect(second.updatedAt).not.toBe(first.updatedAt)

      // invalid JSON rejected
      await expect(
        pages.saveDocument(admin, {
          pageId: a.id,
          content: 'not json',
          baseUpdatedAt: second.updatedAt,
        }),
      ).rejects.toThrow(PagesError)
      await appDb.close()
    })

    it('deleting a space takes its pages and documents with it', async () => {
      const { appDb, repo, pages, admin } = await setup()
      const { space, a } = await makeTree(pages, admin)
      const other = await pages.createSpace(admin, {
        name: 'Keep me',
        category: 'notebook',
        personal: false,
      })
      const keeper = await pages.createPage(admin, {
        spaceId: other.id,
        parentId: null,
        title: 'Untouched',
      })
      expect(await repo.getDocument(a.id)).not.toBeNull()

      await pages.deleteSpace(admin, space.id)

      // the space, its whole tree, and the documents underneath are gone —
      // no orphan rows left behind by a missing cascade
      expect(await repo.getSpace(space.id)).toBeNull()
      expect(await repo.listPagesInSpace(space.id)).toHaveLength(0)
      expect(await repo.getPage(a.id)).toBeNull()
      expect(await repo.getDocument(a.id)).toBeNull()

      // and nothing else moved
      expect(await repo.getPage(keeper.id)).not.toBeNull()
      expect((await repo.listSpaces()).map((s) => s.id)).toContain(other.id)
      await appDb.close()
    })

    it("refuses to delete someone else's personal space", async () => {
      const { appDb, pages, admin, member } = await setup()
      const mine = await pages.createSpace(admin, {
        name: 'Private',
        category: 'notebook',
        personal: true,
      })
      await expect(pages.deleteSpace(member, mine.id)).rejects.toThrow(PagesError)
      await appDb.close()
    })
  })
}
