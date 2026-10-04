import { mkdtempSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { apiBase, chunkText, createAiClient, keywords, parseTags, withoutThinking } from './ai'
import type { AiIndex } from './ai'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import type { createDailyService } from './daily'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { type Repo, type UserRow, createRepo } from './repo'
import { buildServer } from './server'
import type { SettingsService } from './settings'
import type { createTasksService } from './tasks'

// ---- a stand-in model server (the OpenAI-compatible API Ollama serves) ----

/** Words hashed into a small vector: texts sharing words point the same way. */
function wordVector(text: string): number[] {
  const v = new Array(64).fill(0)
  for (const w of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    let h = 0
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0
    v[h % 64] += 1
  }
  return v
}

type FakeModel = {
  url: string
  chats: Array<{ model: string; messages: Array<{ role: string; content: string }> }>
  embeds: string[][]
  /** what the chat model says (pieces are streamed one by one) */
  reply: (messages: Array<{ role: string; content: string }>) => string[]
  missing: Set<string>
  close: () => Promise<void>
}

async function fakeModelServer(): Promise<FakeModel> {
  const fake = {
    chats: [],
    embeds: [],
    reply: () => ['The tomatoes went in on ', 'Saturday [1].'],
    missing: new Set<string>(),
  } as unknown as FakeModel
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {}
      if (json.model && fake.missing.has(json.model)) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: { message: `model "${json.model}" not found, try pulling it first` },
          }),
        )
        return
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'llama3.2' }, { id: 'nomic-embed-text' }] }))
      } else if (req.url === '/v1/embeddings') {
        const input = json.input as string[]
        fake.embeds.push(input)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            data: input.map((t, index) => ({ index, embedding: wordVector(t) })),
          }),
        )
      } else if (req.url === '/v1/chat/completions') {
        fake.chats.push({ model: json.model, messages: json.messages })
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const piece of fake.reply(json.messages)) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
        }
        res.end('data: [DONE]\n\n')
      } else {
        res.writeHead(404)
        res.end()
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  fake.close = () => new Promise((r) => server.close(() => r()))
  return fake
}

/** Server-sent events out of a response body. */
function events(body: string): Array<{ event: string; data: any }> {
  return body
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [ev, data] = b.split('\n')
      return { event: (ev ?? '').slice(7), data: JSON.parse((data ?? '').slice(6)) }
    })
}

const para = (id: string, text: string) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
})

describe('AI helpers', () => {
  it('finds the API root of Ollama and other servers', () => {
    expect(apiBase('http://localhost:11434')).toBe('http://localhost:11434/v1')
    expect(apiBase('http://localhost:11434/')).toBe('http://localhost:11434/v1')
    expect(apiBase('http://box:1234/v1/')).toBe('http://box:1234/v1')
    expect(() => apiBase('localhost:11434')).toThrow(/http/)
    expect(() => apiBase('ftp://box')).toThrow(/http/)
  })

  it('cuts pages into passages between paragraphs, with the title on each', () => {
    const text = ['a'.repeat(500), 'b'.repeat(500), 'c'.repeat(500)].join('\n')
    const parts = chunkText('Garden', text, 1200)
    expect(parts).toHaveLength(2)
    expect(parts[0]?.startsWith('Garden\n')).toBe(true)
    expect(parts[1]).toContain('ccc')
    // one huge paragraph is still cut
    expect(chunkText('', 'x'.repeat(3000), 1200).length).toBe(3)
    expect(chunkText('Only a title', '')).toEqual(['Only a title'])
    expect(chunkText('', '  ')).toEqual([])
  })

  it('looks for the words that matter in a question', () => {
    // longest first; equal lengths in the order asked
    expect(keywords('What did I plant in the garden in March?')).toEqual([
      'garden',
      'plant',
      'march',
    ])
  })

  it('reads tags out of whatever the model said', () => {
    expect(parseTags('{"tags": ["Garden", "#seeds", "spring time"]}', new Set())).toEqual([
      'garden',
      'seeds',
      'spring-time',
    ])
    expect(parseTags('Sure! ```json\n["work","work","a b"]\n```', new Set(['work']))).toEqual([
      'a-b',
    ])
    expect(parseTags('recipes, dinner', new Set())).toEqual(['recipes', 'dinner'])
    expect(parseTags('{"tags": ["ok", "no spaces!", "x"]}', new Set())).toEqual(['ok', 'x'])
  })

  it("drops a model's thinking, even split across pieces", async () => {
    async function* pieces() {
      yield 'Hello <th'
      yield 'ink>hmm, let me'
      yield ' think</thi'
      yield 'nk>\nworld <b>'
    }
    let out = ''
    for await (const p of withoutThinking(pieces())) out += p
    expect(out).toBe('Hello world <b>')
  })

  it('explains a missing model the way Ollama users fix it', async () => {
    const fake = await fakeModelServer()
    fake.missing.add('llama9')
    const client = createAiClient(() => ({
      baseUrl: fake.url,
      apiKey: '',
      chatModel: 'llama9',
      embedModel: '',
    }))
    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'ollama pull llama9',
    )
    const down = createAiClient(() => ({
      baseUrl: 'http://127.0.0.1:9',
      apiKey: '',
      chatModel: 'x',
      embedModel: '',
    }))
    await expect(down.models()).rejects.toThrow(/Couldn't reach the AI server/)
    await fake.close()
  })
})

