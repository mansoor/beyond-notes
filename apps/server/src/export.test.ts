import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createFsBlobStore } from './blobstore'
import { type AppDb, createDb } from './db'
import { exportInstance, exportSpaceZip, importInstance, importMarkdownDir } from './export'
import { createPagesService } from './pages'
import { createRemindersService } from './reminders'
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

const tmp = () => mkdtempSync(join(tmpdir(), 'bn-export-'))

for (const dialect of dialects) {
  describe(`export/import (${dialect.name})`, () => {
    async function seeded() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const pages = createPagesService(repo)
      const reminders = createRemindersService(repo)
      const blobs = createFsBlobStore(tmp())
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })

      const space = await pages.createSpace(user, {
        name: 'Wiki',
        category: 'wiki',
        personal: false,
      })
      const parent = await pages.createPage(user, {
        spaceId: space.id,
        parentId: null,
        title: 'Guide',
      })
      const child = await pages.createPage(user, {
        spaceId: space.id,
        parentId: parent.id,
        title: 'Setup',
      })
      const content = JSON.stringify([
        {
          id: 'b1',
          type: 'heading',
          props: { level: 2 },
          content: [{ type: 'text', text: 'Install', styles: {} }],
          children: [],
        },
        {
          id: 'b2',
          type: 'checkListItem',
          props: { checked: false },
          content: [{ type: 'text', text: 'download it', styles: {} }],
          children: [],
        },
      ])
      const doc = await repo.getDocument(child.id)
      await pages.saveDocument(user, {
        pageId: child.id,
        content,
        baseUpdatedAt: (doc as { updatedAt: Date }).updatedAt.toISOString(),
      })
      await reminders.create(user, {
        title: 'Renew domain',
        dueDate: '2027-01-01',
        dueTime: null,
        freq: 'yearly',
        interval: 1,
        headsUpDays: 7,
      })
      await blobs.put('deadbeef', Buffer.from('image-bytes'))
      await repo.insertAttachment({
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
      // a site newsletter: who it goes to, and what it sent
      const at = new Date('2026-10-01T10:00:00Z')
      await repo.insertSubscriber({
        id: 'sub1',
        spaceId: space.id,
        email: 'reader@x.dev',
        status: 'active',
        token: 'reader-token-0123456789abcdef',
        source: 'form',
        createdAt: at,
        confirmedAt: at,
        unsubscribedAt: null,
      })
      await repo.insertIssue({
        id: 'iss1',
        spaceId: space.id,
        pageId: child.id,
        subject: 'Setup',
        status: 'sent',
        sendAfter: at,
        cursor: 'sub1',
        recipients: 1,
        sent: 1,
        failed: 0,
        error: null,
        createdBy: user.id,
        createdAt: at,
        finishedAt: at,
      })
      return { appDb, repo, pages, blobs, user, space, parent, child }
    }

    it('full instance round-trip into a fresh database', async () => {
      const src = await seeded()
      const dir = tmp()
      const exported = await exportInstance(src.repo, src.blobs, dir)
      expect(exported.blobs).toBe(1)

      const destDb = await dialect.make()
      const destRepo = createRepo(destDb)
      const destBlobs = createFsBlobStore(tmp())
      const res = await importInstance(destRepo, destBlobs, dir)
      expect(res.users).toBe(1)

      // identity survives: same password works on the imported instance
      const destAuth = createAuthService(destRepo)
      const { user } = await destAuth.login({ email: 'm@x.dev', password: 'longpassword1' })
      expect(user.name).toBe('M')

      // tree, content, and task index survive
      const pagesRows = await destRepo.listAllPages()
      expect(pagesRows).toHaveLength(2) // Guide + Setup
      const child = pagesRows.find((p) => p.title === 'Setup')
      expect(child?.parentId).toBe(src.parent.id)
      const doc = await destRepo.getDocument(src.child.id)
      expect(doc?.content).toContain('download it')
      const tasks = await destRepo.listAllTasks()
      expect(tasks.some((t) => t.text === 'download it')).toBe(true)
      const reminders = await destRepo.listAllReminders()
      expect(reminders[0]?.title).toBe('Renew domain')

      // the newsletter list (and its unsubscribe tokens) and send history
      const subs = await destRepo.listAllSubscribers()
      expect(subs).toHaveLength(1)
      expect(subs[0]).toMatchObject({
        email: 'reader@x.dev',
        token: 'reader-token-0123456789abcdef',
      })
      expect(subs[0]?.confirmedAt).toBeInstanceOf(Date)
      expect(await destRepo.getIssue('iss1')).toMatchObject({ pageId: src.child.id, sent: 1 })

      // blobs came along
      expect(await destBlobs.exists('deadbeef')).toBe(true)
      expect((await destBlobs.read('deadbeef')).toString()).toBe('image-bytes')

      await src.appDb.close()
      await destDb.close()
    })

    it('refuses to import over existing data', async () => {
      const src = await seeded()
      const dir = tmp()
      await exportInstance(src.repo, src.blobs, dir)
      await expect(importInstance(src.repo, src.blobs, dir)).rejects.toThrow(
        'import only into a fresh database',
      )
      await src.appDb.close()
    })

    it('space zip carries the tree as markdown files plus attachments', async () => {
      const src = await seeded()
      // reference the attachment from the child page so it lands in the zip
      const doc = await src.repo.getDocument(src.child.id)
      const withImage = JSON.stringify([
        ...JSON.parse((doc as { content: string }).content),
        {
          id: 'b3',
          type: 'image',
          props: { url: '/api/files/att1234567890abcdefgh', caption: 'pic' },
          content: [],
          children: [],
        },
      ])
      await src.repo.updateDocument(src.child.id, withImage, new Date())

      const { filename, data } = await exportSpaceZip(src.repo, src.blobs, src.space.id)
      expect(filename).toBe('Wiki.zip')
      const entries = unzipSync(new Uint8Array(data))
      const names = Object.keys(entries)
      expect(names).toContain('Guide.md')
      expect(names).toContain('Guide/Setup.md')
      expect(names).toContain('_attachments/att1234567890abcdefgh-photo.jpg')
      const setup = new TextDecoder().decode(entries['Guide/Setup.md'])
      expect(setup).toContain('# Setup')
      expect(setup).toContain('- [ ] download it')
      expect(setup).toContain('![pic](_attachments/att1234567890abcdefgh-photo.jpg)')
      await src.appDb.close()
    })

    it('markdown folder import builds pages and the task index', async () => {
      const src = await seeded()
      const dir = tmp()
      writeFileSync(
        join(dir, 'Overview.md'),
        '# Overview\n\nHello **world**.\n\n- [ ] migrate notes\n',
      )
      mkdirSync(join(dir, 'Deep'))
      writeFileSync(join(dir, 'Deep', 'Nested.md'), 'Just text.\n')

      const res = await importMarkdownDir(src.repo, src.pages, src.user, dir, 'Imported')
      expect(res.pages).toBe(3) // Overview + Deep folder page + Nested

      const all = await src.repo.listPagesInSpace(res.spaceId)
      const overview = all.find((p) => p.title === 'Overview')
      const deep = all.find((p) => p.title === 'Deep')
      const nested = all.find((p) => p.title === 'Nested')
      expect(overview && deep && nested).toBeTruthy()
      expect(nested?.parentId).toBe(deep?.id)

      const doc = await src.repo.getDocument((overview as { id: string }).id)
      expect(doc?.content).toContain('world')
      const tasks = await src.repo.listTasksForPage((overview as { id: string }).id)
      expect(tasks.map((t) => t.text)).toEqual(['migrate notes'])
      await src.appDb.close()
    })
  })
}
