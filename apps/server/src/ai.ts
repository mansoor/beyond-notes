/**
 * AI on your own model server: Ask your notes, summaries of a day or week, and
 * tag suggestions for Inbox items. Off until an admin points it at a server
 * (Settings → AI, or AI_BASE_URL + AI_CHAT_MODEL).
 *
 * It speaks the OpenAI-compatible API that Ollama, LM Studio, llama.cpp and
 * vLLM all serve, so "local" is whatever the admin runs. Notes go to that
 * server and nowhere else, and only what the asking person may read: the
 * same access rules as everywhere (access.ts), and locked pages never at all.
 *
 * Ask finds notes in two ways. With an embedding model, every page is cut
 * into passages and kept as vectors (ai_chunks, rebuilt as pages change), and
 * a question finds passages by meaning. Without one, or alongside it, pages
 * that contain the question's words are used.
 */
import { plainText } from '@bn/renderer'
import { nanoid } from 'nanoid'
import type { AccessService } from './access'
import type { AiChunkRow, PageRow, Repo, UserRow } from './repo'
import { extractTagsFromText } from './tags'

export class AiError extends Error {}

export type AiConfig = {
  baseUrl: string
  apiKey: string
  chatModel: string
  embedModel: string
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** The API root: a bare server address gets /v1 (Ollama's OpenAI-compatible path). */
export function apiBase(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new AiError(`"${url}" isn't a web address. It looks like http://localhost:11434.`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new AiError('The AI server address has to start with http:// or https://.')
  }
  const path = u.pathname.replace(/\/+$/, '')
  return `${u.origin}${path || '/v1'}`
}

const reason = (err: unknown) => {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (e?.name === 'TimeoutError') return 'it took too long to answer'
  return e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(err)
}

/** Unit length, so cosine similarity is a dot product. */
function normalise(v: number[]): Float32Array {
  let sum = 0
  for (const x of v) sum += x * x
  const len = Math.sqrt(sum) || 1
  return Float32Array.from(v, (x) => x / len)
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += (a[i] as number) * (b[i] as number)
  return s
}

/**
 * Some models think out loud between <think> tags before answering; people
 * want the answer. Filters a stream of text pieces, tags split across pieces
 * included.
 */
export async function* withoutThinking(pieces: AsyncIterable<string>): AsyncGenerator<string> {
  let inside = false
  let held = ''
  for await (const piece of pieces) {
    held += piece
    for (;;) {
      if (inside) {
        const end = held.indexOf('</think>')
        if (end < 0) {
          held = held.slice(-8) // keep enough to spot a split closing tag
          break
        }
        held = held.slice(end + 8).replace(/^\s+/, '')
        inside = false
      } else {
        const start = held.indexOf('<think>')
        if (start >= 0) {
          if (start > 0) yield held.slice(0, start)
          held = held.slice(start + 7)
          inside = true
          continue
        }
        // hold back a possible start of "<think>" at the end
        const cut = held.lastIndexOf('<')
        const keep = cut >= 0 && '<think>'.startsWith(held.slice(cut)) ? cut : held.length
        if (keep > 0) yield held.slice(0, keep)
        held = held.slice(keep)
        break
      }
    }
  }
  if (!inside && held) yield held
}

/** The model server, through its OpenAI-compatible API. */
export function createAiClient(get: () => AiConfig | null, opts: { fetch?: typeof fetch } = {}) {
  const f = opts.fetch ?? fetch
  const cfg = (): AiConfig => {
    const c = get()
    if (!c) throw new AiError('AI is switched off here.')
    return c
  }

  async function call(
    c: AiConfig,
    path: string,
    body: unknown,
    signal: AbortSignal,
    model?: string,
  ): Promise<Response> {
    let res: Response
    try {
      res = await f(`${apiBase(c.baseUrl)}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof AiError) throw err
      throw new AiError(`Couldn't reach the AI server at ${c.baseUrl}: ${reason(err)}.`)
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      let message = raw.slice(0, 300)
      try {
        const j = JSON.parse(raw) as { error?: string | { message?: string } }
        message = typeof j.error === 'string' ? j.error : (j.error?.message ?? message)
      } catch {
        // not JSON: keep the text
      }
      if (res.status === 404 && model && /model/i.test(message)) {
        throw new AiError(
          `The AI server doesn't have the model "${model}". With Ollama, run: ollama pull ${model}`,
        )
      }
      if (res.status === 401 || res.status === 403) {
        throw new AiError('The AI server refused the API key.')
      }
      throw new AiError(`The AI server answered ${res.status}${message ? `: ${message}` : ''}.`)
    }
    return res
  }

  const timeout = (ms: number, signal?: AbortSignal) =>
    signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)

  return {
    /** Model names the server offers. */
    async models(signal?: AbortSignal): Promise<string[]> {
      const c = cfg()
      const res = await call(c, '/models', undefined, timeout(15_000, signal))
      const j = (await res.json()) as { data?: Array<{ id?: string }> }
      return (j.data ?? [])
        .map((m) => m.id ?? '')
        .filter(Boolean)
        .sort()
    },

    /** One vector per text, unit length. */
    async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
      const c = cfg()
      if (!c.embedModel) throw new AiError('No embedding model is set.')
      const res = await call(
        c,
        '/embeddings',
        { model: c.embedModel, input: texts },
        timeout(120_000, signal),
        c.embedModel,
      )
      const j = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> }
      const rows = [...(j.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      if (rows.length !== texts.length) {
        throw new AiError('The AI server sent back the wrong number of embeddings.')
      }
      return rows.map((r) => normalise(r.embedding ?? []))
    },

    /** The answer as it's written, piece by piece. */
    async *stream(
      messages: ChatMessage[],
      o: { signal?: AbortSignal; temperature?: number } = {},
    ): AsyncGenerator<string> {
      const c = cfg()
      // a model loading from disk can take a while before its first word
      const res = await call(
        c,
        '/chat/completions',
        { model: c.chatModel, messages, stream: true, temperature: o.temperature ?? 0.3 },
        timeout(600_000, o.signal),
        c.chatModel,
      )
      if (!res.body) throw new AiError('The AI server sent an empty answer.')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const pieces = async function* () {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          buf += decoder.decode(value, { stream: true })
          for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') return
            try {
              const j = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>
              }
              const piece = j.choices?.[0]?.delta?.content
              if (piece) yield piece
            } catch {
              // a keep-alive or a line we don't know: skip it
            }
          }
        }
      }
      try {
        yield* withoutThinking(pieces())
      } finally {
        await reader.cancel().catch(() => {})
      }
    },

    /** The whole answer at once (short jobs: tags). */
    async complete(
      messages: ChatMessage[],
      o: { signal?: AbortSignal; temperature?: number } = {},
    ): Promise<string> {
      let out = ''
      for await (const piece of this.stream(messages, o)) out += piece
      return out.trim()
    },
  }
}

