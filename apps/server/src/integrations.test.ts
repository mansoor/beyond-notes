import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDbBlobStore } from './blobstore-db'
import { createDynamicBlobStore } from './blobstore-dynamic'
import { loadConfig } from './config'
import { createDailyService } from './daily'
import { type AppDb, createDb } from './db'
import { createDynamicMailer } from './mailer'
import { createRepo } from './repo'
import { createSettingsService } from './settings'
import { createTasksService } from './tasks'
import { createWebhooksService } from './webhooks'

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
  describe(`server settings (${dialect.name})`, () => {
    it('DB settings beat env; blank secret keeps the stored one; view masks secrets', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const config = loadConfig({
        SMTP_HOST: 'env.example.com',
        MAIL_FROM: 'env@example.com',
        DATABASE_URL: 'unused',
      } as never)
      const settings = createSettingsService(repo, config)
      await settings.load()

      // nothing in DB yet: env wins
      expect(settings.effectiveSmtp()?.host).toBe('env.example.com')
      expect(settings.effectiveSmtp()?.source).toBe('env')

      await settings.saveSmtp({
        host: 'db.example.com',
        port: 465,
        secure: true,
        user: 'u',
        pass: 'topsecret',
        from: 'db@example.com',
      })
      expect(settings.effectiveSmtp()?.host).toBe('db.example.com')
      expect(settings.effectiveSmtp()?.source).toBe('db')

      // blank password on re-save keeps the stored secret
      await settings.saveSmtp({
        host: 'db.example.com',
        port: 465,
        secure: true,
        user: 'u',
        pass: '',
        from: 'db@example.com',
      })
      expect(settings.effectiveSmtp()?.pass).toBe('topsecret')

      const view = settings.view()
      expect(JSON.stringify(view)).not.toContain('topsecret')
      expect(view.smtp.hasPass).toBe(true)
      expect(view.mailSource).toBe('db')

      // a fresh service instance reads the persisted rows
      const again = createSettingsService(repo, config)
      await again.load()
      expect(again.effectiveSmtp()?.host).toBe('db.example.com')
      await appDb.close()
    })

    it('the dynamic mailer follows settings changes without restart', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const config = loadConfig({ DATABASE_URL: 'unused' } as never)
      const settings = createSettingsService(repo, config)
      await settings.load()
      const logs: string[] = []
      const mailer = createDynamicMailer(settings, (m) => logs.push(m))

      expect(mailer.configured).toBe(false)
      await mailer.send('a@b.c', 'hi', 'body') // falls back to log, no throw
      expect(logs[0]).toContain('no SMTP configured')

      await settings.saveSmtp({
        host: 'mail.example.com',
        port: 587,
        secure: false,
        user: '',
        pass: '',
        from: 'n@example.com',
      })
      expect(mailer.configured).toBe(true)
      await appDb.close()
    })
  })

  describe(`storage drivers (${dialect.name})`, () => {
    it('db blob store round-trips; dynamic store switches and reads across drivers', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const uploads = mkdtempSync(join(tmpdir(), 'bn-dyn-'))
      const config = loadConfig({ DATABASE_URL: 'unused', UPLOADS_DIR: uploads } as never)
      const settings = createSettingsService(repo, config)
      await settings.load()
      const store = createDynamicBlobStore(settings, config, repo)

      // default: fs
      expect(store.activeDriver()).toBe('fs')
      await store.put('aakey1', Buffer.from('on disk'))

      // switch to database storage — new writes land in the blobs table
      await settings.saveStorage({
        driver: 'db',
        s3Bucket: '',
        s3Endpoint: '',
        s3Region: 'us-east-1',
        s3AccessKey: '',
        s3SecretKey: '',
        s3ForcePathStyle: true,
      })
      expect(store.activeDriver()).toBe('db')
      await store.put('bbkey2', Buffer.from('in the database'))

      const dbStore = createDbBlobStore(repo)
      expect((await dbStore.read('bbkey2')).toString()).toBe('in the database')
      expect(await dbStore.exists('aakey1')).toBe(false) // old blob stayed on disk

      // ...but the dynamic store reads across drivers: both stay reachable
      expect((await store.read('aakey1')).toString()).toBe('on disk')
      expect((await store.read('bbkey2')).toString()).toBe('in the database')
      expect(await store.exists('nope')).toBe(false)
      await appDb.close()
    })
  })

  describe(`webhooks (${dialect.name})`, () => {
    async function setup() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const clock = { value: new Date(2026, 6, 19, 14, 30) }
      const daily = createDailyService(repo, { now: () => clock.value })
      const tasks = createTasksService(repo)
      const webhooks = createWebhooksService(repo, daily, { now: () => clock.value })
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      return { appDb, repo, daily, tasks, webhooks, user }
    }

    it('delivers to inbox, today, and tasks; revoked and bogus tokens 404', async () => {
      const { appDb, repo, daily, tasks, webhooks, user } = await setup()

      const inbox = await webhooks.create(user.id, { target: 'inbox', label: 'phone' })
      const today = await webhooks.create(user.id, { target: 'today', label: 'ifttt' })
      const task = await webhooks.create(user.id, { target: 'tasks', label: 'script' })

      expect((await webhooks.deliver(inbox.token, 'a thought'))?.target).toBe('inbox')
      expect((await webhooks.deliver(today.token, 'meeting note'))?.target).toBe('today')
      expect((await webhooks.deliver(task.token, 'buy milk @2026-08-01'))?.target).toBe('tasks')

      // inbox → memo
      const memos = await daily.listMemos(user)
      expect(memos.some((m) => m.content === 'a thought')).toBe(true)
      // today → appended to the day page with a timestamp
      const day = await daily.day(user, '2026-07-19')
      expect(day.doc.content).toContain('14:30')
      expect(day.doc.content).toContain('meeting note')
      // tasks → indexed with the due token parsed
      const agenda = await tasks.agenda(user)
      const added = agenda.find((t) => t.task.text.includes('buy milk'))
      expect(added?.task.due).toBe('2026-08-01')
      // usage stamped
      const rows = await webhooks.list(user.id)
      expect(rows.every((r) => r.lastUsedAt !== null)).toBe(true)

      // revocation kills the token; unknown tokens are indistinguishable
      await webhooks.revoke(user.id, inbox.row.id)
      expect(await webhooks.deliver(inbox.token, 'again')).toBeNull()
      expect(await webhooks.deliver('totally-bogus-token', 'x')).toBeNull()

      // the raw token is never stored
      const stored = await repo.listWebhooksForUser(user.id)
      expect(stored.some((r) => JSON.stringify(r).includes(task.token))).toBe(false)
      await appDb.close()
    })
  })

  describe(`day notes (${dialect.name})`, () => {
    it('a day holds a main note plus named topic notes; main cannot be deleted', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const daily = createDailyService(repo)
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })

      const first = await daily.dayNotes(user, '2026-07-19')
      expect(first).toHaveLength(1)
      expect(first[0]?.main).toBe(true)

      const work = await daily.createDayNote(user, '2026-07-19', 'Work')
      await daily.createDayNote(user, '2026-07-19', 'Hobby')
      const notes = await daily.dayNotes(user, '2026-07-19')
      expect(notes.map((n) => n.page.title)).toEqual(['2026-07-19', 'Work', 'Hobby'])
      expect(notes.filter((n) => n.main)).toHaveLength(1)

      // the main day page keeps anchoring get-or-create (promotes, webhooks)
      const day = await daily.day(user, '2026-07-19')
      expect(day.page.id).toBe(first[0]?.page.id)

      // topic notes delete; the main note refuses
      await daily.deleteDayNote(user, work.id)
      expect((await daily.dayNotes(user, '2026-07-19')).map((n) => n.page.title)).toEqual([
        '2026-07-19',
        'Hobby',
      ])
      await expect(
        daily.deleteDayNote(user, (first[0] as { page: { id: string } }).page.id),
      ).rejects.toThrow('main day note')

      // other users cannot touch them
      const invite = await auth.createInvite(user.id, { role: 'member' })
      const { user: other } = await auth.acceptInvite({
        token: invite.token,
        name: 'O',
        email: 'o@x.dev',
        password: 'longpassword2',
      })
      const hobby = (await daily.dayNotes(user, '2026-07-19'))[1]
      await expect(
        daily.deleteDayNote(other, (hobby as { page: { id: string } }).page.id),
      ).rejects.toThrow('Note not found')
      await appDb.close()
    })
  })
}
