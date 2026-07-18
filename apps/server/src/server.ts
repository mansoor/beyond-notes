import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import { createAuthService } from './auth'
import type { Config } from './config'
import { createDailyService } from './daily'
import type { AppDb } from './db'
import { createPagesService } from './pages'
import { createPublicServer } from './public'
import { createPublishingService } from './publishing'
import { createRepo } from './repo'
import { appRouter } from './routers'
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

  // Host-header routing for published sites. Any GET whose Host matches a
  // publicEnabled space is answered from published snapshots and never reaches
  // the app routes. The app's own host always falls through.
  const appHost = new URL(config.BASE_URL).host
  server.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET') return
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
      createContext: makeCreateContext({ config, repo, auth, pages, daily, tasks, publishing }),
    },
  })

  server.get('/healthz', async () => ({ ok: true, dialect: appDb.dialect }))

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