export type AiClient = ReturnType<typeof createAiClient>

// ---- the passage index ----

/** Instructions some embedding models were trained with. */
function embedPrefix(model: string, kind: 'query' | 'document'): string {
  if (/nomic-embed/i.test(model)) return kind === 'query' ? 'search_query: ' : 'search_document: '
  if (/mxbai-embed/i.test(model) && kind === 'query') {
    return 'Represent this sentence for searching relevant passages: '
  }
  return ''
}

/** A page's text in passages of up to `max` characters, cut between paragraphs. */
export function chunkText(title: string, text: string, max = 1200): string[] {
  const paras = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []
  let cur = ''
  const flush = () => {
    if (cur) out.push(cur)
    cur = ''
  }
  for (const para of paras) {
    if (para.length > max) {
      flush()
      // a very long paragraph: cut at sentence ends, or hard
      let rest = para
      while (rest.length > max) {
        const window = rest.slice(0, max)
        const stop = Math.max(
          window.lastIndexOf('. '),
          window.lastIndexOf('? '),
          window.lastIndexOf('! '),
        )
        const at = stop > max / 2 ? stop + 1 : max
        out.push(rest.slice(0, at).trim())
        rest = rest.slice(at).trim()
      }
      cur = rest
      continue
    }
    if (cur && cur.length + para.length + 1 > max) flush()
    cur = cur ? `${cur}\n${para}` : para
  }
  flush()
  const heading = title.trim()
  if (out.length === 0) return heading ? [heading] : []
  return heading ? out.map((c) => `${heading}\n${c}`) : out
}

