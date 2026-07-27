import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createFsBlobStore } from './blobstore'
import { createDailyService } from './daily'
import { type AppDb, createDb } from './db'
import { buildInstanceArchive } from './export'
import { createPagesService } from './pages'
import { createRepo } from './repo'
import { createRestoreService } from './restore'

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

const tmp = () => mkdtempSync(join(tmpdir(), 'bn-restore-'))

// a document with one checklist item, so the task index has something to rebuild
const checklistDoc = (text: string) =>
  JSON.stringify([
    {
      id: `b-${text.replace(/\s/g, '')}`,
      type: 'checkListItem',
      props: { checked: false },
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    },
  ])

for (const dialect of dialects) {
  describe(`restore (${dialect.name})`, () => {
    async function instance() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const pages = createPagesService(repo)
      const daily = createDailyService(repo)
      const blobs = createFsBlobStore(tmp())
      return { appDb, repo, auth, pages, daily, blobs }
    }

    // A source instance with: a Wiki tree space (Guide > Setup with a task + an
    // attachment), a journal day, and an inbox memo. Returns its backup archive.
    async function seededArchive() {
      const src = await instance()
      const { user } = await src.auth.setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      const space = await src.pages.createSpace(user, {
        name: 'Wiki',
        category: 'wiki',
        personal: false,
      })
      const parent = await src.pages.createPage(user, {
        spaceId: space.id,
        parentId: null,
        title: 'Guide',
      })
      const child = await src.pages.createPage(user, {
        spaceId: space.id,
        parentId: parent.id,
        title: 'Setup',
      })
      const doc = await src.repo.getDocument(child.id)
      const withImage = JSON.stringify([
        ...JSON.parse(checklistDoc('download it')),
        {
          id: 'img',
          type: 'image',
          props: { url: '/api/files/att1234567890abcdefgh', caption: 'pic' },
          content: [],
          children: [],
        },
      ])
      await src.pages.saveDocument(user, {
        pageId: child.id,
        content: withImage,
        baseUpdatedAt: (doc as { updatedAt: Date }).updatedAt.toISOString(),
      })
      await src.blobs.put('deadbeef', Buffer.from('image-bytes'))
      await src.repo.insertAttachment({
        id: 'att1234567890abcdefgh',
        hash: 'deadbeef',
        filename: 'photo.jpg',
        mime: 'image/jpeg',
        size: 11,
        width: 10,
        height: 10,
        createdBy: user.id,
        createdAt: new Date(),
      })

      // a journal day with its own task
      const day = await src.daily.day(user, '2026-07-20')
      await src.pages.saveDocument(user, {
        pageId: day.page.id,
        content: checklistDoc('call the bank'),
        baseUpdatedAt: day.doc.updatedAt.toISOString(),
      })
      // an inbox memo
      const memo = await src.daily.capture(user, 'remember the milk')

      const zip = await buildInstanceArchive(src.repo, src.blobs)
      const dir = tmp()
      const path = join(dir, 'beyond-notes-backup-2026-07-26T03-00-00-000Z.zip')
      writeFileSync(path, Buffer.from(zip))
      await src.appDb.close()
      return { path, spaceId: space.id, childId: child.id, memoId: memo.id, userEmail: 'm@x.dev' }
    }

    // wire a restore service straight at a file path (bypassing backup.resolve —
    // that guard has its own tests)
    function restoreFor(dest: Awaited<ReturnType<typeof instance>>, path: string) {
      return createRestoreService({
        repo: dest.repo,
        blobs: dest.blobs,
        resolvePath: (name) => (name === 'backup.zip' ? path : null),
      })
    }

    it('restores a tree space, its content, task index and attachment', async () => {
      const { path, spaceId, childId } = await seededArchive()
      const dest = await instance()
      // the dest is its own instance with the same user (same-instance recovery)
      await dest.auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const restore = restoreFor(dest, path)

      const res = await restore.run({
        name: 'backup.zip',
        spaces: [{ id: spaceId, overwrite: false }],
        journal: false,
        inbox: false,
      })
      expect(res.spacesRestored).toBe(1)
      expect(res.pagesRestored).toBe(2)
      expect(res.warnings).toEqual([])

      const restored = await dest.repo.getSpace(spaceId)
      expect(restored?.name).toBe('Wiki')
      const doc = await dest.repo.getDocument(childId)
      expect(doc?.content).toContain('download it')
      const tasks = await dest.repo.listAllTasks()
      expect(tasks.some((t) => t.text === 'download it')).toBe(true)
      expect(await dest.blobs.exists('deadbeef')).toBe(true)
      await dest.appDb.close()
    })

    it('overwrite replaces a clashing same-named space; skip leaves it', async () => {
      const { path, spaceId } = await seededArchive()

      // dest already has a *different* space also called "Wiki"
      const dest = await instance()
      const { user } = await dest.auth.setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      const existing = await dest.pages.createSpace(user, {
        name: 'Wiki',
        category: 'wiki',
        personal: false,
      })
      await dest.pages.createPage(user, { spaceId: existing.id, parentId: null, title: 'Old page' })
      const restore = restoreFor(dest, path)

      // skip: nothing changes
      const skip = await restore.run({
        name: 'backup.zip',
        spaces: [{ id: spaceId, overwrite: false }],
        journal: false,
        inbox: false,
      })
      expect(skip.spacesSkipped).toBe(1)
      expect(skip.spacesRestored).toBe(0)
      expect(
        (await dest.repo.listPagesInSpace(existing.id)).some((p) => p.title === 'Old page'),
      ).toBe(true)

      // overwrite: the old space is gone, the backup's is in
      const over = await restore.run({
        name: 'backup.zip',
        spaces: [{ id: spaceId, overwrite: true }],
        journal: false,
        inbox: false,
      })
      expect(over.spacesRestored).toBe(1)
      expect(await dest.repo.getSpace(existing.id)).toBeNull() // old id deleted
      const wiki = await dest.repo.getSpace(spaceId)
      expect(wiki?.name).toBe('Wiki')
      const titles = (await dest.repo.listPagesInSpace(spaceId)).map((p) => p.title)
      expect(titles.sort()).toEqual(['Guide', 'Setup'])
      await dest.appDb.close()
    })

    it('journal merge adds missing days and never touches an existing day', async () => {
      const { path } = await seededArchive()
      const dest = await instance()
      const { user } = await dest.auth.setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      // dest already journalled 2026-07-20 with its OWN content
      const existingDay = await dest.daily.day(user, '2026-07-20')
      await dest.pages.saveDocument(user, {
        pageId: existingDay.page.id,
        content: checklistDoc('keep me'),
        baseUpdatedAt: existingDay.doc.updatedAt.toISOString(),
      })
      const restore = restoreFor(dest, path)

      const res = await restore.run({
        name: 'backup.zip',
        spaces: [],
        journal: true,
        inbox: false,
      })
      // the backup's 2026-07-20 is skipped (day already present), so no new page
      expect(res.journalPagesRestored).toBe(0)
      const journal = await dest.repo.getSpaceByOwnerAndKind(user.id, 'journal')
      const days = await dest.repo.listPagesInSpace((journal as { id: string }).id)
      // exactly one page for that date — no duplicate
      expect(days.filter((p) => p.dateKey === '2026-07-20')).toHaveLength(1)
      const doc = await dest.repo.getDocument(existingDay.page.id)
      expect(doc?.content).toContain('keep me') // existing day untouched
      await dest.appDb.close()
    })

    it('inbox merge inserts memos by id', async () => {
      const { path, memoId } = await seededArchive()
      const dest = await instance()
      await dest.auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const restore = restoreFor(dest, path)

      const res = await restore.run({
        name: 'backup.zip',
        spaces: [],
        journal: false,
        inbox: true,
      })
      expect(res.memosRestored).toBe(1)
      const memos = await dest.repo.listAllMemos()
      expect(memos.map((m) => m.id)).toContain(memoId)
      expect(memos[0]?.content).toBe('remember the milk')

      // a second restore is idempotent — the memo id is already present
      const again = await restore.run({
        name: 'backup.zip',
        spaces: [],
        journal: false,
        inbox: true,
      })
      expect(again.memosRestored).toBe(0)
      await dest.appDb.close()
    })

    it('plan reports contents and flags a name clash', async () => {
      const { path, spaceId } = await seededArchive()
      const dest = await instance()
      const { user } = await dest.auth.setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      await dest.pages.createSpace(user, { name: 'Wiki', category: 'wiki', personal: false })
      const restore = restoreFor(dest, path)

      const plan = await restore.plan('backup.zip')
      expect(plan.compatible).toBe(true)
      expect(plan.spaces).toHaveLength(1)
      expect(plan.spaces[0]?.id).toBe(spaceId)
      expect(plan.spaces[0]?.pageCount).toBe(2)
      expect(plan.spaces[0]?.conflict).toBe(true) // same name already live
      expect(plan.journalPageCount).toBeGreaterThanOrEqual(1)
      expect(plan.inboxCount).toBe(1)
      await dest.appDb.close()
    })

    it('a missing/unsafe backup name is rejected', async () => {
      const dest = await instance()
      await dest.auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const restore = restoreFor(dest, '/nope')
      await expect(restore.plan('../../etc/passwd')).rejects.toThrow('backup not found')
      await dest.appDb.close()
    })
  })
}