describe('AI in the app', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null
  let fake: FakeModel | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await fake?.close()
    fake = null
    await appDb?.close()
  })

  async function boot(opts: { embed?: boolean; on?: boolean } = {}) {
    fake = await fakeModelServer()
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-ai-')),
      }),
      appDb,
    )
    const services = (server as any).bnServices
    const repo = services.repo as Repo
    const pages = services.pages as ReturnType<typeof createPagesService>
    const daily = services.daily as ReturnType<typeof createDailyService>
    const tasks = services.tasks as ReturnType<typeof createTasksService>
    const settings = services.settings as SettingsService
    const aiIndex = services.aiIndex as AiIndex
    const auth = createAuthService(repo)
    const { user: owner, session } = await auth.setup({
      name: 'Owner',
      email: 'o@x.dev',
      password: 'longpassword1',
    })
    const { token } = await auth.createInvite(owner.id, { role: 'member' })
    const { user: bo, session: boSession } = await auth.acceptInvite({
      token,
      name: 'Bo',
      email: 'bo@x.dev',
      password: 'bopassword12',
    })
    if (opts.on !== false) {
      await settings.saveAi({
        enabled: true,
        baseUrl: fake.url,
        apiKey: '',
        chatModel: 'llama3.2',
        embedModel: opts.embed === false ? '' : 'nomic-embed-text',
      })
    }
    const write = async (user: UserRow, spaceId: string, title: string, text: string) => {
      const page = await pages.createPage(user, { spaceId, parentId: null, title })
      const { doc } = await pages.getPage(user, page.id)
      await pages.saveDocument(user, {
        pageId: page.id,
        content: JSON.stringify([para(`${page.id.slice(0, 8)}a`, text)]),
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })
      return page
    }
    const shared = await pages.createSpace(owner, {
      name: 'Garden',
      category: 'notebook',
      personal: false,
    })
    const mine = await pages.createSpace(bo, {
      name: 'Bo private',
      category: 'notebook',
      personal: true,
    })
    const planting = await write(
      owner,
      shared.id,
      'Planting log',
      'Tomatoes planted on Saturday in the raised bed.',
    )
    const recipes = await write(
      owner,
      shared.id,
      'Recipes',
      'Basil pesto with pine nuts and garlic.',
    )
    const secret = await write(bo, mine.id, 'Diary', 'Tomatoes are my secret obsession.')
    const lockedPage = await write(owner, shared.id, 'Locked tomatoes', 'Tomatoes behind a lock.')
    await repo.setPageLock(lockedPage.id, 'session')
    return {
      repo,
      pages,
      daily,
      tasks,
      settings,
      aiIndex,
      owner,
      bo,
      shared,
      planting,
      recipes,
      secret,
      lockedPage,
      ownerCookie: `bn_session=${session.token}`,
      boCookie: `bn_session=${boSession.token}`,
      fake: fake as FakeModel,
    }
  }

  const post = (url: string, cookie: string, body: unknown) =>
    (server as NonNullable<typeof server>).inject({
      method: 'POST',
      url,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    })
  const trpc = (path: string, cookie: string, input?: unknown, method: 'GET' | 'POST' = 'POST') =>
    (server as NonNullable<typeof server>).inject({
      method,
      url:
        method === 'GET'
          ? `/api/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`
          : `/api/trpc/${path}`,
      headers: { cookie, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      payload: method === 'POST' ? JSON.stringify(input ?? {}) : undefined,
    })

  it('answers from what the asker may read, with sources, by meaning', async () => {
    const b = await boot()
    await b.aiIndex.run()
    const status = await b.aiIndex.status()
    expect(status).toMatchObject({ model: 'nomic-embed-text', pending: 0, lastError: null })
    // the locked page never went to the model
    expect(b.fake.embeds.flat().join(' ')).not.toContain('behind a lock')
    expect(b.fake.embeds.flat()[0]?.startsWith('search_document: ')).toBe(true)

    const res = await post('/api/ai/ask', b.ownerCookie, {
      question: 'When were the tomatoes planted?',
    })
    expect(res.headers['content-type']).toContain('text/event-stream')
    const ev = events(res.body)
    expect(ev.map((e) => e.event)).toEqual(['sources', 'text', 'text', 'done'])
    const sources = ev[0]?.data.sources as Array<{ n: number; title: string; context: string }>
    expect(sources[0]).toMatchObject({ n: 1, title: 'Planting log', context: 'Garden' })
    const titles = sources.map((s) => s.title)
    expect(titles).not.toContain('Diary') // Bo's personal notebook
    expect(titles).not.toContain('Locked tomatoes')
    expect(
      ev
        .filter((e) => e.event === 'text')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('The tomatoes went in on Saturday [1].')
    const sent = JSON.stringify(b.fake.chats[0]?.messages)
    expect(sent).toContain('Tomatoes planted on Saturday')
    expect(sent).not.toContain('secret obsession')
    expect(sent).not.toContain('behind a lock')
    expect(b.fake.chats[0]?.model).toBe('llama3.2')

    // Bo reads their own diary, and the shared notebook
    const boAsk = events((await post('/api/ai/ask', b.boCookie, { question: 'tomatoes?' })).body)
    const boTitles = (boAsk[0]?.data.sources as Array<{ title: string }>).map((s) => s.title)
    expect(boTitles).toEqual(expect.arrayContaining(['Diary', 'Planting log']))
  })

  it('keeps up with edits, the bin and a change of model', async () => {
    const b = await boot()
    await b.aiIndex.run()
    const embedded = b.fake.embeds.flat().length
    await b.aiIndex.run()
    expect(b.fake.embeds.flat().length).toBe(embedded) // nothing changed, nothing re-sent

    const { doc } = await b.pages.getPage(b.owner, b.recipes.id)
    await b.pages.saveDocument(b.owner, {
      pageId: b.recipes.id,
      content: JSON.stringify([para('r1', 'Tomato sauce, slow cooked.')]),
      baseUpdatedAt: doc.updatedAt.toISOString(),
    })
    await b.aiIndex.run()
    expect(b.fake.embeds.flat().at(-1)).toContain('Tomato sauce')
    const pagesBefore = (await b.aiIndex.status()).pages

    await b.pages.trashPage(b.owner, b.recipes.id)
    await b.aiIndex.run()
    expect((await b.aiIndex.status()).pages).toBe(pagesBefore - 1)

    // another embedding model: everything again
    await b.settings.saveAi({
      enabled: true,
      baseUrl: b.fake.url,
      apiKey: '',
      chatModel: 'llama3.2',
      embedModel: 'mxbai-embed-large',
    })
    const before = b.fake.embeds.flat().length
    await b.aiIndex.run()
    expect((await b.aiIndex.status()).model).toBe('mxbai-embed-large')
    expect(b.fake.embeds.flat().length - before).toBe(pagesBefore - 1)
  })

  it('finds notes by their words when there is no embedding model', async () => {
    const b = await boot({ embed: false })
    const ev = events(
      (await post('/api/ai/ask', b.ownerCookie, { question: 'How do I make pesto?' })).body,
    )
    expect(ev[0]?.data.sources.map((s: { title: string }) => s.title)).toEqual(['Recipes'])
    expect(b.fake.embeds).toHaveLength(0)
    // a follow-up is looked up together with what it follows
    await post('/api/ai/ask', b.ownerCookie, {
      question: 'and what goes in it?',
      history: [{ question: 'How do I make pesto?', answer: 'Basil [1].' }],
    })
    const last = b.fake.chats.at(-1)?.messages ?? []
    expect(last.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(last.at(-1)?.content).toContain('Basil pesto')
  })

  it('sums up a day: journal, finished tasks and the Inbox', async () => {
    const b = await boot()
    const today = new Date().toISOString().slice(0, 10)
    await b.daily.appendToDay(b.owner, today, 'Dentist at 9, then a long walk by the river.')
    await b.daily.capture(b.owner, 'Idea: a cold frame for the seedlings')
    await b.daily.quickAddTask(b.owner, 'Buy compost')
    const [task] = (await b.repo.listAllTasks()).filter((t) => t.text === 'Buy compost')
    await b.tasks.toggle(b.owner, task?.id as string, true)
    b.fake.reply = () => ['You went to the dentist.\n- Bought compost']

    const res = await post('/api/ai/summary', b.ownerCookie, {
      kind: 'day',
      date: today,
      tzOffset: 0,
    })
    const ev = events(res.body)
    expect(
      ev
        .filter((e) => e.event === 'text')
        .map((e) => e.data.text)
        .join(''),
    ).toContain('dentist')
    const prompt = b.fake.chats.at(-1)?.messages.at(-1)?.content ?? ''
    expect(prompt).toContain('long walk by the river')
    expect(prompt).toContain('Buy compost')
    expect(prompt).toContain('cold frame')

    // kept: it goes at the end of the day's page
    const kept = await trpc('ai.addToDay', b.ownerCookie, {
      date: today,
      markdown: 'You went to the dentist.\n\n- Bought compost',
    })
    expect(kept.statusCode).toBe(200)
    const day = await b.daily.day(b.owner, today)
    expect(day.doc.content).toContain('Bought compost')

    // a day with nothing in it doesn't bother the model
    const calls = b.fake.chats.length
    const empty = events(
      (
        await post('/api/ai/summary', b.ownerCookie, {
          kind: 'week',
          date: '2020-01-01',
          tzOffset: 0,
        })
      ).body,
    )
    expect(empty[0]?.data.text).toContain('Nothing was written down for this week')
    expect(b.fake.chats.length).toBe(calls)
  })

  it('suggests tags for an Inbox item, preferring ones in use', async () => {
    const b = await boot()
    await b.daily.capture(b.owner, 'Seed swap #garden next month')
    const memo = await b.daily.capture(b.owner, 'Try the new tomato variety #garden')
    b.fake.reply = () => ['{"tags": ["garden", "Tomatoes", "seeds"]}']
    const res = await trpc('ai.suggestTags', b.ownerCookie, { memoId: memo.id })
    // already on the item: not suggested again
    expect(res.json().result.data.tags).toEqual(['tomatoes', 'seeds'])
    expect(b.fake.chats.at(-1)?.messages.at(-1)?.content).toContain('Existing tags: garden')
    // someone else's item
    const other = await trpc('ai.suggestTags', b.boCookie, { memoId: memo.id })
    expect(other.statusCode).toBe(400)
  })

  it('is off until set up, and admins manage it', async () => {
    const b = await boot({ on: false })
    expect((await trpc('ai.status', b.ownerCookie, undefined, 'GET')).json().result.data).toEqual({
      enabled: false,
      semantic: false,
    })
    expect((await post('/api/ai/ask', b.ownerCookie, { question: 'hello there' })).statusCode).toBe(
      404,
    )
    expect((await trpc('ai.settings', b.boCookie, undefined, 'GET')).statusCode).toBe(403)

    const saved = await trpc('ai.saveSettings', b.ownerCookie, {
      enabled: true,
      baseUrl: b.fake.url,
      apiKey: 'sk-local-123',
      chatModel: 'llama3.2',
      embedModel: '',
    })
    expect(saved.json().result.data).toMatchObject({ enabled: true, hasKey: true, source: 'db' })
    expect(JSON.stringify(saved.json())).not.toContain('sk-local-123')
    const test = (await trpc('ai.test', b.ownerCookie)).json().result.data
    expect(test).toMatchObject({ ok: true, models: ['llama3.2', 'nomic-embed-text'], chat: null })
    expect((await trpc('ai.status', b.boCookie, undefined, 'GET')).json().result.data).toEqual({
      enabled: true,
      semantic: false,
    })
  })

  it('says what went wrong on the model server', async () => {
    const b = await boot({ embed: false })
    b.fake.missing.add('llama3.2')
    const ev = events((await post('/api/ai/ask', b.ownerCookie, { question: 'pesto please' })).body)
    expect(ev.at(-1)).toMatchObject({ event: 'error' })
    expect(ev.at(-1)?.data.message).toContain('ollama pull llama3.2')
  })
})

// The index's queries on every dialect (Postgres when TEST_PG_URL is set).
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

for (const dialect of dialects) {
  describe(`AI index tables (${dialect.name})`, () => {
    it('stores passages and vectors, and reports what it holds', async () => {
      const db = await dialect.make()
      const repo = createRepo(db)
      const auth = createAuthService(repo)
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const pages = createPagesService(repo)
      const space = await pages.createSpace(user, {
        name: 'S',
        category: 'notebook',
        personal: false,
      })
      const page = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'P' })
      const at = new Date('2026-10-01T10:00:00.123Z')
      const vec = Float32Array.from([0.6, 0.8, 0])
      const row = (seq: number) => ({
        id: `c${seq}`,
        pageId: page.id,
        spaceId: space.id,
        seq,
        text: `passage ${seq}`,
        model: 'nomic-embed-text',
        vector: new Uint8Array(vec.buffer),
        sourceAt: at,
      })
      await repo.replaceAiChunks(page.id, [row(0), row(1)])
      const heads = await repo.listAiIndexHeads()
      expect(heads).toEqual([
        { pageId: page.id, model: 'nomic-embed-text', sourceAt: at, chunks: 2 },
      ])
      const back = await repo.listAiChunks('nomic-embed-text')
      expect(back.map((r) => r.text).sort()).toEqual(['passage 0', 'passage 1'])
      const copy = new Uint8Array(back[0]?.vector as Uint8Array)
      expect(Array.from(new Float32Array(copy.buffer))).toEqual(Array.from(vec))
      await repo.replaceAiChunks(page.id, [row(5)])
      expect((await repo.listAiIndexHeads())[0]?.chunks).toBe(1)
      expect(await repo.listAiChunks('other-model')).toEqual([])
      await repo.deleteAllAiChunks()
      expect(await repo.listAiIndexHeads()).toEqual([])
      await db.close()
    })
  })
}
