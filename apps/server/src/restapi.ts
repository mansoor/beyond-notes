import { dateKey } from '@bn/schema'
/**
 * The public REST API (/api/v1) and the MCP server (/api/mcp), both
 * authenticated by personal access tokens (Authorization: Bearer bn_...).
 *
 * Read-scope tokens can only look; write-scope tokens can also create and
 * change content. Neither can touch accounts, settings or anything admin:
 * that surface stays behind a signed-in browser. /api/v1/openapi.json
 * describes the REST routes and needs no token.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { type ApiTokenService, type TokenScope, bearerToken } from './apitokens'
import { ApiError, type PublicApi } from './publicapi'
import type { UserRow } from './repo'

const STATUS: Record<ApiError['code'], number> = {
  NOT_FOUND: 404,
  LOCKED: 423,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  FORBIDDEN: 403,
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } })
}

export function registerPublicApi(
  server: FastifyInstance,
  deps: { api: PublicApi; tokens: ApiTokenService; version: string },
) {
  const { api, tokens } = deps

  async function authenticate(req: FastifyRequest, reply: FastifyReply, need: TokenScope) {
    const raw = bearerToken(req.headers.authorization)
    const found = raw ? await tokens.authenticate(raw) : null
    if (!found) {
      reply.header('www-authenticate', 'Bearer')
      sendError(reply, 401, 'UNAUTHORIZED', 'Send a valid personal access token as a Bearer token.')
      return null
    }
    if (need === 'write' && found.token.scope !== 'write') {
      sendError(reply, 403, 'FORBIDDEN', 'This token is read-only.')
      return null
    }
    return found
  }

  /** One REST route: token check, input parsing, and error mapping in one place. */
  function route<S extends z.ZodTypeAny>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    scope: TokenScope,
    schema: S | null,
    handler: (user: UserRow, input: z.infer<S>, req: FastifyRequest) => Promise<unknown>,
  ) {
    server.route({
      method,
      url,
      handler: async (req, reply) => {
        const found = await authenticate(req, reply, scope)
        if (!found) return reply
        let input: z.infer<S> = undefined as z.infer<S>
        if (schema) {
          const raw = method === 'GET' ? req.query : req.body
          const parsed = schema.safeParse(raw ?? {})
          if (!parsed.success) {
            const first = parsed.error.issues[0]
            return sendError(
              reply,
              400,
              'BAD_REQUEST',
              first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input.',
            )
          }
          input = parsed.data
        }
        try {
          return await handler(found.user, input, req)
        } catch (err) {
          if (err instanceof ApiError)
            return sendError(reply, STATUS[err.code], err.code, err.message)
          throw err
        }
      },
    })
  }

  const params = (req: FastifyRequest) => req.params as Record<string, string>
  const date = (raw: string, today: string) => {
    const d = raw === 'today' ? today : raw
    if (!dateKey.safeParse(d).success)
      throw new ApiError('BAD_REQUEST', 'Dates look like 2026-09-26.')
    return d
  }
  const markdown = z.string().max(1_000_000)

  route('GET', '/api/v1/me', 'read', null, async (user) => api.me(user))
  route('GET', '/api/v1/spaces', 'read', null, async (user) => api.spaces(user))
  route('GET', '/api/v1/spaces/:id/pages', 'read', null, async (user, _i, req) =>
    api.pages(user, params(req).id ?? ''),
  )
  route('GET', '/api/v1/pages/:id', 'read', null, async (user, _i, req) =>
    api.readPage(user, params(req).id ?? ''),
  )
  route(
    'POST',
    '/api/v1/pages',
    'write',
    z.object({
      spaceId: z.string().min(1),
      parentId: z.string().nullable().optional(),
      title: z.string().trim().max(300).default(''),
      markdown: markdown.optional(),
    }),
    async (user, input) => api.createPage(user, input),
  )
  route(
    'PATCH',
    '/api/v1/pages/:id',
    'write',
    z.object({
      title: z.string().max(300).optional(),
      markdown: markdown.optional(),
      mode: z.enum(['replace', 'append']).default('replace'),
    }),
    async (user, input, req) => api.updatePage(user, params(req).id ?? '', input),
  )
  route(
    'GET',
    '/api/v1/search',
    'read',
    z.object({ q: z.string().max(100) }),
    async (user, input) => api.search(user, input.q),
  )
  route('GET', '/api/v1/journal/:date', 'read', null, async (user, _i, req) =>
    api.readJournal(user, date(params(req).date ?? '', api.today())),
  )
  route(
    'POST',
    '/api/v1/journal/:date',
    'write',
    z.object({ markdown: markdown.min(1) }),
    async (user, input, req) =>
      api.appendJournal(user, date(params(req).date ?? '', api.today()), input.markdown),
  )
  route(
    'GET',
    '/api/v1/tasks',
    'read',
    z.object({ done: z.enum(['true', 'false']).default('false') }),
    async (user, input) => api.tasks(user, { includeDone: input.done === 'true' }),
  )
  route(
    'POST',
    '/api/v1/tasks',
    'write',
    z.object({ text: z.string().max(500) }),
    async (user, input) => api.addTask(user, input.text),
  )
  route(
    'POST',
    '/api/v1/inbox',
    'write',
    z.object({ text: z.string().max(5000) }),
    async (user, input) => api.capture(user, input.text),
  )

  server.get('/api/v1/openapi.json', async () => openApiSpec(deps.version))

  // ---- MCP (streamable HTTP, stateless: a fresh server per request) ----
  server.post('/api/mcp', async (req, reply) => {
    const found = await authenticate(req, reply, 'read')
    if (!found) return reply
    const mcp = buildMcpServer(api, found.user, found.token.scope, deps.version)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })
  const noSessions = async (_req: FastifyRequest, reply: FastifyReply) =>
    sendError(reply, 405, 'METHOD_NOT_ALLOWED', 'This MCP server is stateless; use POST.')
  server.get('/api/mcp', noSessions)
  server.delete('/api/mcp', noSessions)
}

