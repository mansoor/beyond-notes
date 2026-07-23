/**
 * Password locks on a notebook or a single page.
 *
 * What this is: a lock screen. Opening a locked space or page requires the
 * account password again, and the unlock is remembered for the session or for
 * 30 idle minutes. It exists for the laptop left open on the kitchen table.
 *
 * What this is NOT: encryption. The content sits in the database as plain text
 * exactly as before, so anyone holding the database file, a backup or a
 * full-instance export can still read it. The UI says so at the point of
 * locking, and DESIGN-NOTES records why: encrypting at rest means a forgotten
 * passphrase is unrecoverable data loss, which is a bigger promise than this
 * feature was asked to make.
 *
 * Enforcement lives here and in the services that read content — never in the
 * browser. A locked page's title still travels (you have to be able to see the
 * thing to unlock it); its document does not.
 */

import type { PageRow, Repo, SpaceRow, UserRow } from './repo'

export type LockPolicy = 'session' | 'idle'
export type LockTarget = { kind: 'space' | 'page'; id: string }

/** Default minutes an 'idle' unlock survives unused, when a lock names none. */
export const DEFAULT_IDLE_MINUTES = 30
export const IDLE_MS = DEFAULT_IDLE_MINUTES * 60 * 1000

/** Clamp a stored minute count into something sane before trusting it. */
export function idleMsFor(minutes: number | null | undefined): number {
  const m = minutes ?? DEFAULT_IDLE_MINUTES
  return Math.min(Math.max(Math.round(m), 1), 60 * 24 * 7) * 60 * 1000
}

export class LockedError extends Error {
  constructor(
    readonly target: LockTarget,
    readonly policy: LockPolicy,
  ) {
    super('This is locked. Enter your password to open it.')
  }
}

type Grant = { policy: LockPolicy; touchedAt: number; idleMs: number }

/**
 * Unlocks are held in memory, keyed by session token — so they die with the
 * process and with sign-out, and never outlive either. A restart re-locking
 * everything is the safe direction to fail.
 */
export function createLockService(repo: Repo, opts: { now?: () => number } = {}) {
  const now = opts.now ?? (() => Date.now())
  const grants = new Map<string, Map<string, Grant>>()

  const key = (t: LockTarget) => `${t.kind}:${t.id}`

  const live = (grant: Grant | undefined): boolean => {
    if (!grant) return false
    if (grant.policy === 'session') return true
    return now() - grant.touchedAt < grant.idleMs
  }

  return {
    /** Record a successful password check. The caller verifies the password. */
    grant(
      sessionToken: string,
      target: LockTarget,
      policy: LockPolicy,
      idleMinutes?: number | null,
    ): void {
      const forSession = grants.get(sessionToken) ?? new Map<string, Grant>()
      forSession.set(key(target), { policy, touchedAt: now(), idleMs: idleMsFor(idleMinutes) })
      grants.set(sessionToken, forSession)
    },

    /** Drop every unlock for a session — called on sign-out. */
    revokeSession(sessionToken: string): void {
      grants.delete(sessionToken)
    },

    /** Drop one unlock, so "lock now" takes effect without signing out. */
    revoke(sessionToken: string, target: LockTarget): void {
      grants.get(sessionToken)?.delete(key(target))
    },

    /** True if this session may see the target's content right now. */
    isOpen(sessionToken: string | null, target: LockTarget): boolean {
      if (!sessionToken) return false
      const grant = grants.get(sessionToken)?.get(key(target))
      if (!live(grant)) return false
      // reading it counts as using it: the idle window slides forward
      if (grant && grant.policy === 'idle') grant.touchedAt = now()
      return true
    },

    /**
     * Read the open state WITHOUT counting as use — the idle window does not
     * slide. This is what the status list (`locks.list`) needs: the client
     * polls it to notice an idle lock has fired, and if the poll itself renewed
     * the grant, an idle lock could never fire while the app was open.
     */
    isOpenPeek(sessionToken: string | null, target: LockTarget): boolean {
      if (!sessionToken) return false
      return live(grants.get(sessionToken)?.get(key(target)))
    },

    /**
     * The lock covering a page: its own, or the space it lives in. A page
     * inside a locked notebook is locked even if the page itself is not.
     */
    async lockFor(
      page: PageRow,
      space: SpaceRow | null,
    ): Promise<{ target: LockTarget; policy: LockPolicy; idleMinutes: number | null } | null> {
      if (page.lockPolicy) {
        return {
          target: { kind: 'page', id: page.id },
          policy: page.lockPolicy,
          idleMinutes: page.lockIdleMinutes,
        }
      }
      if (space?.lockPolicy) {
        return {
          target: { kind: 'space', id: space.id },
          policy: space.lockPolicy,
          idleMinutes: space.lockIdleMinutes,
        }
      }
      return null
    },

    /** Throws unless the session has unlocked whatever covers this page. */
    async assertPageOpen(sessionToken: string | null, page: PageRow): Promise<void> {
      const space = await repo.getSpace(page.spaceId)
      const lock = await this.lockFor(page, space)
      if (!lock) return
      if (!this.isOpen(sessionToken, lock.target)) throw new LockedError(lock.target, lock.policy)
    },

    /** Page ids this session may not read — used to filter search and lists. */
    async hiddenPageIds(sessionToken: string | null, user: UserRow): Promise<Set<string>> {
      const [spaces, pages] = await Promise.all([repo.listSpaces(), repo.listLockedPages()])
      const hidden = new Set<string>()

      const lockedSpaces = spaces.filter((s) => s.lockPolicy !== null)
      for (const space of lockedSpaces) {
        if (this.isOpen(sessionToken, { kind: 'space', id: space.id })) continue
        // a locked space hides everything in it, whatever the page says
        for (const page of await repo.listPagesInSpace(space.id)) hidden.add(page.id)
      }
      for (const page of pages) {
        if (!this.isOpen(sessionToken, { kind: 'page', id: page.id })) hidden.add(page.id)
      }
      // personal spaces of other users are already filtered upstream; this only
      // adds locks on top of that
      void user
      return hidden
    },
  }
}

export type LockService = ReturnType<typeof createLockService>
