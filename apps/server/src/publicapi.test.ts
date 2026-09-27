import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApiTokenService } from './apitokens'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'
import { buildServer } from './server'

describe('public API (REST + MCP) through the real server', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await appDb?.close()
  })

  async function boot() {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-api-')),
      }),
      appDb,
    )
    const repo = createRepo(appDb)
    const auth = createAuthService(repo)
    const tokens = createApiTokenService({ repo })
    const pages = createPagesService(repo)
    const { user: owner } = await auth.setup({
      name: 'Owner',
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    const write = (await tokens.create(owner, { name: 'script', scope: 'write' })).token
    const read = (await tokens.create(owner, { name: 'reader', scope: 'read' })).token
    return { repo, auth, tokens, pages, owner, write, read }
  }

  async function http(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    token: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    if (!server) throw new Error('boot first')
    const res = await server.inject({
      method,
      url,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: res.statusCode, body: res.body ? res.json() : null }
  }

  it('turns away missing, unknown, revoked and expired tokens', async () => {
    const { repo, tokens, owner, write } = await boot()
    expect((await http('GET', '/api/v1/me', null)).status).toBe(401)
    expect((await http('GET', '/api/v1/me', 'bn_not-a-real-token')).status).toBe(401)
    expect((await http('GET', '/api/v1/me', write)).body).toMatchObject({ email: 'owner@home.lan' })

    const doomed = await tokens.create(owner, { name: 'x', scope: 'read' })
    await repo.revokeApiToken(doomed.row.id, owner.id, new Date())
    expect((await http('GET', '/api/v1/me', doomed.token)).status).toBe(401)

    const clock = { now: new Date() }
    const shortLived = await createApiTokenService({ repo, now: () => clock.now }).create(owner, {
      name: 'y',
      scope: 'read',
      expiresInDays: 1,
    })
    expect((await http('GET', '/api/v1/me', shortLived.token)).status).toBe(200)
    clock.now = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const later = await createApiTokenService({ repo, now: () => clock.now }).authenticate(
      shortLived.token,
    )
    expect(later).toBeNull()
  })

  it('creates, reads, appends to and finds a page as Markdown; read tokens cannot write', async () => {
    const { pages, owner, write, read } = await boot()
    const space = await pages.createSpace(owner, {
      name: 'Wiki',
      category: 'wiki',
      personal: false,
    })

    const denied = await http('POST', '/api/v1/pages', read, { spaceId: space.id, title: 'Nope' })
    expect(denied.status).toBe(403)

    const created = await http('POST', '/api/v1/pages', write, {
      spaceId: space.id,
      title: 'Backups',
      markdown: '# Plan\n\nRun restic every night.\n\n- [ ] test a restore',
    })
    expect(created.status).toBe(200)
    expect(created.body.markdown).toContain('Run restic every night.')
    const id = created.body.id as string

    const appended = await http('PATCH', `/api/v1/pages/${id}`, write, {
      markdown: 'Offsite copy goes to B2.',
      mode: 'append',
    })
    expect(appended.body.markdown).toMatch(
      /Run restic every night\.[\s\S]*Offsite copy goes to B2\./,
    )

    const listed = await http('GET', `/api/v1/spaces/${space.id}/pages`, read)
    expect(listed.body).toEqual([expect.objectContaining({ id, title: 'Backups', locked: false })])

    const found = await http('GET', '/api/v1/search?q=restic', read)
    expect(found.body[0]).toMatchObject({ kind: 'page', id, where: 'Wiki' })

    // the checklist item became a real task
    const tasks = await http('GET', '/api/v1/tasks', read)
    expect(tasks.body).toEqual([expect.objectContaining({ text: 'test a restore', pageId: id })])
  })

  it("keeps someone else's personal space and locked pages out of reach", async () => {
    const { repo, auth, pages, owner, write } = await boot()
    const invite = await auth.createInvite(owner.id, { role: 'member' })
    const { user: kid } = await auth.acceptInvite({
      token: invite.token,
      name: 'Kid',
      email: 'kid@home.lan',
      password: 'longpassword1',
    })
    const diary = await pages.createSpace(kid, {
      name: 'Diary',
      category: 'notebook',
      personal: true,
    })
    const secret = await pages.createPage(kid, {
      spaceId: diary.id,
      parentId: null,
      title: 'Secret',
    })
    expect((await http('GET', `/api/v1/pages/${secret.id}`, write)).status).toBe(404)

    const shared = await pages.createSpace(owner, {
      name: 'Home',
      category: 'notebook',
      personal: false,
    })
    const made = await http('POST', '/api/v1/pages', write, {
      spaceId: shared.id,
      title: 'Wifi',
      markdown: 'The password is hunter2',
    })
    await repo.setPageLock(made.body.id, 'session', null)

    expect((await http('GET', `/api/v1/pages/${made.body.id}`, write)).status).toBe(423)
    expect(
      (await http('PATCH', `/api/v1/pages/${made.body.id}`, write, { markdown: 'x' })).status,
    ).toBe(423)
    // listed (titles travel, as in the app) but flagged, and never in search
    const listed = await http('GET', `/api/v1/spaces/${shared.id}/pages`, write)
    expect(listed.body[0]).toMatchObject({ title: 'Wifi', locked: true })
    expect((await http('GET', '/api/v1/search?q=hunter2', write)).body).toEqual([])
  })

  it('reads and appends to the journal, adds tasks and captures to the inbox', async () => {
    const { write } = await boot()
    const day = await http('POST', '/api/v1/journal/2026-09-26', write, {
      markdown: 'Set up **SSO** with Authentik.',
    })
    expect(day.status).toBe(200)
    expect(day.body.markdown).toContain('Set up **SSO** with Authentik.')
    expect((await http('GET', '/api/v1/journal/2026-09-26', write)).body.markdown).toContain(
      'Authentik',
    )
    expect((await http('GET', '/api/v1/journal/26-09-2026', write)).status).toBe(400)

    await http('POST', '/api/v1/tasks', write, { text: 'Renew the domain @2026-10-01' })
    const tasks = await http('GET', '/api/v1/tasks', write)
    expect(tasks.body).toEqual([
      expect.objectContaining({ text: 'Renew the domain @2026-10-01', due: '2026-10-01' }),
    ])

    const memo = await http('POST', '/api/v1/inbox', write, { text: 'Look at Pocket ID' })
    expect(memo.body.id).toBeTruthy()
    expect((await http('GET', '/api/v1/search?q=pocket', write)).body[0]).toMatchObject({
      kind: 'inbox',
    })
  })

  it('serves an OpenAPI description without a token', async () => {
    await boot()
    const spec = await http('GET', '/api/v1/openapi.json', null)
    expect(spec.status).toBe(200)
    expect(spec.body.openapi).toBe('3.0.3')
    expect(Object.keys(spec.body.paths)).toContain('/api/v1/pages/{id}')
  })

  describe('MCP', () => {
    const mcp = (token: string | null, body: unknown) =>
      http('POST', '/api/mcp', token, body, { accept: 'application/json, text/event-stream' })

    it('initializes, lists tools by scope, and calls them', async () => {
      const { pages, owner, write, read } = await boot()
      const init = await mcp(write, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      })
      expect(init.status).toBe(200)
      expect(init.body.result.serverInfo.name).toBe('beyond-notes')

      const toolNames = async (token: string) =>
        (
          (await mcp(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result
            .tools as Array<{
            name: string
          }>
        ).map((t) => t.name)
      expect(await toolNames(write)).toEqual(
        expect.arrayContaining(['search_notes', 'read_page', 'create_page', 'append_to_journal']),
      )
      const readTools = await toolNames(read)
      expect(readTools).toContain('search_notes')
      expect(readTools).not.toContain('create_page')

      const space = await pages.createSpace(owner, {
        name: 'Lab',
        category: 'wiki',
        personal: false,
      })
      const call = await mcp(write, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_page',
          arguments: { space_id: space.id, title: 'Proxmox', markdown: 'Node pve1 runs the NAS.' },
        },
      })
      expect(call.body.result.isError).toBeFalsy()

      const search = await mcp(read, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'search_notes', arguments: { query: 'pve1' } },
      })
      expect(search.body.result.content[0].text).toContain('Proxmox')

      const bad = await mcp(read, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'read_page', arguments: { page_id: 'nope' } },
      })
      expect(bad.body.result.isError).toBe(true)
      expect(bad.body.result.content[0].text).toMatch(/No such page/)
    })

    it('needs a token', async () => {
      await boot()
      expect((await mcp(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401)
    })
  })
})
