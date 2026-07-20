import '@fastify/cookie'
import { plainText as plainTextOf } from '@bn/renderer'
import type {
  ArchivedPageView,
  AuthStatus,
  BacklinkView,
  DocumentView,
  GalleryItemView,
  InviteView,
  MemoView,
  PageMeta,
  PageTagView,
  PinView,
  PublishingView,
  RecentPage,
  ReminderView,
  SearchResult,
  SessionView,
  SpaceView,
  TagCount,
  TagItem,
  TaskView,
  TemplateView,
  TrashedPageView,
  UserView,
  VersionView,
  WebhookView,
} from '@bn/schema'
import {
  acceptInviteInput,
  captureMemoInput,
  changePasswordInput,
  createDayNoteInput,
  createInviteInput,
  createPageInput,
  createReminderInput,
  createSpaceInput,
  createTemplateInput,
  createWebhookInput,
  journalDayInput,
  journalMonthInput,
  loginInput,
  movePageInput,
  ntfySettings,
  pageTagInput,
  promoteToJournalInput,
  promoteToNoteInput,
  promoteToTaskInput,
  quickAddTaskInput,
  renamePageInput,
  requestPasswordResetInput,
  resetPasswordInput,
  saveDocumentInput,
  setPageTypeInput,
  setupInput,
  smtpSettings,
  storageSettings,
  toggleTaskInput,
  totpConfirmInput,
  updatePageOptionsInput,
  updateProfileInput,
  updatePublishingInput,
} from '@bn/schema'
import { TRPCError } from '@trpc/server'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { AuthError } from './auth'
import { createS3BlobStore } from './blobstore-s3'
import { inviteEmail, passwordResetEmail } from './mailer'
import { PagesError } from './pages'
import type { InviteRow, PageRow, SpaceRow, UserRow, WebhookRow } from './repo'
import { extractTagsFromText } from './tags'
import { SESSION_COOKIE, adminProcedure, authedProcedure, publicProcedure, router } from './trpc'
import type { Context } from './trpc'

function toUserView(u: UserRow): UserView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailNotifications: u.emailNotifications,
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
    publicAppearance: s.publicAppearance,
    publicSocial: parseSocial(s.publicSocial),
    publicLogoAttachmentId: s.publicLogoAttachmentId,
    publicTagline: s.publicTagline,
    publicHeaderLayout: s.publicHeaderLayout,
    createdAt: s.createdAt.toISOString(),
  }
}

function parseSocial(raw: string): SpaceView['publicSocial'] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
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
    galleryLayout: p.galleryLayout,
    galleryAutoplaySecs: p.galleryAutoplaySecs,
    shareEnabled: p.shareEnabled,
    coverAttachmentId: p.coverAttachmentId,
  }
}

