import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import { MAX_UPLOAD_BYTES, createAttachmentsService, thumbKey } from './attachments'
import { createAuthService } from './auth'
import { createFsBlobStore } from './blobstore'
import type { Config } from './config'
import { createDailyService } from './daily'
import type { AppDb } from './db'
import { createLogMailer, createSmtpMailer, mailConfigured } from './mailer'
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
import { createTasksService } from './tasks'
import { makeCreateContext } from './trpc'

export async function buildServer(config: Config, appDb: AppDb) {
  const server = Fastify({ logger: config.NODE_ENV !== 'test' })

  await server.register(fastifyCookie)

  const repo = createRepo(appDb)
  const auth = createAuthService(repo)
  const pages = createPagesService(repo)
  const daily = createDailyService(repo)
  const tasks = createTasksService(repo)
  const publishing = createPublishingService(repo)
  const publicSrv = createPublicServer(repo, publishing)
  const blobs = createFsBlobStore(config.UPLOADS_DIR)
  const attachments = createAttachmentsService(repo, blobs)
  const reminders = createRemindersService(repo)

  const mailer = mailConfigured(config)
    ? createSmtpMailer(config)
    : createLogMailer((msg) => server.log.info(msg))

  const notifiers: Notifier[] = []
  if (config.NTFY_URL && config.NTFY_TOPIC) {
    notifiers.push(createNtfyNotifier(config.NTFY_URL, config.NTFY_TOPIC))
  }
  if (mailer.configured) notifiers.push(createEmailNotifier(mailer))
  notifiers.push(createLogNotifier((msg) => server.log.info(msg)))
  const scheduler = createScheduler(repo, notifiers)

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
      // same shape as a missing file: existence of private uploads is private
      return reply.code(404).send({ error: 'not found' })
    }
    const key =
      thumb && blobs.exists(thumbKey(attachment.hash)) ? thumbKey(attachment.hash) : attachment.hash
    if (!blobs.exists(key)) return reply.code(404).send({ error: 'not found' })
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.type(attachment.mime)
    return reply.send(blobs.getStream(key))
  }
  server.get('/api/files/:id', (req, reply) => serveFile(req, reply, false))
  server.get('/api/files/:id/thumb', (req, reply) => serveFile(req, reply, true))

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
    await publicSrv.serve(
      host,
      decodeURIComponent(url.pathname),
      Object.fromEntries(url.searchParams),
      '',
      reply,
    )
  })

  // Path-based escape hatch (/s/<host>/...) so a published site can be viewed
  // before DNS exists — same read model, same visibility rules.
  const serveByPath = async (req: any, reply: any) => {
    const host = String(req.params.host ?? '')
    const rest = `/${String(req.params['*'] ?? '')}`
    const handled = await publicSrv.serve(
      host,
      decodeURIComponent(rest),
      req.query ?? {},
      `/s/${host}`,
      reply,
    )
    if (!handled) reply.code(404).send({ error: 'no published site for this host' })
  }
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
  })

  // the scheduler tick lives with the server lifecycle; runOnce on boot
  // catches up anything that came due while the app was down
  if (config.NODE_ENV !== 'test') {
    server.addHook('onReady', async () => {
      await scheduler.runOnce()
      scheduler.start()
    })
    server.addHook('onClose', async () => {
      scheduler.stop()
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
