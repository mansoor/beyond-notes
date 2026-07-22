import '@fastify/cookie'
import { TRPCError, initTRPC } from '@trpc/server'
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import type { AttachmentsService } from './attachments'
import type { AuthService } from './auth'
import type { Config } from './config'
import type { DailyService } from './daily'
import type { LockService } from './locks'
import type { Mailer } from './mailer'
import type { PagesService } from './pages'
import type { PublishingService } from './publishing'
import type { RemindersService } from './reminders'
import type { Repo, UserRow } from './repo'
import type { SettingsService } from './settings'
import type { TablesService } from './tables'
import type { TasksService } from './tasks'
import type { WebhooksService } from './webhooks'

export const SESSION_COOKIE = 'bn_session'

export type Context = {
  req: CreateFastifyContextOptions['req']
  res: CreateFastifyContextOptions['res']
  config: Config
  repo: Repo
  auth: AuthService
  pages: PagesService
  daily: DailyService
  tasks: TasksService
  publishing: PublishingService
  attachments: AttachmentsService
  reminders: RemindersService
  mailer: Mailer
  settings: SettingsService
  webhooks: WebhooksService
  tables: TablesService
  locks: LockService
  user: UserRow | null
  sessionToken: string | null
}

export function makeCreateContext(deps: {
  config: Config
  repo: Repo
  auth: AuthService
  pages: PagesService
  daily: DailyService
  tasks: TasksService
  publishing: PublishingService
  attachments: AttachmentsService
  reminders: RemindersService
  mailer: Mailer
  settings: SettingsService
  webhooks: WebhooksService
  tables: TablesService
  locks: LockService
}) {
  return async function createContext({ req, res }: CreateFastifyContextOptions): Promise<Context> {
    const sessionToken =
      (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE] ?? null
    const user = sessionToken ? await deps.auth.userForToken(sessionToken) : null
    return { req, res, ...deps, user, sessionToken }
  }
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' })
  return next()
})
