import { createHash, randomBytes } from 'node:crypto'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import { nanoid } from 'nanoid'
import type { InviteRow, Repo, UserRow } from './repo'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export class AuthError extends Error {
  constructor(
    public code:
      | 'SETUP_ALREADY_DONE'
      | 'BAD_CREDENTIALS'
      | 'RATE_LIMITED'
      | 'EMAIL_TAKEN'
      | 'INVITE_INVALID',
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
        createdAt: now(),
      }
      await repo.insertUser(user)
      return { user, session: await createSession(user.id) }
    },

    async login(input: { email: string; password: string }) {
      limiter.check(input.email)
      const user = await repo.getUserByEmail(input.email)
      const ok = user ? await argonVerify(user.passwordHash, input.password) : false
      if (!user || !ok) {
        limiter.recordFailure(input.email)
        throw new AuthError('BAD_CREDENTIALS', 'Wrong email or password.')
      }
      limiter.clear(input.email)
      return { user, session: await createSession(user.id) }
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
