import { createHash, randomBytes } from 'node:crypto'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import { nanoid } from 'nanoid'
import type { InviteRow, Repo, UserRow } from './repo'
import { generateRecoveryCodes, generateTotpSecret, otpauthUrl, verifyTotp } from './totp'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

export class AuthError extends Error {
  constructor(
    public code:
      | 'SETUP_ALREADY_DONE'
      | 'BAD_CREDENTIALS'
      | 'RATE_LIMITED'
      | 'EMAIL_TAKEN'
      | 'INVITE_INVALID'
      | 'TOTP_REQUIRED'
      | 'TOTP_INVALID'
      | 'RESET_INVALID',
    message: string,
  ) {
    super(message)
  }
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// Minimal fixed-window limiter for login attempts. In-memory is correct here:
// the app is a single process by design (see TECH-PLAN).
export class LoginLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>()
  constructor(
    private max = 10,
    private windowMs = 15 * 60 * 1000,
    private now: () => number = Date.now,
  ) {}

  check(key: string): void {
    const entry = this.attempts.get(key)
    if (!entry || entry.resetAt < this.now()) return
    if (entry.count >= this.max)
      throw new AuthError('RATE_LIMITED', 'Too many attempts. Try again later.')
  }

  recordFailure(key: string): void {
    const now = this.now()
    const entry = this.attempts.get(key)
    if (!entry || entry.resetAt < now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs })
    } else {
      entry.count += 1
    }
  }

  clear(key: string): void {
    this.attempts.delete(key)
  }
}

