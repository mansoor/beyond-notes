import { createReadStream, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import { MAX_UPLOAD_BYTES, createAttachmentsService, thumbKey } from './attachments'
import { createAuthService } from './auth'
import { createDynamicBlobStore } from './blobstore-dynamic'
import { effectiveCaptchaMode, verifyMathChallenge, verifyRecaptcha } from './captcha'
import type { Config } from './config'
import { createDailyService } from './daily'
import type { AppDb } from './db'
import { exportSpaceZip } from './export'
import { createLockService } from './locks'
import { createDynamicMailer } from './mailer'
import { createPagesService } from './pages'
import { createPublicServer } from './public'
import { createPublishingService } from './publishing'
import { createRemindersService } from './reminders'
import { createRepo } from './repo'
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
import { TablesError, createTablesService } from './tables'
import { createTasksService } from './tasks'
import { makeCreateContext } from './trpc'
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
  const server = Fastify({ logger: config.NODE_ENV !== 'test' })

  await server.register(fastifyCookie)

  const repo = createRepo(appDb)
  const secretsKey = loadOrCreateSecretsKey(config)
  const settings = createSettingsService(repo, config, { secretsKey })
  await settings.load()
  const auth = createAuthService(repo)
  const pages = createPagesService(repo)
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
  // scheduled publishes run through the same tick as reminders; the job
  // carries the scheduling user so the version records who published it
  const scheduler = createScheduler(repo, notifiers, {
    publishPage: async (pageId, byUserId) => {
      const user = await repo.getUserById(byUserId)
      if (!user) throw new Error(`scheduled publish: user ${byUserId} is gone`)
      await publishing.publish(user, pageId)
    },
  })

  await server.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })

  const userFromRequest = async (req: { cookies?: Record<string, string | undefined> }) => {
    const token = req.cookies?.bn_session
    return token ? auth.userForToken(token) : null
  }

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

  // one space as a Markdown+images zip — the UI's download-your-data button
  server.get('/api/export/space/:id', async (req: any, reply) => {
    const user = await userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'sign in first' })
    const space = await repo.getSpace(String(req.params.id ?? ''))
    if (!space || (space.ownerId !== null && space.ownerId !== user.id)) {
      return reply.code(404).send({ error: 'not found' })
    }
    const { filename, data } = await exportSpaceZip(repo, blobs, space.id)
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    reply.type('application/zip')
    return reply.send(data)
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
      }),
    },
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
