import { createReadStream, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import pkg from '../package.json'
import { createApiTokenService } from './apitokens'
import { MAX_UPLOAD_BYTES, createAttachmentsService, thumbKey } from './attachments'
import { createAuditService } from './audit'
import { createAuthService } from './auth'
import { createBackupService } from './backup'
import { createDynamicBlobStore } from './blobstore-dynamic'
import { effectiveCaptchaMode, verifyMathChallenge, verifyRecaptcha } from './captcha'
import type { Config } from './config'
import { createDailyService } from './daily'
import type { AppDb } from './db'
import { createEmbedder } from './embeddings'
import { exportSpaceZip } from './export'
import { ImportFormatError, type ImportKind, parseImport } from './importers'
import { createImportStash } from './importstash'
import { createLockService } from './locks'
import { createDynamicMailer } from './mailer'
import { createPagesService } from './pages'
import { createPasskeyService } from './passkeys'
import { createProxyAuth, proxyAuthSettings } from './proxyauth'
import { createPublicServer } from './public'
import { createPublicApi } from './publicapi'
import { createPublishingService } from './publishing'
import { createRemindersService } from './reminders'
import { createRepo } from './repo'
import { registerPublicApi } from './restapi'
import { createRestoreService } from './restore'
import { appRouter } from './routers'
import {
  type Notifier,
  createEmailNotifier,
  createLogNotifier,
  createNtfyNotifier,
  createScheduler,
} from './scheduler'
import { loadOrCreateSecretsKey } from './secrets'
import { createSettingsService } from './settings'
import { SsoError, createSsoService, safeNext } from './sso'
import { TablesError, createTablesService } from './tables'
import { createTasksService } from './tasks'
import { SESSION_COOKIE, makeCreateContext, sessionCookieOptions } from './trpc'
import { createWebhooksService } from './webhooks'

function escapeText(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** No-JS fallback page returned when a form is submitted without the fetch
 *  enhancement (a plain browser POST). */
function formResultPage(ok: boolean, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${
    ok ? 'Thank you' : 'There was a problem'
  }</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.25rem;line-height:1.6;color:#222}a{color:#2b6cb0}</style></head><body><p>${escapeText(
    message,
  )}</p><p><a href="javascript:history.back()">← Go back</a></p></body></html>`
}

export async function buildServer(config: Config, appDb: AppDb) {
  const proxyList = (config.TRUST_PROXY || config.AUTH_PROXY_TRUSTED_IPS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const server = Fastify({
    logger: config.NODE_ENV !== 'test',
    // only these hops may set X-Forwarded-For; everyone else's is ignored
    trustProxy: proxyList.length ? proxyList : false,
    // JSON bodies: a long page's autosave (content up to 2M characters) is well
    // past Fastify's 1 MiB default. Uploads have their own, larger limits.
    bodyLimit: 20 * 1024 * 1024,
    // tRPC batches put every procedure name in one path param
    // (/api/trpc/a.list,b.get,...); Fastify's default 100-char cap 404s a busy
    // page's whole batch. tRPC's Fastify adapter docs recommend 5000.
    maxParamLength: 5000,
  })

  await server.register(fastifyCookie)

  const repo = createRepo(appDb)
  const secretsKey = loadOrCreateSecretsKey(config)
  const settings = createSettingsService(repo, config, { secretsKey })
  await settings.load()
  const audit = createAuditService({
    repo,
    onError: (err) => server.log.error(err, 'audit write failed'),
  })
  const tokens = createApiTokenService({ repo })
  const importStash = createImportStash()
  const auth = createAuthService(repo, {
    passwordLoginEnabled: () => settings.passwordLoginEnabled(),
  })
  const sso = createSsoService({ repo, auth, settings, baseUrl: config.BASE_URL })
  const passkeys = createPasskeyService({
    repo,
    auth,
    baseUrl: config.BASE_URL,
    passwordLoginEnabled: () => settings.passwordLoginEnabled(),
  })
  const proxy = createProxyAuth({
    settings: proxyAuthSettings(config),
    repo,
    auth,
    log: (msg) => server.log.warn(msg),
    onLogin: (user, ip) => void audit.record({ action: 'auth.proxy_login', actor: user, ip }),
  })
  const embedder = createEmbedder(config)
  const pages = createPagesService(repo, {
    embedder,
    embedThreshold: config.GRAPH_EMBED_THRESHOLD,
    embedNeighbors: config.GRAPH_EMBED_NEIGHBORS,
  })
  const daily = createDailyService(repo)
  const tasks = createTasksService(repo)
  const publishing = createPublishingService(repo)
  const publicSrv = createPublicServer(repo, publishing, {
    captchaSecret: secretsKey,
    recaptchaSiteKey: () => settings.effectiveRecaptcha()?.siteKey ?? null,
    now: () => Date.now(),
  })
  const blobs = createDynamicBlobStore(settings, config, repo)
  const attachments = createAttachmentsService(repo, blobs)
  const reminders = createRemindersService(repo)
  const webhooks = createWebhooksService(repo, daily)
  const tables = createTablesService(repo)
  const locks = createLockService(repo)

  const mailer = createDynamicMailer(settings, (msg) => server.log.info(msg))

  // every channel resolves its config per send; unconfigured channels no-op
  const notifiers: Notifier[] = [
    createNtfyNotifier(settings),
    createEmailNotifier(mailer),
    createLogNotifier((msg) => server.log.info(msg)),
  ]
  const backup = createBackupService({
    repo,
    blobs,
    backupsDir: config.BACKUPS_DIR,
    getConfig: () => settings.backup(),
    isS3: () => settings.effectiveStorage().driver === 's3',
    secretsKey,
  })
  // restore reuses backup.resolve so it inherits the same traversal guard
  const restore = createRestoreService({ repo, blobs, resolvePath: (name) => backup.resolve(name) })

  // scheduled publishes and periodic backups run through the same tick as reminders
  const scheduler = createScheduler(repo, notifiers, {
    publishPage: async (pageId, byUserId) => {
      const user = await repo.getUserById(byUserId)
      if (!user) throw new Error(`scheduled publish: user ${byUserId} is gone`)
      await publishing.publish(user, pageId)
    },
    runBackup: () => backup.runScheduled(),
  })
  // make sure the backup job matches the saved config after a restart
  await backup.reschedule()

  await server.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })

  // Who a request is signed in as: a trusted proxy header first (forward-auth),
  // then the session cookie. `res` given = a fresh proxy session gets its cookie.
  const resolveSession = async (
    req: { cookies?: Record<string, string | undefined>; headers: any; socket?: any },
    res?: { setCookie: (name: string, value: string, opts: any) => unknown },
  ) => {
    const token = req.cookies?.[SESSION_COOKIE] ?? null
    const proxied = await proxy.resolve(req, token)
    if (!proxied) return { user: token ? await auth.userForToken(token) : null, token }
    if (res && proxied.fresh && proxied.token && proxied.expiresAt) {
      res.setCookie(SESSION_COOKIE, proxied.token, sessionCookieOptions(config, proxied.expiresAt))
    }
    return { user: proxied.user, token: proxied.token }
  }
  const userFromRequest = async (req: {
    cookies?: Record<string, string | undefined>
    headers: any
    socket?: any
  }) => (await resolveSession(req)).user

  server.post('/api/upload', async (req, reply) => {
    const user = await userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'sign in to upload' })
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no file' })
    const data = await file.toBuffer()
    const attachment = await attachments.upload(user, {
      filename: file.filename,
      mime: file.mimetype,
      data,
    })
    return {
      id: attachment.id,
      url: `/api/files/${attachment.id}`,
      thumbUrl: attachment.mime.startsWith('image/') ? `/api/files/${attachment.id}/thumb` : null,
      mime: attachment.mime,
      size: attachment.size,
    }
  })

  const serveFile = async (req: any, reply: any, thumb: boolean) => {
    const id = String(req.params.id ?? '')
    const attachment = await repo.getAttachment(id)
    if (!attachment) return reply.code(404).send({ error: 'not found' })
    const user = await userFromRequest(req)
    if (!user && !(await publishing.publicAttachmentIds()).has(id)) {
      // a valid draft-preview token authorizes exactly that page's attachments
      const previewToken = typeof req.query?.preview === 'string' ? req.query.preview : ''
      const previewPage = previewToken ? await publishing.resolvePreviewToken(previewToken) : null
      const allowed =
        previewPage !== null && (await publishing.previewAttachmentIds(previewPage)).has(id)
      if (!allowed) {
        // same shape as a missing file: existence of private uploads is private
        return reply.code(404).send({ error: 'not found' })
      }
    }
    const key =
      thumb && (await blobs.exists(thumbKey(attachment.hash)))
        ? thumbKey(attachment.hash)
        : attachment.hash
    if (!(await blobs.exists(key))) return reply.code(404).send({ error: 'not found' })
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.type(attachment.mime)
    return reply.send(await blobs.getStream(key))
  }
  server.get('/api/files/:id', (req, reply) => serveFile(req, reply, false))
  server.get('/api/files/:id/thumb', (req, reply) => serveFile(req, reply, true))

  // Mermaid is served from this instance rather than a CDN: a wiki on an
  // offline LAN must still draw its diagrams, and published pages should not
  // phone home. Public by design — it is a static library, not user content.
  const mermaidPath = (() => {
    try {
      return createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js')
    } catch {
      return null
    }
  })()
  server.get('/api/assets/mermaid.js', async (_req, reply) => {
    if (!mermaidPath || !existsSync(mermaidPath)) {
      return reply.code(404).send({ error: 'mermaid is not installed in this build' })
    }
    reply.type('application/javascript; charset=utf-8')
    reply.header('cache-control', 'public, max-age=604800, immutable')
    return reply.send(createReadStream(mermaidPath))
  })

  // Material Symbols (Outlined) font, self-hosted for the same reason as mermaid:
  // page icons must render on an offline LAN and published pages must not phone
  // home. A page's icon is a ligature name the font resolves.
  const materialFontPath = (() => {
    try {
      return createRequire(import.meta.url).resolve(
        'material-symbols/material-symbols-outlined.woff2',
      )
    } catch {
      return null
    }
  })()
  server.get('/api/assets/material-symbols.woff2', async (_req, reply) => {
    if (!materialFontPath || !existsSync(materialFontPath)) {
      return reply.code(404).send({ error: 'material-symbols is not installed in this build' })
    }
    reply.type('font/woff2')
    reply.header('cache-control', 'public, max-age=604800, immutable')
    return reply.send(createReadStream(materialFontPath))
  })

  // incoming webhooks: token-authenticated writers into capture surfaces.
  // Accepts JSON {text} (or {content}) and raw text/plain bodies.
  server.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body)
  })
  server.post('/api/hooks/:token', async (req: any, reply) => {
    const token = String(req.params.token ?? '')
    let text = ''
    if (typeof req.body === 'string') text = req.body
    else if (req.body && typeof req.body === 'object') {
      text = String(req.body.text ?? req.body.content ?? '')
    }
    text = text.trim().slice(0, 5000)
    if (!text) return reply.code(400).send({ error: 'send JSON {"text": "..."} or plain text' })
    const result = await webhooks.deliver(token, text)
    if (!result) return reply.code(404).send({ error: 'not found' })
    return { ok: true, target: result.target }
  })

  // Public form intake: an embedded [[form:<tableId>]] posts here. Native form
  // posts (and the fetch enhancement) both arrive url-encoded.
  server.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)))
      } catch (err) {
        done(err as Error)
      }
    },
  )
  // Per-IP rate limit for public submissions — in-memory is correct here (the
  // app is a single process by design, like the scheduler's CAS).
  const formHits = new Map<string, number[]>()
  const FORM_WINDOW_MS = 10 * 60 * 1000
  const FORM_MAX = 8
  const allowForm = (ip: string): boolean => {
    const cutoff = Date.now() - FORM_WINDOW_MS
    const hits = (formHits.get(ip) ?? []).filter((t) => t > cutoff)
    if (hits.length >= FORM_MAX) {
      formHits.set(ip, hits)
      return false
    }
    hits.push(Date.now())
    formHits.set(ip, hits)
    return true
  }
  server.post('/api/forms/:tableId', async (req: any, reply) => {
    const wantsJson = String(req.headers.accept ?? '').includes('application/json')
    const body: Record<string, unknown> = req.body && typeof req.body === 'object' ? req.body : {}
    const respond = (ok: boolean, opts: { code?: number; message?: string } = {}) => {
      const code = opts.code ?? (ok ? 200 : 400)
      const message =
        opts.message ?? (ok ? 'Thanks — your response was received.' : 'Something went wrong.')
      if (wantsJson) {
        return reply.code(code).send(ok ? { ok: true, message } : { ok: false, error: message })
      }
      reply.code(code).type('text/html; charset=utf-8')
      return reply.send(formResultPage(ok, message))
    }
    // honeypot: a real person never fills the hidden field; pretend success
    if (String(body._website ?? '').trim() !== '') return respond(true)
    if (!allowForm(req.ip)) {
      return respond(false, { code: 429, message: 'Too many submissions. Please try again later.' })
    }
    const rc = settings.effectiveRecaptcha()
    try {
      const { form, database, table, row } = await tables.submitForm(
        String(req.params.tableId ?? ''),
        body,
        {
          verifyCaptcha: async (f) => {
            const mode = effectiveCaptchaMode(f.captcha ?? 'none', rc != null)
            if (mode === 'recaptcha') {
              return rc
                ? verifyRecaptcha(rc.secretKey, String(body['g-recaptcha-response'] ?? ''), req.ip)
                : false
            }
            if (mode === 'basic') {
              return verifyMathChallenge(
                secretsKey,
                String(body._captcha ?? ''),
                String(body._captcha_answer ?? ''),
                Date.now(),
              )
            }
            return true
          },
        },
      )
      if (form.notify) {
        const owner = database.ownerId ? await repo.getUserById(database.ownerId) : null
        const recipient = owner
          ? { email: owner.email, emailOptIn: owner.emailNotifications }
          : null
        const cols = (() => {
          try {
            return JSON.parse(table.columns) as Array<{ id: string; name: string }>
          } catch {
            return []
          }
        })()
        const nameById = new Map(cols.map((c) => [c.id, c.name]))
        const cells = JSON.parse(row.cells) as Record<string, unknown>
        const summary =
          form.fields
            .map((id) => `${nameById.get(id) ?? id}: ${cells[id] ?? ''}`)
            .join('\n')
            .slice(0, 1000) || '(no fields)'
        for (const notifier of notifiers) {
          try {
            await notifier.send(`New submission: ${table.name}`, summary, recipient)
          } catch (err) {
            server.log.warn(err, 'form submission notify failed')
          }
        }
      }
      return respond(true, { message: form.successMessage })
    } catch (err) {
      if (err instanceof TablesError) {
        return respond(false, { code: err.code === 'NOT_FOUND' ? 404 : 400, message: err.message })
      }
      throw err
    }
  })

  // An export from another app (Notion zip, Obsidian vault zip, Evernote .enex):
  // parsed into a review plan and held on the server until the import is
  // approved, so the browser only ever handles titles and structure.
  const IMPORT_MAX_BYTES = 200 * 1024 * 1024
  server.post('/api/import/archive', async (req: any, reply) => {
    const user = await userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'sign in to import' })
    const kind = String((req.query as { kind?: string }).kind ?? 'auto')
    if (!['auto', 'notion', 'obsidian', 'evernote'].includes(kind)) {
      return reply.code(400).send({ error: 'unknown import kind' })
    }
    const file = await req.file({ limits: { fileSize: IMPORT_MAX_BYTES } })
    if (!file) return reply.code(400).send({ error: 'no file' })
    const data = await file.toBuffer()
    if (file.file.truncated) {
      return reply
        .code(413)
        .send({ error: 'That export is larger than 200 MB. Export a part of it at a time.' })
    }
    try {
      const parsed = parseImport(kind as ImportKind | 'auto', file.filename, new Uint8Array(data))
      const { id, nodes } = importStash.put(user.id, parsed)
      return {
        sourceLabel: parsed.sourceLabel,
        suggestedName: parsed.suggestedName,
        suggestedCategory: parsed.suggestedCategory,
        imageBase: null,
        imageCount: parsed.files.size,
        stashId: id,
        nodes,
        warnings: parsed.warnings,
      }
    } catch (err) {
      if (err instanceof ImportFormatError) return reply.code(400).send({ error: err.message })
      server.log.error(err, 'import parse failed')
      return reply.code(400).send({ error: 'That file could not be read as an export.' })
    }
  })

  // one space as a Markdown+images zip — the UI's download-your-data button
  server.get('/api/export/space/:id', async (req: any, reply) => {
    const user = await userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'sign in first' })
    const space = await repo.getSpace(String(req.params.id ?? ''))
    if (!space || (space.ownerId !== null && space.ownerId !== user.id)) {
      return reply.code(404).send({ error: 'not found' })
    }
    const { filename, data } = await exportSpaceZip(repo, blobs, space.id)
    await audit.record({ action: 'export.space', actor: user, ip: req.ip, target: space.name })
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    reply.type('application/zip')
    return reply.send(data)
  })

  // download a full backup zip — admin only
  server.get('/api/backups/:name', async (req: any, reply) => {
    const user = await userFromRequest(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'admin only' })
    let path: string | null
    try {
      path = backup.resolve(String(req.params.name ?? ''))
    } catch {
      return reply.code(400).send({ error: 'bad name' })
    }
    if (!path) return reply.code(404).send({ error: 'not found' })
    await audit.record({
      action: 'backup.downloaded',
      actor: user,
      ip: req.ip,
      target: String(req.params.name),
    })
    reply.header('content-disposition', `attachment; filename="${String(req.params.name)}"`)
    reply.type('application/zip')
    return reply.send(createReadStream(path))
  })

  // one data table as CSV (opens directly in Excel)
  server.get('/api/export/table/:id', async (req: any, reply) => {
    const user = await userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'sign in first' })
    try {
      const { filename, csv } = await tables.exportTableCsv(user, String(req.params.id ?? ''))
      reply.header('content-disposition', `attachment; filename="${filename}"`)
      reply.type('text/csv; charset=utf-8')
      // a UTF-8 BOM so Excel reads non-ASCII correctly
      return reply.send(`﻿${csv}`)
    } catch (err) {
      if (err instanceof TablesError) return reply.code(404).send({ error: 'not found' })
      throw err
    }
  })

  // a whole database as a zip of CSVs (one per table)
  server.get('/api/export/database/:id', async (req: any, reply) => {
    const user = await userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'sign in first' })
    try {
      const { filename, data } = await tables.exportDatabaseZip(user, String(req.params.id ?? ''))
      reply.header('content-disposition', `attachment; filename="${filename}"`)
      reply.type('application/zip')
      return reply.send(data)
    } catch (err) {
      if (err instanceof TablesError) return reply.code(404).send({ error: 'not found' })
      throw err
    }
  })

  // Host-header routing for published sites. Any GET whose Host matches a
  // publicEnabled space is answered from published snapshots and never reaches
  // the app routes. The app's own host always falls through.
  const appHost = new URL(config.BASE_URL).host
  server.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET') return
    // /api/* (including public file serving) resolves by its own access rules
    if (req.url.startsWith('/api/') || req.url.startsWith('/s/')) return
    const host = (req.headers.host ?? '').toLowerCase()
    if (!host || host === appHost) return
    const url = new URL(req.url, 'http://placeholder')
    // a signed-in visitor gets an "Edit this page" link back into the app
    const viewer = await userFromRequest(req)
    await publicSrv.serve(
      host,
      decodeURIComponent(url.pathname),
      Object.fromEntries(url.searchParams),
      '',
      reply,
      { editBase: viewer ? config.BASE_URL : null },
    )
  })

  // Path-based escape hatch (/s/<host>/...) so a published site can be viewed
  // before DNS exists — same read model, same visibility rules.
  const serveByPath = async (req: any, reply: any) => {
    const host = String(req.params.host ?? '')
    const rest = `/${String(req.params['*'] ?? '')}`
    const viewer = await userFromRequest(req)
    const handled = await publicSrv.serve(
      host,
      decodeURIComponent(rest),
      req.query ?? {},
      `/s/${host}`,
      reply,
      { editBase: viewer ? config.BASE_URL : null },
    )
    if (!handled) reply.code(404).send({ error: 'no published site for this host' })
  }

  // Draft preview: the working copy of a whole space, in its real chrome, on
  // the app host — so the owner can proofread before publishing, without a
  // domain and without cutting a published version. Signed-in owner only; the
  // session cookie also authorizes the draft's images through /api/files.
  // Registered before /s/:host so the static "draft" segment wins over :host.
  const serveDraftByPath = async (req: any, reply: any) => {
    const spaceId = String(req.params.spaceId ?? '')
    const rest = `/${String(req.params['*'] ?? '')}`
    const viewer = await userFromRequest(req)
    if (!viewer) {
      // not the site's 404 — send them to the app to sign in
      return reply.redirect(config.BASE_URL)
    }
    const space = await repo.getSpace(spaceId)
    // same visibility rule as the app: household spaces open to any member,
    // a personal space only to its owner
    if (!space || (space.ownerId !== null && space.ownerId !== viewer.id)) {
      return reply.code(404).send({ error: 'not found' })
    }
    await publicSrv.serveDraft(space, decodeURIComponent(rest), `/s/draft/${spaceId}`, reply)
  }
  server.get('/s/draft/:spaceId', serveDraftByPath)
  server.get('/s/draft/:spaceId/*', serveDraftByPath)

  // Single sign-on. /login sends the browser to the identity provider; the
  // provider sends it back to /callback. `?link=1` (signed in) attaches the
  // provider identity to the current account instead of signing in.
  const OIDC_STATE_COOKIE = 'bn_oidc'
  const ssoFail = (reply: any, err: unknown, to: string) => {
    const message = err instanceof SsoError ? err.message : 'Single sign-on failed.'
    if (!(err instanceof SsoError)) server.log.error(err)
    return reply.redirect(`${to}?sso_error=${encodeURIComponent(message)}`)
  }
  server.get('/auth/oidc/login', async (req, reply) => {
    const q = req.query as { next?: string; link?: string }
    const linking = q.link === '1'
    const viewer = linking ? await userFromRequest(req) : null
    if (linking && !viewer) return reply.redirect('/')
    try {
      const { url, state } = await sso.begin({
        next: safeNext(q.next),
        mode: linking ? 'link' : 'login',
        userId: viewer?.id,
      })
      reply.setCookie(OIDC_STATE_COOKIE, state, {
        path: '/auth/oidc',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: 600,
      })
      return reply.redirect(url)
    } catch (err) {
      return ssoFail(reply, err, linking ? '/settings' : '/')
    }
  })
  server.get('/auth/oidc/callback', async (req, reply) => {
    const currentUrl = new URL(req.url, config.BASE_URL)
    const cookieState = req.cookies?.[OIDC_STATE_COOKIE]
    reply.clearCookie(OIDC_STATE_COOKIE, { path: '/auth/oidc' })
    // a failed link should land back in Settings, not on the login page
    const signedIn = await userFromRequest(req)
    try {
      const result = await sso.complete(currentUrl, cookieState)
      if (result.kind === 'link') {
        await audit.record({ action: 'auth.sso_linked', actor: result.user, ip: req.ip })
        return reply.redirect('/settings?sso=linked')
      }
      await audit.record({ action: 'auth.sso_login', actor: result.user, ip: req.ip })
      reply.setCookie(
        SESSION_COOKIE,
        result.session.token,
        sessionCookieOptions(config, result.session.expiresAt),
      )
      return reply.redirect(result.next)
    } catch (err) {
      await audit.record({
        action: 'auth.sso_failed',
        actor: signedIn,
        ip: req.ip,
        detail: { reason: err instanceof SsoError ? err.code : 'ERROR' },
      })
      return ssoFail(reply, err, signedIn ? '/settings' : '/')
    }
  })

  server.get('/s/:host', serveByPath)
  server.get('/s/:host/*', serveByPath)

  await server.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: makeCreateContext({
        config,
        repo,
        auth,
        pages,
        daily,
        tasks,
        publishing,
        attachments,
        reminders,
        mailer,
        settings,
        webhooks,
        tables,
        locks,
        backup,
        restore,
        sso,
        proxy,
        passkeys,
        audit,
        tokens,
        importStash,
        resolveSession,
      }),
    },
  })

  // personal-access-token surface: REST (/api/v1) and MCP (/api/mcp)
  registerPublicApi(server, {
    api: createPublicApi({ repo, pages, daily, tasks, locks }),
    tokens,
    version: (pkg as { version: string }).version,
  })

  server.get('/healthz', async () => ({ ok: true, dialect: appDb.dialect }))

  // the one in-process set of services (caches included) — tests must mutate
  // publish state through these, not through parallel instances
  server.decorate('bnServices', {
    repo,
    auth,
    pages,
    daily,
    tasks,
    publishing,
    attachments,
    reminders,
    scheduler,
    mailer,
    settings,
    webhooks,
    tables,
    blobs,
  })

  // the scheduler tick lives with the server lifecycle; runOnce on boot
  // catches up anything that came due while the app was down
  if (config.NODE_ENV !== 'test') {
    const TRASH_RETENTION_DAYS = 30
    let purgeTimer: ReturnType<typeof setInterval> | null = null
    const purgeTrash = async () => {
      const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      const purged = await pages.purgeExpiredTrash(cutoff)
      if (purged > 0) server.log.info(`trash purge: hard-deleted ${purged} page subtree(s)`)
      // the audit log keeps its own, much longer, window
      await audit.prune(config.AUDIT_RETENTION_DAYS)
    }
    server.addHook('onReady', async () => {
      await scheduler.runOnce()
      scheduler.start()
      await purgeTrash().catch((err) => server.log.error(err, 'trash purge failed'))
      purgeTimer = setInterval(
        () => purgeTrash().catch((err) => server.log.error(err, 'trash purge failed')),
        6 * 60 * 60 * 1000,
      )
    })
    server.addHook('onClose', async () => {
      scheduler.stop()
      if (purgeTimer) clearInterval(purgeTimer)
    })
  }

  // Serve the built SPA when present (production); in dev, Vite serves the web app.
  const webDist = config.WEB_DIST ? resolve(config.WEB_DIST) : ''
  if (webDist && existsSync(webDist)) {
    // wildcard mode resolves files per request (a rebuilt bundle is picked up
    // without a restart); missing paths fall through to the SPA fallback below
    await server.register(fastifyStatic, { root: webDist })
    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not found' })
        return
      }
      reply.sendFile('index.html')
    })
  }

  return server
}
