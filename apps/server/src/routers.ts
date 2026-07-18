import '@fastify/cookie'
import type { AuthStatus, InviteView, UserView } from '@bn/schema'
import { acceptInviteInput, createInviteInput, loginInput, setupInput } from '@bn/schema'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { AuthError } from './auth'
import type { InviteRow, UserRow } from './repo'
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
  throw err
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

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  me: authedProcedure.query(({ ctx }) => toUserView(ctx.user)),
})

export type AppRouter = typeof appRouter