const authRouter = router({
  status: publicProcedure.query(async ({ ctx }): Promise<AuthStatus> => {
    return {
      needsSetup: await ctx.auth.needsSetup(),
      me: ctx.user ? toUserView(ctx.user) : null,
      mailConfigured: ctx.mailer.configured,
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

  requestPasswordReset: publicProcedure
    .input(requestPasswordResetInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.auth.requestPasswordReset(input.email)
        if (result && ctx.mailer.configured) {
          const mail = passwordResetEmail(ctx.config.BASE_URL, result.token)
          await ctx.mailer.send(result.user.email, mail.subject, mail.text)
        }
        // identical response whether or not the account exists
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  resetPassword: publicProcedure.input(resetPasswordInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.auth.resetPassword(input.token, input.password)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  setEmailNotifications: authedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.repo.updateUser(ctx.user.id, { emailNotifications: input.enabled })
      return { ok: true }
    }),

  changePassword: authedProcedure.input(changePasswordInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.auth.changePassword(ctx.user, input.current, input.next)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  updateProfile: authedProcedure.input(updateProfileInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.auth.updateProfile(ctx.user, input)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  totpStart: authedProcedure.mutation(async ({ ctx }) => {
    try {
      return await ctx.auth.totpStart(ctx.user)
    } catch (err) {
      rethrow(err)
    }
  }),

  totpConfirm: authedProcedure.input(totpConfirmInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.auth.totpConfirm(ctx.user, input.code)
    } catch (err) {
      rethrow(err)
    }
  }),

  totpDisable: authedProcedure
    .input(z.object({ password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.auth.totpDisable(ctx.user, input.password)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  sessions: authedProcedure.query(async ({ ctx }): Promise<SessionView[]> => {
    const sessions = await ctx.auth.listSessions(ctx.user, ctx.sessionToken)
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.current,
    }))
  }),

  revokeSession: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.auth.revokeSession(ctx.user, input.sessionId)
      return { ok: true }
    }),
})

const searchRouter = router({
  all: authedProcedure
    .input(z.object({ q: z.string().trim().min(2).max(100) }))
    .query(async ({ ctx, input }): Promise<SearchResult[]> => {
      const [pages, memos, spaces] = await Promise.all([
        ctx.repo.searchPages(input.q),
        ctx.repo.searchMemos(ctx.user.id, input.q),
        ctx.repo.listSpaces(),
      ])
      const accessible = new Map(
        spaces.filter((s) => s.ownerId === null || s.ownerId === ctx.user.id).map((s) => [s.id, s]),
      )
      const results: SearchResult[] = []
      const needle = input.q.toLowerCase()
      for (const { page, content } of pages) {
        const space = accessible.get(page.spaceId)
        if (!space) continue
        const text = plainTextOf(content)
        const idx = text.toLowerCase().indexOf(needle)
        results.push({
          kind: 'page',
          id: page.id,
          title: page.title,
          context: space.kind === 'journal' ? 'Journal' : space.name,
          snippet: idx >= 0 ? text.slice(Math.max(0, idx - 40), idx + 80) : text.slice(0, 100),
        })
      }
      for (const memo of memos) {
        results.push({
          kind: 'memo',
          id: memo.id,
          title: memo.content.slice(0, 80),
          context: 'Inbox',
          snippet: memo.createdAt.toLocaleDateString(),
        })
      }
      return results.slice(0, 30)
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
    let emailed = false
    if (input.sendEmail && input.suggestedEmail && ctx.mailer.configured) {
      const mail = inviteEmail(ctx.config.BASE_URL, token, ctx.user.name)
      await ctx.mailer.send(input.suggestedEmail, mail.subject, mail.text)
      emailed = true
    }
    return {
      token,
      invite: toInviteView(invite, new Date()),
      url: `${ctx.config.BASE_URL}/invite/${token}`,
      emailed,
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

  /** "Delete" from the UI is soft — the subtree moves to the 30-day trash. */
  delete: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.trashPage(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  trashed: authedProcedure.query(async ({ ctx }): Promise<TrashedPageView[]> => {
    const items = await ctx.pages.listTrashed(ctx.user)
    const users = new Map((await ctx.repo.listUsers()).map((u) => [u.id, u.name]))
    return items.map(({ page, space }) => {
      const trashedAt = page.trashedAt as Date
      return {
        id: page.id,
        title: page.title,
        pageType: page.pageType,
        spaceName: space.name,
        trashedAt: trashedAt.toISOString(),
        trashedByName: (page.trashedBy && users.get(page.trashedBy)) || 'unknown',
        purgeAt: new Date(trashedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }
    })
  }),

  restoreTrashed: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.restoreTrashedPage(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  deleteForever: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.deleteForever(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  duplicate: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }): Promise<PageMeta> => {
      try {
        return toPageMeta(await ctx.pages.duplicatePage(ctx.user, input.pageId))
      } catch (err) {
        rethrow(err)
      }
    }),

  /** Pages whose text links to this one (the rail's "Linked from" card). */
  backlinks: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .query(async ({ ctx, input }): Promise<BacklinkView[]> => {
      await ctx.pages.getPage(ctx.user, input.pageId) // access check
      const [fromIds, pages, spaces] = await Promise.all([
        ctx.repo.listBacklinks(input.pageId),
        ctx.repo.listAllPages(),
        ctx.repo.listSpaces(),
      ])
      const spaceById = new Map(
        spaces.filter((s) => s.ownerId === null || s.ownerId === ctx.user.id).map((s) => [s.id, s]),
      )
      const byId = new Map(pages.map((p) => [p.id, p]))
      return fromIds
        .flatMap((id) => {
          const page = byId.get(id)
          const space = page ? spaceById.get(page.spaceId) : undefined
          if (!page || !space || page.archivedAt || page.trashedAt) return []
          return [{ id: page.id, title: page.title, spaceName: space.name }]
        })
        .sort((a, b) => a.title.localeCompare(b.title))
    }),

  updateOptions: authedProcedure.input(updatePageOptionsInput).mutation(async ({ ctx, input }) => {
    try {
      await ctx.pages.updatePageOptions(ctx.user, input)
      return { ok: true }
    } catch (err) {
      rethrow(err)
    }
  }),

  archive: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.archivePage(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  restore: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.pages.restorePage(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),

  archived: authedProcedure.query(async ({ ctx }): Promise<ArchivedPageView[]> => {
    const items = await ctx.pages.listArchived(ctx.user)
    const users = new Map((await ctx.repo.listUsers()).map((u) => [u.id, u.name]))
    return items.map(({ page, space }) => ({
      id: page.id,
      title: page.title,
      pageType: page.pageType,
      spaceName: space.name,
      archivedAt: (page.archivedAt as Date).toISOString(),
      archivedByName: (page.archivedBy && users.get(page.archivedBy)) || 'unknown',
    }))
  }),

  /** Most recently edited pages across accessible tree spaces (Today rail). */
  recent: authedProcedure.query(async ({ ctx }): Promise<RecentPage[]> => {
    const [pages, spaces] = await Promise.all([ctx.repo.listAllPages(), ctx.repo.listSpaces()])
    const spaceById = new Map(
      spaces
        .filter((s) => s.kind === 'tree' && (s.ownerId === null || s.ownerId === ctx.user.id))
        .map((s) => [s.id, s]),
    )
    return pages
      .filter((p) => spaceById.has(p.spaceId) && !p.archivedAt && !p.trashedAt)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 8)
      .map((p) => ({
        id: p.id,
        title: p.title,
        spaceName: (spaceById.get(p.spaceId) as SpaceRow).name,
        pageType: p.pageType,
        updatedAt: p.updatedAt.toISOString(),
      }))
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
          textPlain: v.textPlain,
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

  /** All notes for one day: the main note plus any topic notes. */
  notes: authedProcedure.input(journalDayInput).query(async ({ ctx, input }) => {
    try {
      const notes = await ctx.daily.dayNotes(ctx.user, input.date)
      return notes.map(({ page, doc, main }) => ({
        page: toPageMeta(page),
        doc: {
          content: doc.content,
          schemaVersion: doc.schemaVersion,
          updatedAt: doc.updatedAt.toISOString(),
        },
        main,
      }))
    } catch (err) {
      rethrow(err)
    }
  }),

  createNote: authedProcedure.input(createDayNoteInput).mutation(async ({ ctx, input }) => {
    try {
      const page = await ctx.daily.createDayNote(ctx.user, input.date, input.title)
      return toPageMeta(page)
    } catch (err) {
      rethrow(err)
    }
  }),

  deleteNote: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.daily.deleteDayNote(ctx.user, input.pageId)
        return { ok: true }
      } catch (err) {
        rethrow(err)
      }
    }),
})

const tagsRouter = router({
  /** Every tag visible to this user, with counts (pages + own memos). */
  all: authedProcedure.query(async ({ ctx }): Promise<TagCount[]> => {
    const [tagRows, pages, spaces, memos] = await Promise.all([
      ctx.repo.listAllPageTags(),
      ctx.repo.listAllPages(),
      ctx.repo.listSpaces(),
      ctx.repo.listMemos(ctx.user.id),
    ])
    const accessible = new Set(
      spaces.filter((s) => s.ownerId === null || s.ownerId === ctx.user.id).map((s) => s.id),
    )
    const visible = new Map(
      pages
        .filter((p) => accessible.has(p.spaceId) && !p.archivedAt && !p.trashedAt)
        .map((p) => [p.id, p]),
    )
    const counts = new Map<string, number>()
    for (const row of tagRows) {
      if (!visible.has(row.pageId)) continue
      counts.set(row.tag, (counts.get(row.tag) ?? 0) + 1)
    }
    for (const memo of memos) {
      for (const tag of extractTagsFromText(memo.content)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }),

  /** Everything carrying one tag: accessible pages plus the user's memos. */
  items: authedProcedure
    .input(z.object({ tag: z.string().trim().min(1).max(50) }))
    .query(async ({ ctx, input }): Promise<TagItem[]> => {
      const tag = input.tag.toLowerCase()
      const [pageIds, pages, spaces, memos] = await Promise.all([
        ctx.repo.listPageIdsByTag(tag),
        ctx.repo.listAllPages(),
        ctx.repo.listSpaces(),
        ctx.repo.listMemos(ctx.user.id),
      ])
      const spaceById = new Map(
        spaces.filter((s) => s.ownerId === null || s.ownerId === ctx.user.id).map((s) => [s.id, s]),
      )
      const byId = new Map(pages.map((p) => [p.id, p]))
      const items: TagItem[] = []
      for (const id of pageIds) {
        const page = byId.get(id)
        const space = page ? spaceById.get(page.spaceId) : undefined
        if (!page || !space || page.archivedAt || page.trashedAt) continue
        // the user's own journal only; other users' journals are not accessible anyway
        const isJournal = space.kind === 'journal'
        items.push({
          kind: 'page',
          id: page.id,
          title: page.title,
          context: isJournal ? 'Journal' : space.name,
          dateKey: isJournal ? page.dateKey : null,
        })
      }
      for (const memo of memos) {
        if (!extractTagsFromText(memo.content).includes(tag)) continue
        items.push({
          kind: 'memo',
          id: memo.id,
          title: memo.content.slice(0, 100),
          context: 'Inbox',
          dateKey: null,
        })
      }
      return items
    }),

  /** Tags on one page, inline-detected and manual together (context rail). */
  forPage: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .query(async ({ ctx, input }): Promise<PageTagView[]> => {
      await ctx.pages.getPage(ctx.user, input.pageId) // access check
      const rows = await ctx.repo.listPageTags(input.pageId)
      return rows.sort((a, b) => a.tag.localeCompare(b.tag))
    }),

  add: authedProcedure.input(pageTagInput).mutation(async ({ ctx, input }) => {
    await ctx.pages.getPage(ctx.user, input.pageId)
    await ctx.repo.addManualPageTag(input.pageId, input.tag)
    return { ok: true }
  }),

  /** Only manual tags can be removed here; inline ones live in the text. */
  remove: authedProcedure.input(pageTagInput).mutation(async ({ ctx, input }) => {
    await ctx.pages.getPage(ctx.user, input.pageId)
    await ctx.repo.removeManualPageTag(input.pageId, input.tag)
    return { ok: true }
  }),
})

const pinsRouter = router({
  list: authedProcedure.query(async ({ ctx }): Promise<PinView[]> => {
    const [pins, pages] = await Promise.all([
      ctx.repo.listPins(ctx.user.id),
      ctx.repo.listAllPages(),
    ])
    const byId = new Map(pages.map((p) => [p.id, p]))
    return pins
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .flatMap((pin) => {
        const page = byId.get(pin.pageId)
        if (!page || page.archivedAt || page.trashedAt) return []
        return [{ pageId: page.id, title: page.title, pageType: page.pageType }]
      })
  }),

  toggle: authedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.pages.getPage(ctx.user, input.pageId)
      const pins = await ctx.repo.listPins(ctx.user.id)
      const pinned = pins.some((p) => p.pageId === input.pageId)
      if (pinned) await ctx.repo.removePin(ctx.user.id, input.pageId)
      else await ctx.repo.addPin(ctx.user.id, input.pageId, new Date())
      return { pinned: !pinned }
    }),
})

const templatesRouter = router({
  list: authedProcedure.query(async ({ ctx }): Promise<TemplateView[]> => {
    const rows = await ctx.repo.listTemplates()
    return rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString() }))
  }),

  /** Snapshot a page's current content as a reusable skeleton. */
  create: authedProcedure.input(createTemplateInput).mutation(async ({ ctx, input }) => {
    const { doc } = await ctx.pages.getPage(ctx.user, input.pageId)
    await ctx.repo.insertTemplate({
      id: nanoid(),
      name: input.name,
      content: doc.content,
      createdBy: ctx.user.id,
      createdAt: new Date(),
    })
    return { ok: true }
  }),

  /** Content fetch for applying to an empty page (client saves via saveDoc). */
  content: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<{ content: string }> => {
      const row = await ctx.repo.getTemplate(input.id)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' })
      return { content: row.content }
    }),

  delete: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.repo.deleteTemplate(input.id)
    return { ok: true }
  }),
})