type Indexed = {
  spaceId: string
  passages: Array<{ seq: number; text: string; vec: Float32Array }>
}

const toBytes = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
const fromBytes = (b: Uint8Array) => {
  const copy = new Uint8Array(b) // aligned
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4))
}

export function createAiIndex(deps: {
  repo: Repo
  client: AiClient
  /** the embedding model in force, or null (no semantic search) */
  model: () => string | null
  now?: () => Date
}) {
  const { repo, client } = deps
  const now = deps.now ?? (() => new Date())
  let running = false
  let lastRunAt: Date | null = null
  let lastError: string | null = null
  let pending = 0
  let cache: { model: string; pages: Map<string, Indexed> } | null = null

  /** Pages the AI may read at all: not trashed, not locked. */
  async function eligible(): Promise<Map<string, PageRow>> {
    const [pages, spaces, locked] = await Promise.all([
      repo.listAllPages(),
      repo.listSpaces(),
      repo.listLockedPages(),
    ])
    const lockedSpaces = new Set(spaces.filter((s) => s.lockPolicy !== null).map((s) => s.id))
    const lockedPages = new Set(locked.map((p) => p.id))
    return new Map(
      pages
        .filter((p) => !p.trashedAt && !lockedSpaces.has(p.spaceId) && !lockedPages.has(p.id))
        .map((p) => [p.id, p]),
    )
  }

  async function load(model: string): Promise<Map<string, Indexed>> {
    if (cache?.model === model) return cache.pages
    const pages = new Map<string, Indexed>()
    for (const row of await repo.listAiChunks(model)) {
      const entry = pages.get(row.pageId) ?? { spaceId: row.spaceId, passages: [] }
      // an empty page is recorded with a blank passage: nothing to search
      if (row.text)
        entry.passages.push({ seq: row.seq, text: row.text, vec: fromBytes(row.vector) })
      pages.set(row.pageId, entry)
    }
    cache = { model, pages }
    return pages
  }

  return {
    /**
     * Bring the index up to date: new and changed pages get (re)embedded,
     * gone, trashed and locked ones leave. At most `limit` pages per run, so
     * a big first index happens over a few runs.
     */
    async run(limit = 100): Promise<void> {
      const model = deps.model()
      if (!model || running) return
      running = true
      try {
        const [pages, heads, docs] = await Promise.all([
          eligible(),
          repo.listAiIndexHeads(),
          repo.listAllDocuments(),
        ])
        // another model's vectors can't be compared with this one's
        if (heads.some((h) => h.model !== model)) {
          await repo.deleteAllAiChunks()
          cache = null
          heads.length = 0
        }
        const pageCache = await load(model)
        const headOf = new Map(heads.map((h) => [h.pageId, h]))
        for (const h of heads) {
          if (!pages.has(h.pageId)) {
            await repo.deleteAiChunksForPage(h.pageId)
            pageCache.delete(h.pageId)
          }
        }
        const docOf = new Map(docs.map((d) => [d.pageId, d]))
        const todo: Array<{ page: PageRow; at: Date; content: string }> = []
        for (const page of pages.values()) {
          const doc = docOf.get(page.id)
          if (!doc) continue
          const at = new Date(Math.max(doc.updatedAt.getTime(), page.updatedAt.getTime()))
          if (headOf.get(page.id)?.sourceAt.getTime() !== at.getTime()) {
            todo.push({ page, at, content: doc.content })
          }
        }
        pending = todo.length
        for (const item of todo.slice(0, limit)) {
          const passages = chunkText(item.page.title, plainText(item.content))
          const rows: AiChunkRow[] = []
          const vecs: Float32Array[] = []
          for (let i = 0; i < passages.length; i += 16) {
            const batch = passages.slice(i, i + 16)
            vecs.push(
              ...(await client.embed(batch.map((p) => `${embedPrefix(model, 'document')}${p}`))),
            )
          }
          passages.forEach((text, seq) => {
            rows.push({
              id: nanoid(),
              pageId: item.page.id,
              spaceId: item.page.spaceId,
              seq,
              text,
              model,
              vector: toBytes(vecs[seq] as Float32Array),
              sourceAt: item.at,
            })
          })
          // nothing to find on an empty page, but it's recorded as done
          if (rows.length === 0) {
            rows.push({
              id: nanoid(),
              pageId: item.page.id,
              spaceId: item.page.spaceId,
              seq: 0,
              text: '',
              model,
              vector: new Uint8Array(0),
              sourceAt: item.at,
            })
          }
          await repo.replaceAiChunks(item.page.id, rows)
          pageCache.set(item.page.id, {
            spaceId: item.page.spaceId,
            passages: rows
              .filter((r) => r.text)
              .map((r, i) => ({ seq: r.seq, text: r.text, vec: vecs[i] as Float32Array })),
          })
          pending--
        }
        lastError = null
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      } finally {
        lastRunAt = now()
        running = false
      }
    },

    /** Passages closest in meaning to `query`, from pages `allow` lets through. */
    async search(
      query: string,
      allow: (pageId: string, spaceId: string) => boolean,
      k = 8,
    ): Promise<Array<{ pageId: string; text: string; score: number }>> {
      const model = deps.model()
      if (!model) return []
      const pages = await load(model)
      if (pages.size === 0) return []
      const [q] = await client.embed([`${embedPrefix(model, 'query')}${query}`])
      const scored: Array<{ pageId: string; text: string; score: number }> = []
      for (const [pageId, entry] of pages) {
        if (!allow(pageId, entry.spaceId)) continue
        for (const p of entry.passages) {
          scored.push({ pageId, text: p.text, score: dot(q as Float32Array, p.vec) })
        }
      }
      scored.sort((a, b) => b.score - a.score)
      // no more than three passages from one page
      const perPage = new Map<string, number>()
      const out: typeof scored = []
      for (const s of scored) {
        const n = perPage.get(s.pageId) ?? 0
        if (n >= 3) continue
        perPage.set(s.pageId, n + 1)
        out.push(s)
        if (out.length >= k) break
      }
      return out
    },

    async status() {
      const model = deps.model()
      const heads = model ? (await repo.listAiIndexHeads()).filter((h) => h.model === model) : []
      return {
        model,
        pages: heads.length,
        chunks: heads.reduce((n, h) => n + h.chunks, 0),
        pending,
        running,
        lastRunAt: lastRunAt?.toISOString() ?? null,
        lastError,
      }
    },

    /** Forget everything (the model changed, or an admin asked). */
    async reset(): Promise<void> {
      await repo.deleteAllAiChunks()
      cache = null
      pending = 0
    },
  }
}

