import '@fastify/cookie'
import { TRPCError, initTRPC } from '@trpc/server'
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import type { AccessService } from './access'
import type { ApiTokenService } from './apitokens'
import type { AttachmentsService } from './attachments'
import type { AuditService } from './audit'
import type { AuthService } from './auth'
import type { BackupService } from './backup'
import type { Config } from './config'
import type { DailyService } from './daily'
import type { Edition } from './edition'
import type { ImportStash } from './importstash'
import { type LockService, LockedError } from './locks'
import type { Mailer } from './mailer'
import type { OffsiteService } from './offsite'
import type { PagesService } from './pages'
import type { PasskeyService } from './passkeys'
import type { ProxyAuth } from './proxyauth'
import type { PublishingService } from './publishing'
import type { RemindersService } from './reminders'
import type { Repo, UserRow } from './repo'
import type { RestoreService } from './restore'
import type { SettingsService } from './settings'
import type { SsoService } from './sso'
import type { TablesService } from './tables'
import type { TasksService } from './tasks'
import type { UpdateChecker } from './updates'
import type { WebhooksService } from './webhooks'

export const SESSION_COOKIE = 'bn_session'

/** The one set of options every session cookie is written with. */
export function sessionCookieOptions(config: Config, expires: Date) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    expires,
  }
}

/** Who a request is signed in as, and with which session token. */
export type ResolveSession = (
  req: CreateFastifyContextOptions['req'],
  res: CreateFastifyContextOptions['res'],
) => Promise<{ user: UserRow | null; token: string | null }>

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
  backup: BackupService
  access: AccessService
  offsite: OffsiteService
  restore: RestoreService
  sso: SsoService
  proxy: ProxyAuth
  passkeys: PasskeyService
  audit: AuditService
  tokens: ApiTokenService
  importStash: ImportStash
  updates: UpdateChecker
  edition: Edition
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
  backup: BackupService
  access: AccessService
  offsite: OffsiteService
  restore: RestoreService
  sso: SsoService
  proxy: ProxyAuth
  passkeys: PasskeyService
  audit: AuditService
  tokens: ApiTokenService
  importStash: ImportStash
  updates: UpdateChecker
  edition: Edition
  resolveSession: ResolveSession
}) {
  const { resolveSession, ...services } = deps
  return async function createContext({ req, res }: CreateFastifyContextOptions): Promise<Context> {
    const { user, token } = await resolveSession(req, res)
    return { req, res, ...services, user, sessionToken: token }
  }
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

const signedIn = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

/**
 * A locked thing is locked for writing too.
 *
 * The lock used to be checked in one place — reading a page's document — so a
 * locked notebook hid its content while the sidebar's ⋯ and ＋ happily renamed,
 * deleted, published and added pages inside it. Rather than sprinkle a check
 * over ~20 mutations and rely on remembering it for the next one, every authed
 * *mutation* passes through here: if its input names a page or a space that
 * this session has not unlocked, it never reaches the resolver.
 *
 * Queries are deliberately not guarded. Titles and the tree still travel — you
 * have to be able to see a locked notebook to unlock it — and the two paths
 * that do expose content (pages.get, and search via hiddenPageIds) check for
 * themselves.
 */
const LOCK_ID_FIELDS = ['pageId', 'parentId', 'spaceId'] as const

export const authedProcedure = signedIn.use(async ({ ctx, type, getRawInput, next }) => {
  if (type !== 'mutation') return next()
  // this middleware sits above each procedure's .input(), so the parsed `input`
  // is not available yet — the raw body is, and ids are ids either way
  const raw = await getRawInput()
  if (!raw || typeof raw !== 'object') return next()
  const fields = raw as Record<string, unknown>

  try {
    for (const field of LOCK_ID_FIELDS) {
      const id = fields[field]
      if (typeof id !== 'string' || id === '') continue
      if (field === 'spaceId') {
        const space = await ctx.repo.getSpace(id)
        if (space?.lockPolicy && !ctx.locks.isOpen(ctx.sessionToken, { kind: 'space', id })) {
          throw new LockedError({ kind: 'space', id }, space.lockPolicy)
        }
      } else {
        const page = await ctx.repo.getPage(id)
        if (page) await ctx.locks.assertPageOpen(ctx.sessionToken, page)
      }
    }
  } catch (err) {
    // the resolvers' rethrow() is downstream of here, so translate it ourselves.
    // Unlike the read path — where pages.get answers the bare sentinel 'LOCKED'
    // and the editor swaps in its own unlock prompt — a blocked mutation shows
    // its message verbatim (e.g. in the Move dialog), so it must read as a
    // sentence. Name what is locked: moving into a locked space and editing a
    // locked page are the two ways in, and they want different nouns.
    if (err instanceof LockedError) {
      const noun = err.target.kind === 'space' ? 'space' : 'page'
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `That ${noun} is locked — unlock it first.`,
      })
    }
    throw err
  }
  return next()
})

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' })
  return next()
})