const settingsRouter = router({
  get: adminProcedure.query(async ({ ctx }) => ctx.settings.view()),

  saveSmtp: adminProcedure.input(smtpSettings).mutation(async ({ ctx, input }) => {
    await ctx.settings.saveSmtp(input)
    return ctx.settings.view()
  }),

  saveNtfy: adminProcedure.input(ntfySettings).mutation(async ({ ctx, input }) => {
    await ctx.settings.saveNtfy(input)
    return ctx.settings.view()
  }),

  saveStorage: adminProcedure.input(storageSettings).mutation(async ({ ctx, input }) => {
    if (input.driver === 's3') {
      // probe before committing: a bad bucket must fail the save, not the
      // next photo upload
      const secret = input.s3SecretKey || ctx.settings.storage()?.s3SecretKey || ''
      if (!input.s3Bucket) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'S3 needs a bucket name.' })
      }
      const probe = createS3BlobStore({
        bucket: input.s3Bucket,
        endpoint: input.s3Endpoint,
        region: input.s3Region,
        accessKey: input.s3AccessKey,
        secretKey: secret,
        forcePathStyle: input.s3ForcePathStyle,
      })
      const key = `probe-${Date.now().toString(36)}`
      try {
        await probe.put(key, Buffer.from('beyond-notes storage probe'))
        await probe.read(key)
        await probe.delete(key)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'connection failed'
        throw new TRPCError({ code: 'BAD_REQUEST', message: `S3 check failed: ${message}` })
      }
    }
    await ctx.settings.saveStorage(input)
    return ctx.settings.view()
  }),
})

