import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AuthError, createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { type Mailer, createLogMailer, inviteEmail, passwordResetEmail } from './mailer'
import { createRemindersService } from './reminders'
import { createRepo } from './repo'
import { createEmailNotifier, createScheduler } from './scheduler'

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

function captureMailer(): Mailer & { sent: Array<{ to: string; subject: string; text: string }> } {
  const sent: Array<{ to: string; subject: string; text: string }> = []
  return {
    configured: true,
    sent,
    async send(to, subject, text) {
      sent.push({ to, subject, text })
    },
  }
}

for (const dialect of dialects) {
  describe(`password reset (${dialect.name})`, () => {
    async function setup() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const clock = { value: new Date('2026-07-18T10:00:00Z') }
      const auth = createAuthService(repo, { now: () => clock.value })
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      return { appDb, repo, auth, clock, user }
    }

    it('full flow: request, reset, sessions revoked, token single-use', async () => {
      const { appDb, auth } = await setup()
      const { session } = await auth.login({ email: 'm@x.dev', password: 'longpassword1' })

      const result = await auth.requestPasswordReset('m@x.dev')
      expect(result).not.toBeNull()
      const token = (result as { token: string }).token

      await auth.resetPassword(token, 'brand-new-password1')

      // every session died with the reset
      expect(await auth.userForToken(session.token)).toBeNull()
      // old password out, new password in
      await expect(auth.login({ email: 'm@x.dev', password: 'longpassword1' })).rejects.toThrow(
        'Wrong email or password.',
      )
      const again = await auth.login({ email: 'm@x.dev', password: 'brand-new-password1' })
      expect(again.user.email).toBe('m@x.dev')

      // the token is spent
      await expect(auth.resetPassword(token, 'yet-another-password1')).rejects.toThrow(AuthError)
      await appDb.close()
    })

    it('unknown email yields null (router answers identically either way)', async () => {
      const { appDb, auth } = await setup()
      expect(await auth.requestPasswordReset('nobody@x.dev')).toBeNull()
      await appDb.close()
    })

    it('tokens expire after an hour', async () => {
      const { appDb, auth, clock } = await setup()
      const result = await auth.requestPasswordReset('m@x.dev')
      const token = (result as { token: string }).token

      clock.value = new Date('2026-07-18T11:00:01Z')
      await expect(auth.resetPassword(token, 'brand-new-password1')).rejects.toThrow(
        'This reset link is not valid any more.',
      )
      await appDb.close()
    })

    it('reset does not disable TOTP — mailbox access must not bypass the second factor', async () => {
      const { appDb, repo, auth, user } = await setup()
      await auth.totpStart(user)
      const fresh = await repo.getUserById(user.id)
      // enable directly (the confirm path is covered in m6.test.ts)
      await repo.updateUser(user.id, { totpEnabled: true })
      expect(fresh?.totpSecret).toBeTruthy()

      const result = await auth.requestPasswordReset('m@x.dev')
      await auth.resetPassword((result as { token: string }).token, 'brand-new-password1')

      const after = await repo.getUserById(user.id)
      expect(after?.totpEnabled).toBe(true)
      expect(after?.totpSecret).toBe(fresh?.totpSecret)
      await appDb.close()
    })

    it('reset requests are rate limited per email', async () => {
      const { appDb, auth } = await setup()
      for (let i = 0; i < 10; i++) await auth.requestPasswordReset('m@x.dev')
      await expect(auth.requestPasswordReset('m@x.dev')).rejects.toThrow(
        'Too many attempts. Try again later.',
      )
      await appDb.close()
    })
  })

  describe(`email notification channel (${dialect.name})`, () => {
    it('emails the reminder owner only after opt-in', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const clock = { value: new Date(2026, 6, 18, 8, 0) }
      const nowFn = () => new Date(clock.value)
      const reminders = createRemindersService(repo, { now: nowFn })
      const mailer = captureMailer()
      const scheduler = createScheduler(repo, [createEmailNotifier(mailer)], { now: nowFn })
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })

      await reminders.create(user, {
        title: 'Tax due',
        dueDate: '2026-07-18',
        dueTime: null,
        freq: null,
        interval: 1,
        headsUpDays: null,
      })

      // not opted in: the job completes but no mail goes out
      clock.value = new Date(2026, 6, 18, 9, 1)
      expect(await scheduler.runOnce()).toBe(1)
      expect(mailer.sent).toHaveLength(0)

      // opt in, second reminder fires as email to the owner
      await repo.updateUser(user.id, { emailNotifications: true })
      await reminders.create(user, {
        title: 'Renew passport',
        dueDate: '2026-07-18',
        dueTime: '10:00',
        freq: null,
        interval: 1,
        headsUpDays: null,
      })
      clock.value = new Date(2026, 6, 18, 10, 1)
      expect(await scheduler.runOnce()).toBe(1)
      expect(mailer.sent).toHaveLength(1)
      expect(mailer.sent[0]?.to).toBe('m@x.dev')
      expect(mailer.sent[0]?.subject).toBe('Reminder: Renew passport')
      await appDb.close()
    })
  })
}

describe('mail templates', () => {
  it('reset and invite emails carry the right links', () => {
    const reset = passwordResetEmail('https://notes.example.com', 'tok123')
    expect(reset.text).toContain('https://notes.example.com/reset/tok123')
    const invite = inviteEmail('https://notes.example.com', 'tok456', 'Mansoor')
    expect(invite.subject).toContain('Mansoor')
    expect(invite.text).toContain('https://notes.example.com/invite/tok456')
  })

  it('log mailer reports itself as not configured', () => {
    const lines: string[] = []
    const mailer = createLogMailer((m) => lines.push(m))
    expect(mailer.configured).toBe(false)
  })
})
