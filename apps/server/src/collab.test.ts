import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blocksToYXmlFragment, yXmlFragmentToBlocks } from '@blocknote/core/yjs'
import { COLLAB_FRAGMENT, headlessEditor } from '@bn/editor'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import type { AccessService } from './access'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import type { ServerEdition } from './edition'
import type { createPagesService } from './pages'
import { type Repo, createRepo } from './repo'
import { buildServer } from './server'
import type { createTasksService } from './tasks'

const editor = headlessEditor()
const para = (id: string, text: string) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
})
const task = (id: string, text: string, checked: boolean) => ({
  id,
  type: 'checkListItem',
  props: { checked },
  content: [{ type: 'text', text, styles: {} }],
  children: [],
})
const textOf = (doc: Y.Doc) =>
  yXmlFragmentToBlocks(editor, doc.getXmlFragment(COLLAB_FRAGMENT))
    .map((b: any) => (b.content as Array<{ text?: string }>).map((c) => c.text ?? '').join(''))
    .join('|')
const until = async (ok: () => boolean | Promise<boolean>, ms = 4000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await ok()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

describe('live co-editing', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null
  const open: HocuspocusProvider[] = []
  const sockets: HocuspocusProviderWebsocket[] = []

  afterEach(async () => {
    for (const p of open.splice(0)) p.destroy()
    for (const s of sockets.splice(0)) s.destroy()
    await server?.close()
    server = null
    await appDb?.close()
  })

  async function boot(features: string[] = ['collab.live']) {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const edition: ServerEdition = {
      name: 'test',
      register() {},
      info: () => ({ name: 'test', label: 'Test', features, status: null, attention: false }),
    }
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-collab-')),
        COLLAB_SAVE_DELAY_MS: '50',
      }),
      appDb,
      { edition },
    )
    await server.listen({ port: 0, host: '127.0.0.1' })
    const port = (server.server.address() as { port: number }).port
    const services = (server as any).bnServices
    const repo = services.repo as Repo
    const pages = services.pages as ReturnType<typeof createPagesService>
    const tasks = services.tasks as ReturnType<typeof createTasksService>
    const access = services.access as AccessService
    const auth = createAuthService(repo)
    const { user: owner, session } = await auth.setup({
      name: 'Owner',
      email: 'o@x.dev',
      password: 'longpassword1',
    })
    const { token: invite } = await auth.createInvite(owner.id, { role: 'member' })
    const { user: ana, session: anaSession } = await auth.acceptInvite({
      token: invite,
      name: 'Ana',
      email: 'ana@x.dev',
      password: 'anapassword1',
    })
    const space = await pages.createSpace(owner, {
      name: 'Family',
      category: 'notebook',
      personal: true,
    })
    const page = await pages.createPage(owner, { spaceId: space.id, parentId: null, title: 'Plan' })
    const { doc } = await pages.getPage(owner, page.id)
    await pages.saveDocument(owner, {
      pageId: page.id,
      content: JSON.stringify([para('p1', 'Saturday: market'), task('t1', 'buy bread', false)]),
      baseUpdatedAt: doc.updatedAt.toISOString(),
    })
    return {
      port,
      repo,
      pages,
      tasks,
      access,
      owner,
      ana,
      space,
      page,
      ownerCookie: `bn_session=${session.token}`,
      anaCookie: `bn_session=${anaSession.token}`,
    }
  }

  /** A browser-like client: its own socket (with the session cookie) and document. */
  function client(port: number, cookie: string | null, pageId: string) {
    const socket = new HocuspocusProviderWebsocket({
      url: `ws://127.0.0.1:${port}/api/collab`,
      WebSocketPolyfill: class extends WebSocket {
        constructor(url: string, protocols?: string | string[]) {
          super(url, protocols, cookie ? { headers: { cookie } } : {})
        }
      },
      maxAttempts: 1,
    })
    const doc = new Y.Doc()
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: pageId,
      document: doc,
    })
    // a provider on a shared socket has to be attached to it
    provider.attach()
    sockets.push(socket)
    open.push(provider)
    return { doc, provider }
  }

  /** Replace a client's whole document, as an edit would. */
  const write = (doc: Y.Doc, blocks: any[]) =>
    doc.transact(() => {
      const f = doc.getXmlFragment(COLLAB_FRAGMENT)
      f.delete(0, f.length)
      blocksToYXmlFragment(editor, blocks as never, f)
    })

  it('shares edits between two people and saves them like any edit', async () => {
    const { port, repo, page, ownerCookie, anaCookie, access, space, ana } = await boot()
    await access.share({ space, principalType: 'user', principalId: ana.id, role: 'editor' })
    const a = client(port, ownerCookie, page.id)
    const b = client(port, anaCookie, page.id)
    expect(await until(() => a.provider.isSynced && b.provider.isSynced)).toBe(true)
    // both start from the saved page
    expect(textOf(a.doc)).toBe('Saturday: market|buy bread')
    expect(textOf(b.doc)).toBe('Saturday: market|buy bread')

    write(a.doc, [para('p1', 'Saturday: market and park'), task('t1', 'buy bread', true)])
    expect(await until(() => textOf(b.doc) === 'Saturday: market and park|buy bread')).toBe(true)

    // a moment later it is the page's saved content, reindexed
    expect(
      await until(async () =>
        ((await repo.getDocument(page.id))?.content ?? '').includes('and park'),
      ),
    ).toBe(true)
    expect(
      await until(async () => (await repo.listTasksForPage(page.id)).some((t) => t.checked)),
    ).toBe(true)
  })

  it('brings open copies along when something else writes the page', async () => {
    const { port, page, ownerCookie, tasks, owner, repo } = await boot()
    const a = client(port, ownerCookie, page.id)
    expect(await until(() => a.provider.isSynced)).toBe(true)
    const [t] = await repo.listTasksForPage(page.id)
    // ticked from the agenda while the page is open
    await tasks.toggle(owner, t?.id as string, true)
    expect(
      await until(() =>
        JSON.stringify(
          yXmlFragmentToBlocks(editor, a.doc.getXmlFragment(COLLAB_FRAGMENT)),
        ).includes('"checked":true'),
      ),
    ).toBe(true)
  })

  it('keeps viewers read-only', async () => {
    const { port, repo, page, ownerCookie, anaCookie, access, space, ana } = await boot()
    await access.share({ space, principalType: 'user', principalId: ana.id, role: 'viewer' })
    const owner = client(port, ownerCookie, page.id)
    const viewer = client(port, anaCookie, page.id)
    expect(await until(() => owner.provider.isSynced && viewer.provider.isSynced)).toBe(true)
    write(viewer.doc, [para('p1', 'VANDALISED')])
    await new Promise((r) => setTimeout(r, 400))
    expect(textOf(owner.doc)).toBe('Saturday: market|buy bread')
    expect((await repo.getDocument(page.id))?.content).not.toContain('VANDALISED')
  })

  it('refuses strangers, signed-out sockets, and everyone when the feature is off', async () => {
    const { port, page, anaCookie } = await boot()
    // Ana has no access to the owner's personal notebook
    const stranger = client(port, anaCookie, page.id)
    const anon = client(port, null, page.id)
    await new Promise((r) => setTimeout(r, 600))
    expect(stranger.provider.isSynced).toBe(false)
    expect(textOf(stranger.doc)).toBe('')
    expect(anon.provider.isSynced).toBe(false)
  })

  it('is off without the licence feature', async () => {
    const { port, page, ownerCookie } = await boot([])
    const a = client(port, ownerCookie, page.id)
    await new Promise((r) => setTimeout(r, 600))
    expect(a.provider.isSynced).toBe(false)
    expect(textOf(a.doc)).toBe('')
  })

  it('picks up where it left off, unless the page changed in between', async () => {
    const { port, page, ownerCookie, pages, owner, repo } = await boot()
    const a = client(port, ownerCookie, page.id)
    expect(await until(() => a.provider.isSynced)).toBe(true)
    write(a.doc, [para('p1', 'second draft')])
    expect(
      await until(async () =>
        ((await repo.getDocument(page.id))?.content ?? '').includes('second draft'),
      ),
    ).toBe(true)
    expect(await until(async () => Boolean(await repo.getLiveState(page.id)))).toBe(true)
    a.provider.destroy()

    // changed outside live editing while nobody had it open
    const { doc } = await pages.getPage(owner, page.id)
    await pages.saveDocument(owner, {
      pageId: page.id,
      content: JSON.stringify([para('p1', 'edited in the API')]),
      baseUpdatedAt: doc.updatedAt.toISOString(),
    })
    const b = client(port, ownerCookie, page.id)
    expect(await until(() => b.provider.isSynced)).toBe(true)
    expect(await until(() => textOf(b.doc) === 'edited in the API')).toBe(true)
  })
})