/** The tools an assistant gets. Write tools only exist for write-scope tokens. */
export function buildMcpServer(api: PublicApi, user: UserRow, scope: TokenScope, version: string) {
  const mcp = new McpServer({ name: 'beyond-notes', version })

  const run = async (fn: () => Promise<unknown>) => {
    try {
      const out = await fn()
      const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2)
      return { content: [{ type: 'text' as const, text }] }
    } catch (err) {
      const message = err instanceof ApiError || err instanceof Error ? err.message : 'Failed.'
      return { isError: true, content: [{ type: 'text' as const, text: message }] }
    }
  }
  const readOnly = { readOnlyHint: true, openWorldHint: false }

  mcp.registerTool(
    'search_notes',
    {
      description:
        'Search pages (notebooks, wikis, sites, journal) and inbox notes by text. Returns titles, where each lives, a snippet, and ids for read_page.',
      inputSchema: { query: z.string().describe('Words to look for (2+ characters)') },
      annotations: readOnly,
    },
    async ({ query }) => run(() => api.search(user, query)),
  )
  mcp.registerTool(
    'list_spaces',
    {
      description: 'List the notebooks, wikis and sites this person can see, with their ids.',
      annotations: readOnly,
    },
    async () => run(() => api.spaces(user)),
  )
  mcp.registerTool(
    'list_pages',
    {
      description:
        "List a space's pages (id, parentId for nesting, title). Locked pages are listed but can't be read.",
      inputSchema: { space_id: z.string() },
      annotations: readOnly,
    },
    async ({ space_id }) => run(() => api.pages(user, space_id)),
  )
  mcp.registerTool(
    'read_page',
    {
      description: 'Read one page as Markdown.',
      inputSchema: { page_id: z.string() },
      annotations: readOnly,
    },
    async ({ page_id }) =>
      run(async () => {
        const p = await api.readPage(user, page_id)
        return `# ${p.title}\n\n${p.markdown}`
      }),
  )
  mcp.registerTool(
    'read_journal',
    {
      description: "Read a day's journal entry as Markdown. Defaults to today.",
      inputSchema: { date: z.string().optional().describe('YYYY-MM-DD; omit for today') },
      annotations: readOnly,
    },
    async ({ date }) =>
      run(async () => (await api.readJournal(user, date ?? api.today())).markdown),
  )
  mcp.registerTool(
    'list_tasks',
    {
      description: 'List open tasks from every page and the journal, with due dates.',
      inputSchema: { include_done: z.boolean().optional() },
      annotations: readOnly,
    },
    async ({ include_done }) => run(() => api.tasks(user, { includeDone: include_done ?? false })),
  )

  if (scope === 'write') {
    const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    mcp.registerTool(
      'create_page',
      {
        description:
          'Create a page in a space, optionally under a parent page, with Markdown content.',
        inputSchema: {
          space_id: z.string(),
          title: z.string(),
          markdown: z.string().optional(),
          parent_id: z.string().optional(),
        },
        annotations: writes,
      },
      async ({ space_id, title, markdown, parent_id }) =>
        run(async () => {
          const p = await api.createPage(user, {
            spaceId: space_id,
            title,
            markdown,
            parentId: parent_id ?? null,
          })
          return { id: p.id, title: p.title }
        }),
    )
    mcp.registerTool(
      'update_page',
      {
        description:
          'Change a page: append Markdown to it (default), replace its content, and/or rename it.',
        inputSchema: {
          page_id: z.string(),
          markdown: z.string().optional(),
          mode: z.enum(['append', 'replace']).optional(),
          title: z.string().optional(),
        },
        annotations: { ...writes, destructiveHint: true },
      },
      async ({ page_id, markdown, mode, title }) =>
        run(async () => {
          const p = await api.updatePage(user, page_id, { markdown, title, mode: mode ?? 'append' })
          return { id: p.id, title: p.title, updatedAt: p.updatedAt }
        }),
    )
    mcp.registerTool(
      'append_to_journal',
      {
        description: "Add Markdown to a day's journal entry. Defaults to today.",
        inputSchema: { markdown: z.string(), date: z.string().optional() },
        annotations: writes,
      },
      async ({ markdown, date }) =>
        run(async () => {
          await api.appendJournal(user, date ?? api.today(), markdown)
          return 'Added to the journal.'
        }),
    )
    mcp.registerTool(
      'add_task',
      {
        description: 'Add a task. End the text with @YYYY-MM-DD to give it a due date.',
        inputSchema: { text: z.string() },
        annotations: writes,
      },
      async ({ text }) =>
        run(async () => {
          await api.addTask(user, text)
          return 'Task added.'
        }),
    )
    mcp.registerTool(
      'capture_to_inbox',
      {
        description: 'Drop a quick note, idea or link into the Inbox to sort later.',
        inputSchema: { text: z.string() },
        annotations: writes,
      },
      async ({ text }) =>
        run(async () => {
          await api.capture(user, text)
          return 'Saved to the Inbox.'
        }),
    )
  }
  return mcp
}

