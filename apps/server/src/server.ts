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

  await server.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: makeCreateContext({ config, repo, auth, pages, daily, tasks }),
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
