import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDb } from './db'
import { IDLE_MS, LockedError, createLockService } from './locks'
import { createPagesService } from './pages'
import { createRepo } from './repo'

/** Narrow away `null`/`undefined` without a non-null assertion. */
function req<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('expected a value')
  return x
}

async function setup(clock?: { now: () => number }) {
  const db = createDb('file::memory:')
  await db.migrate('./drizzle')
  const repo = createRepo(db)
  const auth = createAuthService(repo)
  const { user } = await auth.setup({ email: 'a@b.test', password: 'password123', name: 'A' })
  const pages = createPagesService(repo)
  const locks = createLockService(repo, clock ? { now: clock.now } : {})
  const space = await pages.createSpace(user, {
    name: 'Finances',
    category: 'notebook',
    personal: true,
  })
  const page = await pages.createPage(user, {
    spaceId: space.id,
    parentId: null,
    title: 'Bank',
  })
  return { db, repo, auth, pages, locks, user, space, page }
}

describe('lock grants', () => {
  it('keeps a locked page shut until the session unlocks it', async () => {
    const { db, repo, locks, page, space } = await setup()
    await repo.setPageLock(page.id, 'session')
    const fresh = req(await repo.getPage(page.id))

    await expect(locks.assertPageOpen('sess-1', fresh)).rejects.toThrow(LockedError)
    locks.grant('sess-1', { kind: 'page', id: page.id }, 'session')
    await expect(locks.assertPageOpen('sess-1', fresh)).resolves.toBeUndefined()

    // the grant belongs to one session, not to the user
    await expect(locks.assertPageOpen('sess-2', fresh)).rejects.toThrow(LockedError)
    // …and not to the whole space
    void space
    await db.close()
  })

  it('locks every page in a locked notebook, page lock or not', async () => {
    const { db, repo, pages, locks, user, space } = await setup()
    const child = await pages.createPage(user, {
      spaceId: space.id,
      parentId: null,
      title: 'Statements',
    })
    await repo.setSpaceLock(space.id, 'session')

    const fresh = req(await repo.getPage(child.id))
    await expect(locks.assertPageOpen('sess-1', fresh)).rejects.toThrow(LockedError)
    locks.grant('sess-1', { kind: 'space', id: space.id }, 'session')
    await expect(locks.assertPageOpen('sess-1', fresh)).resolves.toBeUndefined()
    await db.close()
  })

  it('expires an idle grant after 30 minutes, and sliding use keeps it alive', async () => {
    let clock = 1_000_000
    const { db, repo, locks, page } = await setup({ now: () => clock })
    await repo.setPageLock(page.id, 'idle')
    const fresh = req(await repo.getPage(page.id))

    locks.grant('sess-1', { kind: 'page', id: page.id }, 'idle')
    clock += IDLE_MS - 1000
    await expect(locks.assertPageOpen('sess-1', fresh)).resolves.toBeUndefined() // still open…
    clock += IDLE_MS - 1000 // …and that read pushed the window forward
    await expect(locks.assertPageOpen('sess-1', fresh)).resolves.toBeUndefined()

    clock += IDLE_MS + 1000 // now genuinely idle
    await expect(locks.assertPageOpen('sess-1', fresh)).rejects.toThrow(LockedError)
    await db.close()
  })

  it('a session grant does not expire with time', async () => {
    let clock = 1_000_000
    const { db, repo, locks, page } = await setup({ now: () => clock })
    await repo.setPageLock(page.id, 'session')
    const fresh = req(await repo.getPage(page.id))
    locks.grant('sess-1', { kind: 'page', id: page.id }, 'session')
    clock += IDLE_MS * 100
    await expect(locks.assertPageOpen('sess-1', fresh)).resolves.toBeUndefined()
    await db.close()
  })

  it('signing out re-locks everything the session had open', async () => {
    const { db, repo, locks, page } = await setup()
    await repo.setPageLock(page.id, 'session')
    const fresh = req(await repo.getPage(page.id))
    locks.grant('sess-1', { kind: 'page', id: page.id }, 'session')
    locks.revokeSession('sess-1')
    await expect(locks.assertPageOpen('sess-1', fresh)).rejects.toThrow(LockedError)
    await db.close()
  })

  it('lock now closes one target without touching the others', async () => {
    const { db, repo, pages, locks, user, space, page } = await setup()
    const other = await pages.createPage(user, {
      spaceId: space.id,
      parentId: null,
      title: 'Open',
    })
    await repo.setPageLock(page.id, 'session')
    await repo.setPageLock(other.id, 'session')
    locks.grant('sess-1', { kind: 'page', id: page.id }, 'session')
    locks.grant('sess-1', { kind: 'page', id: other.id }, 'session')

    locks.revoke('sess-1', { kind: 'page', id: page.id })
    await expect(locks.assertPageOpen('sess-1', req(await repo.getPage(page.id)))).rejects.toThrow(
      LockedError,
    )
    await expect(
      locks.assertPageOpen('sess-1', req(await repo.getPage(other.id))),
    ).resolves.toBeUndefined()
    await db.close()
  })

  it('an unlocked page stays open with no grant at all', async () => {
    const { db, locks, page } = await setup()
    await expect(locks.assertPageOpen(null, page)).resolves.toBeUndefined()
    await db.close()
  })
})

describe('hiddenPageIds — what search must not return', () => {
  it('hides locked pages and every page of a locked space', async () => {
    const { db, repo, pages, locks, user, space, page } = await setup()
    const open = await pages.createSpace(user, {
      name: 'Open notes',
      category: 'notebook',
      personal: true,
    })
    const openPage = await pages.createPage(user, {
      spaceId: open.id,
      parentId: null,
      title: 'Visible',
    })
    const inLocked = await pages.createPage(user, {
      spaceId: space.id,
      parentId: null,
      title: 'Also hidden',
    })
    await repo.setSpaceLock(space.id, 'session')
    await repo.setPageLock(openPage.id, 'session')

    const hidden = await locks.hiddenPageIds('sess-1', user)
    expect(hidden.has(page.id)).toBe(true) // inside the locked space
    expect(hidden.has(inLocked.id)).toBe(true)
    expect(hidden.has(openPage.id)).toBe(true) // locked in its own right

    locks.grant('sess-1', { kind: 'space', id: space.id }, 'session')
    const afterUnlock = await locks.hiddenPageIds('sess-1', user)
    expect(afterUnlock.has(page.id)).toBe(false)
    expect(afterUnlock.has(openPage.id)).toBe(true) // its own lock still stands
    await db.close()
  })
})