export type AiIndex = ReturnType<typeof createAiIndex>

// ---- finding notes by their words ----

const STOP = new Set(
  (
    'the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use ' +
    'what when where which while with that this then than them they there their these those from have into just like more most much must only over some such ' +
    'very will would about after again also been being before both does doing done each even ever every here just know many might never other same should ' +
    'still through under until upper whose why your yours i me my we us an a of to in on at by or is it be do if so as no up' +
    ' tell show give find notes note wrote write written did anything something'
  ).split(/\s+/),
)

/** The words of a question worth looking for, longest first. */
export function keywords(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? []
  return [...new Set(words.filter((w) => !STOP.has(w)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 6)
}

function excerpt(text: string, words: string[], max = 1500): string {
  if (text.length <= max) return text
  const lower = text.toLowerCase()
  const at = Math.min(
    ...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0),
    Number.POSITIVE_INFINITY,
  )
  const start = Number.isFinite(at) ? Math.max(0, at - 300) : 0
  return `${start > 0 ? '…' : ''}${text.slice(start, start + max)}…`
}

// ---- the assistant ----

const MAX_MATERIAL = 14_000
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export type AskEvent =
  | {
      type: 'sources'
      sources: Array<{ n: number; pageId: string; title: string; context: string }>
    }
  | { type: 'text'; text: string }

export function createAssistant(deps: {
  repo: Repo
  access: AccessService
  client: AiClient
  index: AiIndex
  /** pages hidden from this session by locks */
  hiddenPages: (sessionToken: string | null, user: UserRow) => Promise<Set<string>>
  config: () => AiConfig | null
  now?: () => Date
}) {
  const { repo, access, client, index } = deps
  const now = deps.now ?? (() => new Date())

  async function readable(user: UserRow, sessionToken: string | null) {
    const [spaces, hidden] = await Promise.all([
      repo.listSpaces(),
      deps.hiddenPages(sessionToken, user),
    ])
    const ok = spaces.filter(await access.filter(user))
    // locked spaces stay out even when this session has them open: the AI
    // never sees locked notes
    const spaceOf = new Map(ok.filter((s) => s.lockPolicy === null).map((s) => [s.id, s]))
    return { spaceOf, hidden }
  }

  /** The notes a question draws on, numbered for citing. */
  async function gather(user: UserRow, sessionToken: string | null, question: string) {
    const { spaceOf, hidden } = await readable(user, sessionToken)
    const locked = new Set((await repo.listLockedPages()).map((p) => p.id))
    const allow = (pageId: string, spaceId: string) =>
      spaceOf.has(spaceId) && !hidden.has(pageId) && !locked.has(pageId)
    const pages = new Map((await repo.listAllPages()).map((p) => [p.id, p]))
    const picked = new Map<string, string[]>() // pageId -> passages

    if (deps.config()?.embedModel) {
      for (const hit of await index.search(question, allow, 8)) {
        const page = pages.get(hit.pageId)
        if (!page || page.trashedAt) continue
        picked.set(hit.pageId, [...(picked.get(hit.pageId) ?? []), hit.text])
      }
    }
    // words, too: names and exact terms are where meaning-search is weakest
    const words = keywords(question)
    const score = new Map<string, { page: PageRow; content: string; score: number }>()
    for (const word of words) {
      for (const { page, content } of await repo.searchPages(word)) {
        if (!allow(page.id, page.spaceId)) continue
        const prev = score.get(page.id) ?? { page, content, score: 0 }
        prev.score += page.title.toLowerCase().includes(word) ? 3 : 1
        score.set(page.id, prev)
      }
    }
    const byWords = [...score.values()].sort(
      (a, b) => b.score - a.score || b.page.updatedAt.getTime() - a.page.updatedAt.getTime(),
    )
    for (const hit of byWords) {
      if (picked.size >= 8) break
      if (picked.has(hit.page.id)) continue
      if (picked.size >= 5 && hit.score < 2) break
      const text = plainText(hit.content)
      picked.set(hit.page.id, [`${hit.page.title}\n${excerpt(text, words)}`])
    }

    const sources: AskEvent & { type: 'sources' } = { type: 'sources', sources: [] }
    const blocks: string[] = []
    let used = 0
    for (const [pageId, passages] of picked) {
      const page = pages.get(pageId)
      const space = page ? spaceOf.get(page.spaceId) : undefined
      if (!page || !space) continue
      const n = sources.sources.length + 1
      const context = space.kind === 'journal' ? 'Journal' : space.name
      const body = clip(passages.join('\n…\n'), 3000)
      if (used + body.length > MAX_MATERIAL) break
      used += body.length
      sources.sources.push({ n, pageId, title: page.title || 'Untitled', context })
      blocks.push(
        `[${n}] "${page.title || 'Untitled'}" (${context}, last changed ${isoDay(page.updatedAt)})\n${body}`,
      )
    }
    return { sources, blocks }
  }

  return {
    status() {
      const c = deps.config()
      return { enabled: Boolean(c), semantic: Boolean(c?.embedModel) }
    },

    /** Answer a question from the asker's notes: their sources first, then the answer as it comes. */
    async *ask(
      user: UserRow,
      sessionToken: string | null,
      input: { question: string; history: Array<{ question: string; answer: string }> },
      signal?: AbortSignal,
    ): AsyncGenerator<AskEvent> {
      // a follow-up ("and in May?") is found by what it follows
      const last = input.history.at(-1)
      const lookFor = last ? `${last.question}\n${input.question}` : input.question
      const { sources, blocks } = await gather(user, sessionToken, lookFor)
      yield sources
      const system = [
        "You are the assistant inside Beyond Notes, a notes app. Answer the user's question using only their notes below.",
        'Cite the notes you use by number in square brackets, like [1] or [2][3], right after what they support.',
        "If the notes don't answer the question, say so plainly; never make things up.",
        'Be concise. Use short paragraphs or bullet points.',
        `Today is ${isoDay(now())}.`,
      ].join(' ')
      const notes = blocks.length > 0 ? blocks.join('\n\n') : '(No notes matched this question.)'
      const messages = [
        { role: 'system' as const, content: system },
        ...input.history.slice(-3).flatMap((t) => [
          { role: 'user' as const, content: t.question },
          { role: 'assistant' as const, content: clip(t.answer, 2000) },
        ]),
        { role: 'user' as const, content: `Notes:\n\n${notes}\n\nQuestion: ${input.question}` },
      ]
      for await (const text of client.stream(messages, { signal })) yield { type: 'text', text }
    },

    /** A day's or a week's journal, finished tasks and Inbox, summed up. */
    async *summarise(
      user: UserRow,
      sessionToken: string | null,
      input: { kind: 'day' | 'week'; date: string; tzOffset: number },
      signal?: AbortSignal,
    ): AsyncGenerator<string> {
      const [y, m, d] = input.date.split('-').map(Number) as [number, number, number]
      let first = new Date(Date.UTC(y, m - 1, d))
      let days = 1
      if (input.kind === 'week') {
        // Monday to Sunday around the date
        const back = (first.getUTCDay() + 6) % 7
        first = new Date(first.getTime() - back * 86_400_000)
        days = 7
      }
      const dates = Array.from({ length: days }, (_, i) =>
        isoDay(new Date(first.getTime() + i * 86_400_000)),
      )
      // the person's own midnight to midnight, in UTC
      const from = new Date(first.getTime() + input.tzOffset * 60_000)
      const to = new Date(from.getTime() + days * 86_400_000)
      const inRange = (t: Date) => t >= from && t < to

      const parts: string[] = []
      const journal = await repo.getSpaceByOwnerAndKind(user.id, 'journal')
      const { spaceOf, hidden } = await readable(user, sessionToken)
      if (journal && spaceOf.has(journal.id)) {
        for (const date of dates) {
          const notes: string[] = []
          for (const page of await repo.listPagesByDateKey(journal.id, date)) {
            if (page.trashedAt || hidden.has(page.id) || page.lockPolicy) continue
            const doc = await repo.getDocument(page.id)
            const text = doc ? plainText(doc.content).trim() : ''
            if (!text) continue
            notes.push(page.title && page.title !== date ? `${page.title}:\n${text}` : text)
          }
          if (notes.length) parts.push(`Journal, ${date}:\n${clip(notes.join('\n\n'), 4000)}`)
        }
      }
      const pages = new Map((await repo.listAllPages()).map((p) => [p.id, p]))
      const done: string[] = []
      const open: string[] = []
      for (const task of await repo.listAllTasks()) {
        const page = pages.get(task.pageId)
        if (!page || page.trashedAt || !spaceOf.has(page.spaceId) || hidden.has(page.id)) continue
        if (task.checked && inRange(task.updatedAt)) done.push(`- ${task.text}`)
        else if (!task.checked && task.due && dates.includes(task.due)) open.push(`- ${task.text}`)
      }
      if (done.length) parts.push(`Tasks done:\n${clip(done.join('\n'), 2500)}`)
      if (open.length) parts.push(`Tasks due and still open:\n${clip(open.join('\n'), 1500)}`)
      const memos = (await repo.listMemos(user.id)).filter((mm) => inRange(mm.createdAt))
      if (memos.length) {
        parts.push(
          `Captured in the Inbox:\n${clip(memos.map((mm) => `- ${mm.content.replace(/\s+/g, ' ')}`).join('\n'), 2500)}`,
        )
      }

      const span = input.kind === 'day' ? 'day' : 'week'
      if (parts.length === 0) {
        yield `Nothing was written down for this ${span} yet: no journal entries, finished tasks or Inbox items.`
        return
      }
      const system = [
        'You summarise a person\'s own notes for them. Write to them as "you".',
        `Start with one sentence on the ${span} as a whole, then 3 to 6 bullet points: what happened, what got done, and anything left open.`,
        'Use only the notes. No preamble, no closing remarks.',
      ].join(' ')
      const title =
        input.kind === 'day' ? `The day: ${dates[0]}` : `The week: ${dates[0]} to ${dates.at(-1)}`
      yield* client.stream(
        [
          { role: 'system', content: system },
          { role: 'user', content: `${title}\n\n${clip(parts.join('\n\n'), MAX_MATERIAL)}` },
        ],
        { signal },
      )
    },

    /** Up to three tags for an Inbox item, preferring ones already in use. */
    async suggestTags(user: UserRow, memoId: string, signal?: AbortSignal): Promise<string[]> {
      const memo = (await repo.listMemos(user.id)).find((mm) => mm.id === memoId)
      if (!memo) throw new AiError('That Inbox item is gone.')
      const { spaceOf } = await readable(user, null)
      const visible = new Set(
        (await repo.listAllPages())
          .filter((p) => spaceOf.has(p.spaceId) && !p.trashedAt)
          .map((p) => p.id),
      )
      const counts = new Map<string, number>()
      for (const row of await repo.listAllPageTags()) {
        if (visible.has(row.pageId)) counts.set(row.tag, (counts.get(row.tag) ?? 0) + 1)
      }
      for (const mm of await repo.listMemos(user.id)) {
        for (const tag of extractTagsFromText(mm.content))
          counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
      const existing = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 80)
        .map(([tag]) => tag)
      const raw = await client.complete(
        [
          {
            role: 'system',
            content:
              'You suggest tags for a short note. Reply with JSON only, like {"tags": ["recipes", "garden"]}. ' +
              'Give 1 to 3 tags: lowercase, one word or words joined with hyphens, no #. ' +
              'Prefer tags from the existing list when they fit; only invent one when none does.',
          },
          {
            role: 'user',
            content: `Existing tags: ${existing.join(', ') || '(none yet)'}\n\nNote:\n${clip(memo.content, 3000)}`,
          },
        ],
        { signal, temperature: 0.2 },
      )
      return parseTags(raw, new Set(extractTagsFromText(memo.content)))
    },
  }
}

const TAG = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,49}$/u

/** Tags out of a model's reply: JSON if it managed, words if not. */
export function parseTags(raw: string, already: Set<string>): string[] {
  let list: unknown[] = []
  const json = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0]
  if (json) {
    try {
      const v = JSON.parse(json) as unknown
      list = Array.isArray(v)
        ? v
        : Array.isArray((v as { tags?: unknown }).tags)
          ? (v as { tags: unknown[] }).tags
          : []
    } catch {
      list = []
    }
  }
  if (list.length === 0) list = raw.split(/[\s,]+/)
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const tag = item.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')
    if (!TAG.test(tag) || already.has(tag) || out.includes(tag)) continue
    out.push(tag)
    if (out.length === 3) break
  }
  return out
}

export type Assistant = ReturnType<typeof createAssistant>
