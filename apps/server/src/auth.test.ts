import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AuthError, LoginLimiter, createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { createRepo } from './repo'

// The same suite runs against every available dialect. SQLite always runs;
// Postgres runs when TEST_PG_URL is set (CI provides it via a service container).
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
      // fresh schema per test: drop app tables and drizzle's migration journal, re-migrate
      await db.db.execute(sql.raw('drop schema public cascade'))
      await db.db.execute(sql.raw('create schema public'))
      await db.db.execute(sql.raw('drop schema if exists drizzle cascade'))
      await db.migrate('./drizzle')
      return db
    },
  })
}

for (const dialect of dialects) {
  describe(`auth service (${dialect.name})`, () => {
    async function makeAuth(nowRef?: { value: Date }) {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo, nowRef ? { now: () => nowRef.value } : {})
      return { auth, repo, appDb }
    }

    it('setup creates the first admin exactly once', async () => {
      const { auth, appDb } = await makeAuth()
      expect(await auth.needsSetup()).toBe(true)

      const { user } = await auth.setup({
        name: 'Mansoor',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      expect(user.role).toBe('admin')
      expect(await auth.needsSetup()).toBe(false)

      await expect(
        auth.setup({ name: 'Mallory', email: 'evil@x.dev', password: 'longpassword1' }),
      ).rejects.toThrow(AuthError)
      await appDb.close()
    })

    it('login verifies credentials and issues a working session', async () => {
      const { auth, appDb } = await makeAuth()
      await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })

      await expect(auth.login({ email: 'm@x.dev', password: 'wrong-password' })).rejects.toThrow(
        'Wrong email or password.',
      )
      const { session } = await auth.login({ email: 'm@x.dev', password: 'longpassword1' })
      const user = await auth.userForToken(session.token)
      expect(user?.email).toBe('m@x.dev')

      await auth.logout(session.token)
      expect(await auth.userForToken(session.token)).toBeNull()
      await appDb.close()
    })

    it('sessions expire', async () => {
      const nowRef = { value: new Date('2026-07-18T00:00:00Z') }
      const { auth, appDb } = await makeAuth(nowRef)
      await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const { session } = await auth.login({ email: 'm@x.dev', password: 'longpassword1' })

      nowRef.value = new Date('2026-08-20T00:00:00Z') // past the 30-day TTL
      expect(await auth.userForToken(session.token)).toBeNull()
      await appDb.close()
    })

    it('invite lifecycle: accept once, no reuse, revoke and expiry block acceptance', async () => {
      const nowRef = { value: new Date('2026-07-18T00:00:00Z') }
      const { auth, appDb } = await makeAuth(nowRef)
      const { user: admin } = await auth.setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })

      // happy path
      const { token } = await auth.createInvite(admin.id, { role: 'member' })
      const { user: member } = await auth.acceptInvite({
        token,
        name: 'Partner',
        email: 'p@x.dev',
        password: 'longpassword2',
      })
      expect(member.role).toBe('member')

      // single use
      await expect(
        auth.acceptInvite({ token, name: 'X', email: 'x@x.dev', password: 'longpassword3' }),
      ).rejects.toThrow('not valid')

      // revoked invite
      const second = await auth.createInvite(admin.id, { role: 'member' })
      await auth.revokeInvite(second.invite.id)
      expect(await auth.inviteForToken(second.token)).toBeNull()

      // expired invite
      const third = await auth.createInvite(admin.id, { role: 'member' })
      nowRef.value = new Date('2026-07-26T00:00:01Z') // past the 7-day TTL
      expect(await auth.inviteForToken(third.token)).toBeNull()

      // duplicate email rejected
      nowRef.value = new Date('2026-07-18T00:00:00Z')
      const fourth = await auth.createInvite(admin.id, { role: 'member' })
      await expect(
        auth.acceptInvite({
          token: fourth.token,
          name: 'P',
          email: 'p@x.dev',
          password: 'longpassword4',
        }),
      ).rejects.toThrow('already exists')
      await appDb.close()
    })

    it('rate-limits repeated failed logins', async () => {
      const { appDb } = await dialectSetupForLimiter()
      await appDb.close()

      async function dialectSetupForLimiter() {
        const appDb = await dialect.make()
        const repo = createRepo(appDb)
        let clock = Date.now()
        const limiter = new LoginLimiter(3, 60_000, () => clock)
        const auth = createAuthService(repo, { limiter })
        await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })

        for (let i = 0; i < 3; i++) {
          await expect(auth.login({ email: 'm@x.dev', password: 'nope-nope' })).rejects.toThrow(
            'Wrong email or password.',
          )
        }
        // 4th attempt blocked even with the right password
        await expect(auth.login({ email: 'm@x.dev', password: 'longpassword1' })).rejects.toThrow(
          'Too many attempts',
        )
        // window passes, login succeeds again
        clock += 61_000
        const { user } = await auth.login({ email: 'm@x.dev', password: 'longpassword1' })
        expect(user.email).toBe('m@x.dev')
        return { appDb }
      }
    })
  })
}
