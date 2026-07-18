import { describe, expect, it } from 'vitest'
import { AuthError, createAuthService } from './auth'
import { type AppDb, createDb } from './db'
import { createRepo } from './repo'
import { base32Decode, base32Encode, totpCode, verifyTotp } from './totp'

// RFC 6238 test secret: ASCII "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'))

describe('totp (RFC 6238 vectors, truncated to 6 digits)', () => {
  it('matches the published SHA-1 vectors', () => {
    expect(totpCode(RFC_SECRET, 59 * 1000)).toBe('287082')
    expect(totpCode(RFC_SECRET, 1111111109 * 1000)).toBe('081804')
    expect(totpCode(RFC_SECRET, 1234567890 * 1000)).toBe('005924')
    expect(totpCode(RFC_SECRET, 2000000000 * 1000)).toBe('279037')
  })

  it('verify accepts ±1 step of drift and rejects garbage', () => {
    const at = 1111111109 * 1000
    expect(verifyTotp(RFC_SECRET, '081804', at)).toBe(true)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at - 30_000), at)).toBe(true)
    expect(verifyTotp(RFC_SECRET, '000000', at)).toBe(false)
    expect(verifyTotp(RFC_SECRET, 'not-a-code', at)).toBe(false)
  })

  it('base32 round-trips', () => {
    const buf = Buffer.from('beyond notes secret!', 'ascii')
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true)
  })
})

async function makeDb(): Promise<AppDb> {
  const db = createDb('file::memory:')
  await db.migrate('./drizzle')
  return db
}

describe('2FA login flow + rescue', () => {
  it('enroll, login with code, recovery code single-use, rescue clears 2FA', async () => {
    const appDb = await makeDb()
    const repo = createRepo(appDb)
    const clock = { value: new Date(2026, 6, 18, 10, 0, 0) }
    const auth = createAuthService(repo, { now: () => new Date(clock.value) })
    const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })

    // enroll
    const { secret, url } = await auth.totpStart(user)
    expect(url).toContain('otpauth://totp/')
    const goodCode = totpCode(secret, clock.value.getTime())
    const { recoveryCodes } = await auth.totpConfirm(user, goodCode)
    expect(recoveryCodes).toHaveLength(10)

    // password alone no longer signs in
    await expect(auth.login({ email: 'm@x.dev', password: 'longpassword1' })).rejects.toThrow(
      'authenticator code',
    )
    // wrong code rejected
    await expect(
      auth.login({ email: 'm@x.dev', password: 'longpassword1', totpCode: '000000' }),
    ).rejects.toThrow('not valid')
    // right code works
    const ok = await auth.login({
      email: 'm@x.dev',
      password: 'longpassword1',
      totpCode: totpCode(secret, clock.value.getTime()),
    })
    expect(ok.user.email).toBe('m@x.dev')

    // recovery code works exactly once
    const recovery = recoveryCodes[0]
    if (!recovery) throw new Error('missing recovery code')
    await auth.login({ email: 'm@x.dev', password: 'longpassword1', totpCode: recovery })
    await expect(
      auth.login({ email: 'm@x.dev', password: 'longpassword1', totpCode: recovery }),
    ).rejects.toThrow('not valid')

    // CLI rescue: resets password, disables 2FA, revokes sessions
    expect(await auth.forceResetPassword('m@x.dev', 'rescued-password-1')).toBe(true)
    expect(await auth.userForToken(ok.session.token)).toBeNull()
    const back = await auth.login({ email: 'm@x.dev', password: 'rescued-password-1' })
    expect(back.user.totpEnabled).toBe(false)
    expect(await auth.forceResetPassword('ghost@x.dev', 'whatever-123')).toBe(false)
    await appDb.close()
  })

  it('changePassword requires the current password; totpDisable requires password', async () => {
    const appDb = await makeDb()
    const repo = createRepo(appDb)
    const auth = createAuthService(repo)
    const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })

    await expect(auth.changePassword(user, 'wrong-password', 'new-password-123')).rejects.toThrow(
      AuthError,
    )
    await auth.changePassword(user, 'longpassword1', 'new-password-123')
    const again = await auth.login({ email: 'm@x.dev', password: 'new-password-123' })
    expect(again.user.id).toBe(user.id)

    const fresh = await repo.getUserById(user.id)
    if (!fresh) throw new Error('missing')
    await expect(auth.totpDisable(fresh, 'bad-password')).rejects.toThrow(AuthError)
    await appDb.close()
  })
})

describe('search', () => {
  it('finds accessible pages by title and content, case-insensitively', async () => {
    const appDb = await makeDb()
    const repo = createRepo(appDb)
    const auth = createAuthService(repo)
    const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
    const { createPagesService } = await import('./pages')
    const pages = createPagesService(repo)
    const space = await pages.createSpace(user, {
      name: 'N',
      category: 'notebook',
      personal: false,
    })
    const page = await pages.createPage(user, {
      spaceId: space.id,
      parentId: null,
      title: 'Ollama fixes',
    })
    const { doc } = await pages.getPage(user, page.id)
    await pages.saveDocument(user, {
      pageId: page.id,
      content: JSON.stringify([
        {
          id: 'b1',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'Set NUM_CTX explicitly per stage', styles: {} }],
          children: [],
        },
      ]),
      baseUpdatedAt: doc.updatedAt.toISOString(),
    })

    const byTitle = await repo.searchPages('ollama')
    expect(byTitle.map((r) => r.page.id)).toContain(page.id)
    const byContent = await repo.searchPages('num_ctx')
    expect(byContent.map((r) => r.page.id)).toContain(page.id)
    expect(await repo.searchPages('zzz-not-there')).toHaveLength(0)
    await appDb.close()
  })
})
