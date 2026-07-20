import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AuthError, createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'
import { createTasksService } from './tasks'

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

const CHECK_DOC = JSON.stringify([
  {
    id: 'blk1',
    type: 'checkListItem',
    props: { checked: false },
    content: [{ type: 'text', text: 'a task', styles: {} }],
    children: [],
  },
])

for (const dialect of dialects) {
  describe(`archive (${dialect.name})`, () => {
    async function setup() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const pages = createPagesService(repo)
      const tasks = createTasksService(repo)
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const space = await pages.createSpace(user, {
        name: 'Notes',
        category: 'notebook',
        personal: false,
      })
      const parent = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'P' })
      const child = await pages.createPage(user, {
        spaceId: space.id,
        parentId: parent.id,
        title: 'C',
      })
      return { appDb, repo, auth, pages, tasks, user, space, parent, child }
    }

    it('archives the subtree, hides it from tree/search/agenda, and lists who archived', async () => {
      const { appDb, repo, pages, tasks, user, space, parent, child } = await setup()
      const doc = await repo.getDocument(child.id)
      await pages.saveDocument(user, {
        pageId: child.id,
        content: CHECK_DOC,
        baseUpdatedAt: (doc as { updatedAt: Date }).updatedAt.toISOString(),
      })
      expect((await tasks.agenda(user)).length).toBe(1)

      await pages.archivePage(user, parent.id)

      expect(await pages.tree(user, space.id)).toHaveLength(0)
      expect((await tasks.agenda(user)).length).toBe(0)
      expect((await repo.searchPages('%a task%')).length).toBe(0)

      // only the archive root is listed, stamped with archiver + time
      const archived = await pages.listArchived(user)
      expect(archived).toHaveLength(1)
      expect(archived[0]?.page.id).toBe(parent.id)
      expect(archived[0]?.page.archivedBy).toBe(user.id)
      expect(archived[0]?.page.archivedAt).toBeInstanceOf(Date)

      // ...but the whole subtree carries the flag
      const childRow = await repo.getPage(child.id)
      expect(childRow?.archivedAt).not.toBeNull()
      await appDb.close()
    })

    it('restore puts the subtree back exactly where it was', async () => {
      const { appDb, repo, pages, user, space, parent, child } = await setup()
      await pages.archivePage(user, parent.id)
      await pages.restorePage(user, parent.id)

      const tree = await pages.tree(user, space.id)
      expect(tree).toHaveLength(2)
      const restoredChild = await repo.getPage(child.id)
      expect(restoredChild?.parentId).toBe(parent.id)
      expect(restoredChild?.archivedAt).toBeNull()
      expect(await pages.listArchived(user)).toHaveLength(0)
      await appDb.close()
    })

    it('restoring a child whose parent is still archived surfaces it at the root', async () => {
      const { appDb, repo, pages, user, space, parent, child } = await setup()
      // archive child on its own, then the parent
      await pages.archivePage(user, child.id)
      await pages.archivePage(user, parent.id)

      await pages.restorePage(user, child.id)

      const restored = await repo.getPage(child.id)
      expect(restored?.archivedAt).toBeNull()
      expect(restored?.parentId).toBeNull() // moved to root, not invisible
      const tree = await pages.tree(user, space.id)
      expect(tree.map((p) => p.title)).toEqual(['C'])
      await appDb.close()
    })

    it('archived pages in personal spaces stay invisible to other users', async () => {
      const { appDb, repo, auth, pages, user } = await setup()
      const personal = await pages.createSpace(user, {
        name: 'Mine',
        category: 'notebook',
        personal: true,
      })
      const secret = await pages.createPage(user, {
        spaceId: personal.id,
        parentId: null,
        title: 'Secret',
      })
      await pages.archivePage(user, secret.id)

      const invite = await auth.createInvite(user.id, { role: 'member' })
      const { user: other } = await auth.acceptInvite({
        token: invite.token,
        name: 'O',
        email: 'o@x.dev',
        password: 'longpassword2',
      })
      const otherView = await pages.listArchived(other)
      expect(otherView.find((i) => i.page.id === secret.id)).toBeUndefined()
      expect(await repo.getPage(secret.id)).not.toBeNull()
      await appDb.close()
    })
  })

  describe(`profile update (${dialect.name})`, () => {
    it('updates name and email; refuses an email already in use', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const invite = await auth.createInvite(user.id, { role: 'member' })
      await auth.acceptInvite({
        token: invite.token,
        name: 'O',
        email: 'o@x.dev',
        password: 'longpassword2',
      })

      await auth.updateProfile(user, { name: 'Mansoor', email: 'mansoor@x.dev' })
      const fresh = await repo.getUserById(user.id)
      expect(fresh?.name).toBe('Mansoor')
      expect(fresh?.email).toBe('mansoor@x.dev')
      // login follows the email
      const { user: again } = await auth.login({
        email: 'mansoor@x.dev',
        password: 'longpassword1',
      })
      expect(again.id).toBe(user.id)

      await expect(
        auth.updateProfile(again, { name: 'Mansoor', email: 'o@x.dev' }),
      ).rejects.toThrow(AuthError)
      await appDb.close()
    })
  })
}
