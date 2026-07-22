import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { buildServer } from './server'

/**
 * The lock has to hold for writes, not just for reading a page.
 *
 * It used to be checked in exactly one place — pages.get — so a locked notebook
 * hid its content while the sidebar's ⋯ and ＋ still renamed it, deleted it,
 * published from it and added pages to it. These go over HTTP with a real
 * session cookie, because the guard is a tRPC middleware: calling the services
 * directly would walk straight past the thing under test.
 */
describe('locked things reject writes', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>>
  let cookie = ''
  let spaceId = ''
  let pageId = ''

  const call = async (path: string, input: unknown) =>
    server.inject({
      method: 'POST',
      url: `/api/trpc/${path}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify(input),
    })

  /** queries are GETs — a POST to one is a 405, not a permission answer */
  const query = async (path: string, input?: unknown) =>
    server.inject({
      method: 'GET',
      url: `/api/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      headers: { cookie },
    })

  const data = (res: { body: string }) => JSON.parse(res.body).result?.data
  const errorOf = (res: { body: string }) => JSON.parse(res.body).error?.message

  beforeAll(async () => {
    appDb = await (async () => {
      const db = createDb('file::memory:')
      await db.migrate('./drizzle')
      return db
    })()
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        DATABASE_URL: 'unused',
      } as never),
      appDb,
    )

    const setup = await call('auth.setup', {
      name: 'M',
      email: 'm@x.dev',
      password: 'longpassword1',
    })
    cookie = (setup.headers['set-cookie'] as string).split(';')[0] as string

    const space = data(
      await call('spaces.create', { name: 'Finances', category: 'notebook', personal: true }),
    )
    spaceId = space.id
    const page = data(await call('pages.create', { spaceId, parentId: null, title: 'Bank' }))
    pageId = page.id

    // lock it, then close it: locking grants the locker an open session, which
    // is right for them but not what we are testing
    await call('locks.set', {
      target: 'space',
      id: spaceId,
      policy: 'session',
      password: 'longpassword1',
    })
    await call('locks.lockNow', { target: 'space', id: spaceId })
  }, 30000)

  afterAll(async () => {
    await server.close()
    await appDb.close()
  })

  it('refuses every write that names the locked space or a page inside it', async () => {
    const attempts: Array<[string, unknown]> = [
      ['pages.rename', { pageId, title: 'Renamed behind the lock' }],
      ['pages.create', { spaceId, parentId: null, title: 'Snuck in' }],
      ['pages.create', { spaceId, parentId: pageId, title: 'Snuck in deeper' }],
      ['pages.delete', { pageId }],
      ['pages.archive', { pageId }],
      ['pages.duplicate', { pageId }],
      ['pages.setType', { pageId, pageType: 'gallery' }],
      ['pages.updateOptions', { pageId, icon: 'rocket_launch' }],
      ['pages.saveDoc', { pageId, content: '[]', baseUpdatedAt: new Date().toISOString() }],
      ['publish.publish', { pageId }],
      ['spaces.rename', { spaceId, name: 'Renamed space' }],
      ['spaces.delete', { spaceId }],
      ['tags.add', { pageId, tag: 'secret' }],
      ['pins.toggle', { pageId }],
    ]
    for (const [path, input] of attempts) {
      const res = await call(path, input)
      expect(`${path}: ${res.statusCode}`).toBe(`${path}: 403`)
      expect(`${path}: ${errorOf(res)}`).toBe(`${path}: LOCKED`)
    }

    // and nothing actually changed
    const tree = data(await query('pages.tree', { spaceId }))
    expect(tree).toHaveLength(1)
    expect(tree[0].title).toBe('Bank')
  })

  it('still lets the tree and titles through — you must see it to unlock it', async () => {
    const res = await query('pages.tree', { spaceId })
    expect(res.statusCode).toBe(200)
    expect(data(res)[0].title).toBe('Bank')
    // the lock list is what the sidebar reads to know it is shut
    const locks = data(await query('locks.list'))
    expect(locks.find((l: { id: string }) => l.id === spaceId).open).toBe(false)
  })

  it('lets the same writes through once the password lands', async () => {
    const unlocked = await call('locks.unlock', {
      target: 'space',
      id: spaceId,
      password: 'longpassword1',
    })
    expect(unlocked.statusCode).toBe(200)

    expect((await call('pages.rename', { pageId, title: 'Bank (2026)' })).statusCode).toBe(200)
    const added = await call('pages.create', { spaceId, parentId: null, title: 'Mortgage' })
    expect(added.statusCode).toBe(200)

    const tree = data(await query('pages.tree', { spaceId }))
    expect(tree.map((p: { title: string }) => p.title).sort()).toEqual(['Bank (2026)', 'Mortgage'])
  })

  it('locks a single page inside an open notebook the same way', async () => {
    const openSpace = data(
      await call('spaces.create', { name: 'Open', category: 'notebook', personal: true }),
    )
    const secret = data(
      await call('pages.create', { spaceId: openSpace.id, parentId: null, title: 'Diary' }),
    )
    const sibling = data(
      await call('pages.create', { spaceId: openSpace.id, parentId: null, title: 'Shopping' }),
    )
    await call('locks.set', {
      target: 'page',
      id: secret.id,
      policy: 'session',
      password: 'longpassword1',
    })
    await call('locks.lockNow', { target: 'page', id: secret.id })

    const blocked = await call('pages.rename', { pageId: secret.id, title: 'Nope' })
    expect(blocked.statusCode).toBe(403)
    expect(errorOf(blocked)).toBe('LOCKED')
    // a locked page does not freeze the notebook around it
    expect(
      (await call('pages.rename', { pageId: sibling.id, title: 'Groceries' })).statusCode,
    ).toBe(200)
    // …nor can it be moved out from under its own lock
    const moved = await call('pages.move', { pageId: secret.id, parentId: null, index: 0 })
    expect(moved.statusCode).toBe(403)
  })
})
