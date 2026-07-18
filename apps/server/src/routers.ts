import '@fastify/cookie'
import type {
  AuthStatus,
  DocumentView,
  GalleryItemView,
  InviteView,
  MemoView,
  PageMeta,
  PublishingView,
  ReminderView,
  SpaceView,
  TaskView,
  UserView,
  VersionView,
} from '@bn/schema'
import {
  acceptInviteInput,
  captureMemoInput,
  createInviteInput,
  createPageInput,
  createReminderInput,
  createSpaceInput,
  journalDayInput,
  journalMonthInput,
  loginInput,
  movePageInput,
  promoteToJournalInput,
  promoteToNoteInput,
  promoteToTaskInput,
  quickAddTaskInput,
  renamePageInput,
  saveDocumentInput,
  setPageTypeInput,
  setupInput,
  toggleTaskInput,
  updatePublishingInput,
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
    publicEnabled: s.publicEnabled,
    publicHost: s.publicHost,
    publicTitle: s.publicTitle,
    publicFooter: s.publicFooter,
    publicTheme: s.publicTheme,
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
    pageType: p.pageType,
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
    .query(
      async ({
        ctx,
        input,
      }): Promise<{ page: PageMeta; doc: DocumentView; publishing: PublishingView }> => {
        try {
          const { page, doc } = await ctx.pages.getPage(ctx.user, input.pageId)
          const space = await ctx.repo.getSpace(page.spaceId)
          if (!space) throw new TRPCError({ code: 'NOT_FOUND' })
          const publishing =
            space.kind === 'tree'
              ? await ctx.publishing.status(page, space)
              : { spaceEnabled: false, host: null, live: null, pending: false, slugPath: null }
          return {
            page: toPageMeta(page),
            doc: {
              content: doc.content,
              schemaVersion: doc.schemaVersion,
              updatedAt: doc.updatedAt.toISOString(),
            },
            publishing,
          }
        } catch (err) {
          rethrow(err)
        }
      },
    ),

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

  setType: authedProcedure.input(setPageTypeInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.pages.setPageType(ctx.user, input.pageId, input.pageType)
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

const publishRouter = router({
  publish: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const version = await ctx.publishing.publish(ctx.user, input.pageId)
        return { versionId: version.id, version: version.version }
      } catch (err) {
        rethrow(err)
      }
    }),

  retire: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.publishing.retire(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  republish: authedProcedure
    .input(z.object({ pageId: z.string(), versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.publishing.republish(ctx.user, input.pageId, input.versionId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  versions: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .query(async ({ ctx, input }): Promise<VersionView[]> => {
      try {
        const { page, versions } = await ctx.publishing.versions(ctx.user, input.pageId)
        return versions.map((v) => ({
          id: v.id,
          version: v.version,
          title: v.title,
          createdAt: v.createdAt.toISOString(),
          isLive: page.liveVersionId === v.id,
        }))
      } catch (err) {
        rethrow(err)
      }
    }),

  updateSpace: authedProcedure.input(updatePublishingInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.publishing.updateSpacePublishing(ctx.user, input)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),
})

const journalRouter = router({
  day: authedProcedure
    .input(journalDayInput)
    .query(async ({ ctx, input }): Promise<{ page: PageMeta; doc: DocumentView }> => {
      try {
        const { page, doc } = await ctx.daily.day(ctx.user, input.date)
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

  days: authedProcedure.input(journalMonthInput).query(async ({ ctx, input }) => {
    try {
      return await ctx.daily.days(ctx.user, input.month)
    } catch (err) {
      rethrow(err)
    }
  }),
})

const memosRouter = router({
  list: authedProcedure.query(async ({ ctx }): Promise<MemoView[]> => {
    const memos = await ctx.daily.listMemos(ctx.user)
    return memos.map((m) => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      promotedTo: m.promotedTo,
    }))
  }),

  capture: authedProcedure.input(captureMemoInput).mutation(async ({ ctx, input }) => {
    const memo = await ctx.daily.capture(ctx.user, input.content)
    return { id: memo.id }
  }),

  promoteToNote: authedProcedure.input(promoteToNoteInput).mutation(async ({ ctx, input }) => {
    try {
      const page = await ctx.daily.promoteToNote(ctx.user, input.memoId, input.spaceId)
      return toPageMeta(page)
    } catch (err) {
      rethrow(err)
    }
  }),

  promoteToJournal: authedProcedure
    .input(promoteToJournalInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.daily.promoteToJournal(ctx.user, input.memoId, input.date)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  promoteToTask: authedProcedure.input(promoteToTaskInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.daily.promoteToTask(ctx.user, input.memoId)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  delete: authedProcedure
    .input(z.object({ memoId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.daily.deleteMemo(ctx.user, input.memoId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),
})

const tasksRouter = router({
  agenda: authedProcedure.query(async ({ ctx }): Promise<TaskView[]> => {
    const rows = await ctx.tasks.agenda(ctx.user)
    return rows.map(({ task, page, space }) => ({
      id: task.id,
      pageId: task.pageId,
      blockId: task.blockId,
      text: task.text,
      checked: task.checked,
      due: task.due,
      pageTitle: page.title,
      spaceName: space.name,
      isJournal: space.kind === 'journal',
    }))
  }),

  toggle: authedProcedure.input(toggleTaskInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.tasks.toggle(ctx.user, input.taskId, input.checked)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  quickAdd: authedProcedure.input(quickAddTaskInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.daily.quickAddTask(ctx.user, input.text)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),
})

const remindersRouter = router({
  list: authedProcedure.query(async ({ ctx }): Promise<ReminderView[]> => {
    const rows = await ctx.reminders.list(ctx.user)
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: r.dueDate,
      dueTime: r.dueTime,
      freq: r.freq,
      interval: r.interval,
      headsUpDays: r.headsUpDays,
      completed: r.completedAt !== null,
    }))
  }),

  create: authedProcedure.input(createReminderInput).mutation(async ({ ctx, input }) => {
    try {
      const reminder = await ctx.reminders.create(ctx.user, input)
      return { id: reminder.id }
    } catch (err) {
      rethrow(err)
    }
  }),

  complete: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      await ctx.reminders.complete(ctx.user, input.id)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  delete: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      await ctx.reminders.remove(ctx.user, input.id)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),
})

const galleryRouter = router({
  list: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .query(async ({ ctx, input }): Promise<GalleryItemView[]> => {
      try {
        await ctx.pages.getPage(ctx.user, input.pageId) // access check
        const items = await ctx.attachments.listGallery(input.pageId)
        return items.map((i) => ({
          id: i.id,
          attachmentId: i.attachmentId,
          caption: i.caption,
          position: i.position,
          url: `/api/files/${i.attachmentId}`,
          thumbUrl: `/api/files/${i.attachmentId}/thumb`,
        }))
      } catch (err) {
        rethrow(err)
      }
    }),

  add: authedProcedure
    .input(z.object({ pageId: z.string(), attachmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.getPage(ctx.user, input.pageId)
        await ctx.attachments.addToGallery(input.pageId, input.attachmentId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  caption: authedProcedure
    .input(z.object({ pageId: z.string(), itemId: z.string(), caption: z.string().max(300) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.getPage(ctx.user, input.pageId)
        await ctx.attachments.setCaption(input.itemId, input.caption)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  remove: authedProcedure
    .input(z.object({ pageId: z.string(), itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.getPage(ctx.user, input.pageId)
        await ctx.attachments.removeFromGallery(input.itemId)
        return { ok: true }
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
  publish: publishRouter,
  gallery: galleryRouter,
  reminders: remindersRouter,
  journal: journalRouter,
  memos: memosRouter,
  tasks: tasksRouter,
  me: authedProcedure.query(({ ctx }) => toUserView(ctx.user)),
})

export type AppRouter = typeof appRouter