function toWebhookView(w: WebhookRow): WebhookView {
  return {
    id: w.id,
    target: w.target,
    label: w.label,
    createdAt: w.createdAt.toISOString(),
    lastUsedAt: w.lastUsedAt?.toISOString() ?? null,
    revoked: w.revokedAt !== null,
  }
}

const webhooksRouter = router({
  list: authedProcedure.query(async ({ ctx }): Promise<WebhookView[]> => {
    const rows = await ctx.webhooks.list(ctx.user.id)
    return rows.map(toWebhookView)
  }),

  create: authedProcedure.input(createWebhookInput).mutation(async ({ ctx, input }) => {
    const { token, row } = await ctx.webhooks.create(ctx.user.id, input)
    return {
      webhook: toWebhookView(row),
      url: `${ctx.config.BASE_URL}/api/hooks/${token}`,
    }
  }),

  revoke: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      await ctx.webhooks.revoke(ctx.user.id, input.id)
      return { ok: true }
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
  search: searchRouter,
  journal: journalRouter,
  memos: memosRouter,
  tasks: tasksRouter,
  settings: settingsRouter,
  webhooks: webhooksRouter,
  tags: tagsRouter,
  pins: pinsRouter,
  templates: templatesRouter,
  me: authedProcedure.query(({ ctx }) => toUserView(ctx.user)),
})

export type AppRouter = typeof appRouter