function openApiSpec(version: string) {
  const json = (schema: object) => ({ content: { 'application/json': { schema } } })
  const ok = (schema: object) => ({ '200': { description: 'OK', ...json(schema) } })
  const idParam = (name: string) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  })
  const page = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      spaceId: { type: 'string' },
      parentId: { type: 'string', nullable: true },
      title: { type: 'string' },
      markdown: { type: 'string' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  }
  const list = (items: object) => ({ type: 'array', items })
  return {
    openapi: '3.0.3',
    info: {
      title: 'Beyond Notes API',
      version,
      description:
        'Authenticate with a personal access token from Settings > Integrations: `Authorization: Bearer bn_...`. Content is Markdown. Locked notebooks and pages are listed but cannot be read or changed with a token. Errors look like `{ "error": { "code", "message" } }`.',
    },
    components: {
      securitySchemes: { token: { type: 'http', scheme: 'bearer' } },
    },
    security: [{ token: [] }],
    paths: {
      '/api/v1/me': {
        get: { summary: 'Who this token acts as', responses: ok({ type: 'object' }) },
      },
      '/api/v1/spaces': {
        get: {
          summary: 'Notebooks, wikis and sites you can see',
          responses: ok(list({ type: 'object' })),
        },
      },
      '/api/v1/spaces/{id}/pages': {
        get: {
          summary: "A space's pages (flat; nest by parentId)",
          parameters: [idParam('id')],
          responses: ok(list({ type: 'object' })),
        },
      },
      '/api/v1/pages': {
        post: {
          summary: 'Create a page (write scope)',
          requestBody: json({
            type: 'object',
            required: ['spaceId'],
            properties: {
              spaceId: { type: 'string' },
              parentId: { type: 'string', nullable: true },
              title: { type: 'string' },
              markdown: { type: 'string' },
            },
          }),
          responses: ok(page),
        },
      },
      '/api/v1/pages/{id}': {
        get: {
          summary: 'Read a page as Markdown',
          parameters: [idParam('id')],
          responses: ok(page),
        },
        patch: {
          summary: 'Rename a page and/or replace or append its content (write scope)',
          parameters: [idParam('id')],
          requestBody: json({
            type: 'object',
            properties: {
              title: { type: 'string' },
              markdown: { type: 'string' },
              mode: { type: 'string', enum: ['replace', 'append'], default: 'replace' },
            },
          }),
          responses: ok(page),
        },
      },
      '/api/v1/search': {
        get: {
          summary: 'Search pages and inbox notes',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
          responses: ok(list({ type: 'object' })),
        },
      },
      '/api/v1/journal/{date}': {
        get: {
          summary: "A day's journal entry (date is YYYY-MM-DD or 'today')",
          parameters: [idParam('date')],
          responses: ok({ type: 'object' }),
        },
        post: {
          summary: "Append Markdown to a day's journal entry (write scope)",
          parameters: [idParam('date')],
          requestBody: json({
            type: 'object',
            required: ['markdown'],
            properties: { markdown: { type: 'string' } },
          }),
          responses: ok({ type: 'object' }),
        },
      },
      '/api/v1/tasks': {
        get: {
          summary: 'Open tasks (add ?done=true for finished ones too)',
          parameters: [
            { name: 'done', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          ],
          responses: ok(list({ type: 'object' })),
        },
        post: {
          summary: 'Add a task; a trailing @YYYY-MM-DD sets its due date (write scope)',
          requestBody: json({
            type: 'object',
            required: ['text'],
            properties: { text: { type: 'string' } },
          }),
          responses: ok({ type: 'object' }),
        },
      },
      '/api/v1/inbox': {
        post: {
          summary: 'Capture a note into the Inbox (write scope)',
          requestBody: json({
            type: 'object',
            required: ['text'],
            properties: { text: { type: 'string' } },
          }),
          responses: ok({ type: 'object' }),
        },
      },
    },
  }
}