export function createAuthService(
  repo: Repo,
  opts: { now?: () => Date; limiter?: LoginLimiter } = {},
) {
  const now = opts.now ?? (() => new Date())
  const limiter = opts.limiter ?? new LoginLimiter()

  async function consumeRecoveryCode(user: UserRow, code: string): Promise<boolean> {
    const fresh = await repo.getUserById(user.id)
    if (!fresh?.recoveryCodes) return false
    const hashes = JSON.parse(fresh.recoveryCodes) as string[]
    const candidate = hashToken(code.trim().toLowerCase())
    const idx = hashes.indexOf(candidate)
    if (idx < 0) return false
    hashes.splice(idx, 1) // single use
    await repo.updateUser(user.id, { recoveryCodes: JSON.stringify(hashes) })
    return true
  }

  async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(now().getTime() + SESSION_TTL_MS)
    await repo.insertSession({ id: hashToken(token), userId, createdAt: now(), expiresAt })
    return { token, expiresAt }
  }

  return {
    async needsSetup(): Promise<boolean> {
      return (await repo.countUsers()) === 0
    },

    /** First-boot: create the admin account. Only valid while zero users exist. */
    async setup(input: { name: string; email: string; password: string }) {
      if ((await repo.countUsers()) > 0) {
        throw new AuthError('SETUP_ALREADY_DONE', 'This instance is already set up.')
      }
      const user: UserRow = {
        id: nanoid(),
        email: input.email,
        name: input.name,
        passwordHash: await argonHash(input.password),
        role: 'admin',
        totpSecret: null,
        totpEnabled: false,
        recoveryCodes: null,
        emailNotifications: false,
        createdAt: now(),
      }
      await repo.insertUser(user)
      return { user, session: await createSession(user.id) }
    },

    async login(input: { email: string; password: string; totpCode?: string }) {
      limiter.check(input.email)
      const user = await repo.getUserByEmail(input.email)
      const ok = user ? await argonVerify(user.passwordHash, input.password) : false
      if (!user || !ok) {
        limiter.recordFailure(input.email)
        throw new AuthError('BAD_CREDENTIALS', 'Wrong email or password.')
      }
      if (user.totpEnabled && user.totpSecret) {
        if (!input.totpCode) {
          // password was right; don't count this as a failed attempt
          throw new AuthError('TOTP_REQUIRED', 'Enter your authenticator code.')
        }
        const codeOk =
          verifyTotp(user.totpSecret, input.totpCode, now().getTime()) ||
          (await consumeRecoveryCode(user, input.totpCode))
        if (!codeOk) {
          limiter.recordFailure(input.email)
          throw new AuthError('TOTP_INVALID', 'That code is not valid.')
        }
      }
      limiter.clear(input.email)
      return { user, session: await createSession(user.id) }
    },

    /** Begin 2FA enrollment: store a secret (not yet enabled), return it for the QR. */
    async totpStart(user: UserRow) {
      if (user.totpEnabled) throw new AuthError('SETUP_ALREADY_DONE', '2FA is already enabled.')
      const secret = generateTotpSecret()
      await repo.updateUser(user.id, { totpSecret: secret, totpEnabled: false })
      return { secret, url: otpauthUrl(secret, user.email) }
    },

    /** Verify one code against the pending secret; on success enable + return recovery codes (once). */
    async totpConfirm(user: UserRow, code: string) {
      const fresh = await repo.getUserById(user.id)
      if (!fresh?.totpSecret) throw new AuthError('TOTP_INVALID', 'Start enrollment first.')
      if (!verifyTotp(fresh.totpSecret, code, now().getTime())) {
        throw new AuthError('TOTP_INVALID', 'That code is not valid — try the next one.')
      }
      const codes = generateRecoveryCodes()
      await repo.updateUser(user.id, {
        totpEnabled: true,
        recoveryCodes: JSON.stringify(codes.map((c) => hashToken(c))),
      })
      return { recoveryCodes: codes }
    },

    async totpDisable(user: UserRow, password: string) {
      if (!(await argonVerify(user.passwordHash, password))) {
        throw new AuthError('BAD_CREDENTIALS', 'Wrong password.')
      }
      await repo.updateUser(user.id, { totpSecret: null, totpEnabled: false, recoveryCodes: null })
    },

    /**
     * Forgot-password step 1. Returns the raw token for the caller to email,
     * or null when no such account exists — the router must respond
     * identically either way so the endpoint can't enumerate accounts.
     */
    async requestPasswordReset(email: string): Promise<{ user: UserRow; token: string } | null> {
      limiter.check(`reset:${email}`)
      limiter.recordFailure(`reset:${email}`) // every request counts: this endpoint sends mail
      const user = await repo.getUserByEmail(email)
      if (!user) return null
      const token = randomBytes(32).toString('base64url')
      await repo.insertResetToken({
        id: hashToken(token),
        userId: user.id,
        createdAt: now(),
        expiresAt: new Date(now().getTime() + RESET_TTL_MS),
        usedAt: null,
      })
      return { user, token }
    },

    /**
     * Forgot-password step 2: consume the token, set the password, revoke
     * every session. TOTP is deliberately untouched — an attacker with the
     * mailbox must still get past the second factor.
     */
    async resetPassword(token: string, next: string): Promise<void> {
      const row = await repo.getResetToken(hashToken(token))
      const valid = row && !row.usedAt && row.expiresAt.getTime() >= now().getTime()
      if (!row || !valid || !(await repo.markResetTokenUsed(row.id, now()))) {
        throw new AuthError('RESET_INVALID', 'This reset link is not valid any more.')
      }
      await repo.updateUser(row.userId, { passwordHash: await argonHash(next) })
      // outstanding sibling tokens die with the reset, not on their own clock
      await repo.deleteResetTokensForUser(row.userId)
      for (const session of await repo.listSessionsForUser(row.userId)) {
        await repo.deleteSession(session.id)
      }
    },

    async changePassword(user: UserRow, current: string, next: string) {
      if (!(await argonVerify(user.passwordHash, current))) {
        throw new AuthError('BAD_CREDENTIALS', 'Current password is wrong.')
      }
      await repo.updateUser(user.id, { passwordHash: await argonHash(next) })
    },

    /** CLI rescue path: no current password needed; requires shell access to the host. */
    async forceResetPassword(email: string, next: string): Promise<boolean> {
      const user = await repo.getUserByEmail(email)
      if (!user) return false
      await repo.updateUser(user.id, {
        passwordHash: await argonHash(next),
        totpSecret: null,
        totpEnabled: false,
        recoveryCodes: null,
      })
      await repo.deleteResetTokensForUser(user.id)
      for (const session of await repo.listSessionsForUser(user.id)) {
        await repo.deleteSession(session.id)
      }
      return true
    },

    async listSessions(user: UserRow, currentToken: string | null) {
      const sessions = await repo.listSessionsForUser(user.id)
      const currentId = currentToken ? hashToken(currentToken) : null
      return sessions
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          current: s.id === currentId,
        }))
    },

    async revokeSession(user: UserRow, sessionId: string) {
      const sessions = await repo.listSessionsForUser(user.id)
      if (sessions.some((s) => s.id === sessionId)) await repo.deleteSession(sessionId)
    },

    async logout(rawToken: string): Promise<void> {
      await repo.deleteSession(hashToken(rawToken))
    },

    async userForToken(rawToken: string): Promise<UserRow | null> {
      const session = await repo.getSession(hashToken(rawToken))
      if (!session) return null
      if (session.expiresAt.getTime() < now().getTime()) {
        await repo.deleteSession(session.id)
        return null
      }
      return repo.getUserById(session.userId)
    },

    /** Admin creates an invite; the raw token is returned exactly once. */
    async createInvite(
      createdBy: string,
      input: { suggestedEmail?: string; role: 'admin' | 'member' },
    ) {
      const token = randomBytes(24).toString('base64url')
      const invite: InviteRow = {
        id: nanoid(),
        tokenHash: hashToken(token),
        suggestedEmail: input.suggestedEmail ?? null,
        role: input.role,
        createdBy,
        createdAt: now(),
        expiresAt: new Date(now().getTime() + INVITE_TTL_MS),
        usedAt: null,
        usedBy: null,
        revokedAt: null,
      }
      await repo.insertInvite(invite)
      return { token, invite }
    },

    async inviteForToken(token: string): Promise<InviteRow | null> {
      const invite = await repo.getInviteByTokenHash(hashToken(token))
      if (!invite) return null
      if (invite.usedAt || invite.revokedAt) return null
      if (invite.expiresAt.getTime() < now().getTime()) return null
      return invite
    },

    async acceptInvite(input: { token: string; name: string; email: string; password: string }) {
      const invite = await this.inviteForToken(input.token)
      if (!invite) throw new AuthError('INVITE_INVALID', 'This invite link is not valid any more.')
      if (await repo.getUserByEmail(input.email)) {
        throw new AuthError('EMAIL_TAKEN', 'An account with this email already exists.')
      }
      const user: UserRow = {
        id: nanoid(),
        email: input.email,
        name: input.name,
        passwordHash: await argonHash(input.password),
        role: invite.role,
        totpSecret: null,
        totpEnabled: false,
        recoveryCodes: null,
        emailNotifications: false,
        createdAt: now(),
      }
      await repo.insertUser(user)
      await repo.markInviteUsed(invite.id, user.id, now())
      return { user, session: await createSession(user.id) }
    },

    async revokeInvite(id: string): Promise<void> {
      await repo.revokeInvite(id, now())
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>
