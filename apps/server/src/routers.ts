import '@fastify/cookie'
import type {
  AuthStatus,
  DocumentView,
  InviteView,
  PageMeta,
  SpaceView,
  UserView,
} from '@bn/schema'
import {
  acceptInviteInput,
  createInviteInput,
  createPageInput,
  createSpaceInput,
  loginInput,
  movePageInput,
  renamePageInput,
  saveDocumentInput,
  setupInput,
} from '@bn/schema'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { AuthError } from './auth'
import { PagesError } from './pages'
import type { InviteRow, PageRow, SpaceRow, UserRow } from './repo'
import { SESSION_COOKIE, adminProcedure, authedProcedure, publicProcedure, router } from './trpc'
import type { Context } from './trpc'

function toUserView(u: UserRow): UserView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  }
}

function toInviteView(i: InviteRow, now: Date): InviteView {
  let status: InviteView['status'] = 'pending'
  if (i.usedAt) status = 'used'
  else if (i.revokedAt) status = 'revoked'
  else if (i.expiresAt.getTime() < now.getTime()) status = 'expired'
  return {
    id: i.id,
    suggestedEmail: i.suggestedEmail,
    role: i.role,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    status,
  }
}

function setSessionCookie(ctx: Context, token: string, expiresAt: Date) {
  ctx.res.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    expires: expiresAt,
  })
}

function clearSessionCookie(ctx: Context) {
  ctx.res.clearCookie(SESSION_COOKIE, { path: '/' })
}

function rethrow(err: unknown): never {
  if (err instanceof AuthError) {
    const code =
      err.code === 'RATE_LIMITED'
        ? 'TOO_MANY_REQUESTS'
        : err.code === 'BAD_CREDENTIALS'
          ? 'UNAUTHORIZED'
          : 'BAD_REQUEST'
    throw new TRPCError({ code, message: err.message })
  }
  if (err instanceof PagesError) {
    const code =
      err.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : err.code === 'FORBIDDEN'
          ? 'FORBIDDEN'
          : err.code === 'CONFLICT'
            ? 'CONFLICT'
            : 'BAD_REQUEST'
    throw new TRPCError({ code, message: err.message })
  }
  throw err
}

function toSpaceView(s: SpaceRow): SpaceView {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    personal: s.ownerId !== null,
    createdAt: s.createdAt.toISOString(),
  }
}

function toPageMeta(p: PageRow): PageMeta {
  return {
    id: p.id,
    spaceId: p.spaceId,
    parentId: p.parentId,
    title: p.title,
    position: p.position,
  }
}

const authRouter = router({
  status: publicProcedure.query(async ({ ctx }): Promise<AuthStatus> => {
    return {
      needsSetup: await ctx.auth.needsSetup(),
      me: ctx.user ? toUserView(ctx.user) : null,
    }
  }),

  setup: publicProcedure.input(setupInput).mutation(async ({ ctx, input }) => {
    try {
      const { user, session } = await ctx.auth.setup(input)
      setSessionCookie(ctx, session.token, session.expiresAt)
      return toUserView(user)
    } catch (err) {
      rethrow(err)
    }
  }),

  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    try {
      const { user, session } = await ctx.auth.login(input)
      setSessionCookie(ctx, session.token, session.expiresAt)
      return toUserView(user)
    } catch (err) {
      rethrow(err)
    }
  }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) await ctx.auth.logout(ctx.sessionToken)
    clearSessionCookie(ctx)
    return { ok: true }
  }),

  invitePreview: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.auth.inviteForToken(input.token)
      return invite
        ? { valid: true as const, suggestedEmail: invite.suggestedEmail }
        : { valid: false as const }
    }),

  acceptInvite: publicProcedure.input(acceptInviteInput).mutation(async ({ ctx, input }) => {
    try {
      const { user, session } = await ctx.auth.acceptInvite(input)
      setSessionCookie(ctx, session.token, session.expiresAt)
      return toUserView(user)
    } catch (err) {
      rethrow(err)
    }
  }),
})

const usersRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const users = await ctx.repo.listUsers()
    return users.map(toUserView)
  }),

  invites: adminProcedure.query(async ({ ctx }) => {
    const invites = await ctx.repo.listInvites()
    const now = new Date()
    return invites.map((i) => toInviteView(i, now))
  }),

  createInvite: adminProcedure.input(createInviteInput).mutation(async ({ ctx, input }) => {
    const { token, invite } = await ctx.auth.createInvite(ctx.user.id, input)
    return {
      token,
      invite: toInviteView(invite, new Date()),
      url: `${ctx.config.BASE_URL}/invite/${token}`,
    }
  }),

  revokeInvite: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.auth.revokeInvite(input.id)
      return { ok: true }
    }),
})

const spacesRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const spaces = await ctx.pages.listSpaces(ctx.user)
    return spaces.map(toSpaceView)
  }),

  create: authedProcedure.input(createSpaceInput).mutation(async ({ ctx, input }) => {
    try {
      return toSpaceView(await ctx.pages.createSpace(ctx.user, input))
    } catch (err) {
      rethrow(err)
    }
  }),

  rename: authedProcedure
    .input(z.object({ spaceId: z.string(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.renameSpace(ctx.user, input.spaceId, input.name)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  delete: authedProcedure
    .input(z.object({ spaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.deleteSpace(ctx.user, input.spaceId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),
})

const pagesRouter = router({
  tree: authedProcedure
    .input(z.object({ spaceId: z.string() }))
    .query(async ({ ctx, input }): Promise<PageMeta[]> => {
      try {
        return (await ctx.pages.tree(ctx.user, input.spaceId)).map(toPageMeta)
      } catch (err) {
        rethrow(err)
      }
    }),

  create: authedProcedure.input(createPageInput).mutation(async ({ ctx, input }) => {
    try {
      return toPageMeta(await ctx.pages.createPage(ctx.user, input))
    } catch (err) {
      rethrow(err)
    }
  }),

  get: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .query(async ({ ctx, input }): Promise<{ page: PageMeta; doc: DocumentView }> => {
      try {
        const { page, doc } = await ctx.pages.getPage(ctx.user, input.pageId)
        return {
          page: toPageMeta(page),
          doc: {
            content: doc.content,
            schemaVersion: doc.schemaVersion,
            updatedAt: doc.updatedAt.toISOString(),
          },
        }
      } catch (err) {
        rethrow(err)
      }
    }),

  rename: authedProcedure.input(renamePageInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.pages.renamePage(ctx.user, input.pageId, input.title)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  move: authedProcedure.input(movePageInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.pages.movePage(ctx.user, input)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  delete: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.deletePage(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  saveDoc: authedProcedure.input(saveDocumentInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.pages.saveDocument(ctx.user, input)
    } catch (err) {
      rethrow(err)
    }
  }),
})

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  spaces: spacesRouter,
  pages: pagesRouter,
  me: authedProcedure.query(({ ctx }) => toUserView(ctx.user)),
})

export type AppRouter = typeof appRouter
