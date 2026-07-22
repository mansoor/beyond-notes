import { pageTypesByCategory } from '@bn/schema'
import { nanoid } from 'nanoid'
import { reconcileLinks } from './links'
import type { PageRow, Repo, SpaceRow, UserRow } from './repo'
import { reconcileTags } from './tags'
import { reconcileTasks } from './tasks'

const EMPTY_DOC = '[]'
const DOC_SCHEMA_VERSION = 1

export class PagesError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_MOVE' | 'CONFLICT' | 'BAD_CONTENT',
    message: string,
  ) {
    super(message)
  }
}

/** A page id plus every descendant's, walked over one space's page list. */
function subtreeIds(all: PageRow[], rootId: string): string[] {
  const ids = [rootId]
  const queue = [rootId]
  while (queue.length > 0) {
    const parentId = queue.shift()
    for (const child of all.filter((p) => p.parentId === parentId)) {
      ids.push(child.id)
      queue.push(child.id)
    }
  }
  return ids
}

function assertSpaceAccess(space: SpaceRow | null, user: UserRow): asserts space is SpaceRow {
  if (!space) throw new PagesError('NOT_FOUND', 'Space not found.')
  if (space.ownerId !== null && space.ownerId !== user.id) {
    // personal spaces are invisible to everyone but their owner
    throw new PagesError('NOT_FOUND', 'Space not found.')
  }
}

export function createPagesService(repo: Repo, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  async function requirePage(
    pageId: string,
    user: UserRow,
  ): Promise<{ page: PageRow; space: SpaceRow }> {
    const page = await repo.getPage(pageId)
    if (!page) throw new PagesError('NOT_FOUND', 'Page not found.')
    const space = await repo.getSpace(page.spaceId)
    assertSpaceAccess(space, user)
    return { page, space }
  }

  return {
    // ---- spaces ----

    async listSpaces(user: UserRow): Promise<SpaceRow[]> {
      const all = await repo.listSpaces()
      // system spaces (journal) have their own surfaces; the sidebar lists trees only
      return all.filter((s) => s.kind === 'tree' && (s.ownerId === null || s.ownerId === user.id))
    },

    async createSpace(
      user: UserRow,
      input: { name: string; category: 'notebook' | 'wiki' | 'site'; personal: boolean },
    ): Promise<SpaceRow> {
      const space: SpaceRow = {
        id: nanoid(),
        name: input.name,
        category: input.category,
        kind: 'tree',
        ownerId: input.personal ? user.id : null,
        publicEnabled: false,
        publicHost: null,
        publicTitle: null,
        publicFooter: null,
        publicTheme: 'paper',
        publicAppearance: 'auto',
        publicSocial: '[]',
        publicLogoAttachmentId: null,
        publicTagline: null,
        publicHeaderLayout: 'classic',
        lockPolicy: null,
        lockIdleMinutes: null,
        createdAt: now(),
      }
      await repo.insertSpace(space)
      return space
    },

    async renameSpace(user: UserRow, spaceId: string, name: string): Promise<void> {
      assertSpaceAccess(await repo.getSpace(spaceId), user)
      await repo.renameSpace(spaceId, name)
    },

    async deleteSpace(user: UserRow, spaceId: string): Promise<void> {
      assertSpaceAccess(await repo.getSpace(spaceId), user)
      await repo.deleteSpace(spaceId)
    },

    // ---- pages ----

    async tree(user: UserRow, spaceId: string): Promise<PageRow[]> {
      assertSpaceAccess(await repo.getSpace(spaceId), user)
      const pages = await repo.listPagesInSpace(spaceId)
      return pages
        .filter((p) => p.archivedAt === null && p.trashedAt === null)
        .sort((a, b) => a.position - b.position)
    },

    // ---- archive ----

    /** Archive a page and its whole subtree. Publish state is untouched. */
    async archivePage(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user)
      const all = await repo.listPagesInSpace(page.spaceId)
      const ids = subtreeIds(all, pageId)
      await repo.setPagesArchived(ids, now(), user.id)
    },

    /**
     * Restore a page and its subtree to where they were. If the original
     * parent is itself still archived (or gone), the page surfaces at the
     * space root rather than staying invisible under an archived ancestor.
     */
    async restorePage(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user)
      if (!page.archivedAt) return
      const all = await repo.listPagesInSpace(page.spaceId)
      const ids = subtreeIds(all, pageId)
      await repo.setPagesArchived(ids, null, null)
      const parent = page.parentId ? all.find((p) => p.id === page.parentId) : null
      if (page.parentId && (!parent || (parent.archivedAt && !ids.includes(parent.id)))) {
        const rootCount = all.filter((p) => p.parentId === null && !p.archivedAt).length
        await repo.updatePage(pageId, { parentId: null, position: rootCount, updatedAt: now() })
      }
    },

    /**
     * Archive roots visible to this user: archived pages whose parent is not
     * itself archived — the units that were archived, not every descendant.
     */
    async listArchived(user: UserRow): Promise<Array<{ page: PageRow; space: SpaceRow }>> {
      const [archived, spaces] = await Promise.all([repo.listArchivedPages(), repo.listSpaces()])
      const accessible = new Map(
        spaces.filter((s) => s.ownerId === null || s.ownerId === user.id).map((s) => [s.id, s]),
      )
      const archivedIds = new Set(archived.map((p) => p.id))
      return archived
        .filter((p) => accessible.has(p.spaceId) && p.trashedAt === null)
        .filter((p) => p.parentId === null || !archivedIds.has(p.parentId))
        .sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0))
        .map((p) => ({ page: p, space: accessible.get(p.spaceId) as SpaceRow }))
    },

    // ---- trash ----

    /**
     * Deletion is soft: the subtree moves to the trash, disappearing from the
     * tree, search, tags, and the public site. The purge job hard-deletes
     * after TRASH_RETENTION_DAYS; until then it can be restored.
     */
    async trashPage(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user)
      const all = await repo.listPagesInSpace(page.spaceId)
      await repo.setPagesTrashed(subtreeIds(all, pageId), now(), user.id)
    },

    async restoreTrashedPage(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user)
      if (!page.trashedAt) return
      const all = await repo.listPagesInSpace(page.spaceId)
      const ids = subtreeIds(all, pageId)
      await repo.setPagesTrashed(ids, null, null)
      // same rule as archive restore: never resurface under a still-hidden parent
      const parent = page.parentId ? all.find((p) => p.id === page.parentId) : null
      if (
        page.parentId &&
        (!parent || ((parent.trashedAt || parent.archivedAt) && !ids.includes(parent.id)))
      ) {
        const rootCount = all.filter(
          (p) => p.parentId === null && !p.archivedAt && !p.trashedAt,
        ).length
        await repo.updatePage(pageId, { parentId: null, position: rootCount, updatedAt: now() })
      }
    },

    /** Trash roots visible to this user — the units that were trashed. */
    async listTrashed(user: UserRow): Promise<Array<{ page: PageRow; space: SpaceRow }>> {
      const [trashed, spaces] = await Promise.all([repo.listTrashedPages(), repo.listSpaces()])
      const accessible = new Map(
        spaces.filter((s) => s.ownerId === null || s.ownerId === user.id).map((s) => [s.id, s]),
      )
      const trashedIds = new Set(trashed.map((p) => p.id))
      return trashed
        .filter((p) => accessible.has(p.spaceId))
        .filter((p) => p.parentId === null || !trashedIds.has(p.parentId))
        .sort((a, b) => (b.trashedAt?.getTime() ?? 0) - (a.trashedAt?.getTime() ?? 0))
        .map((p) => ({ page: p, space: accessible.get(p.spaceId) as SpaceRow }))
    },

    /** "Delete forever" — only reachable for pages already in the trash. */
    async deleteForever(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user)
      if (!page.trashedAt)
        throw new PagesError('BAD_MOVE', 'Only trashed pages can be deleted forever.')
      await repo.deletePage(pageId)
    },

    /** Hard-delete everything trashed before the cutoff. Called by the scheduler. */
    async purgeExpiredTrash(cutoff: Date): Promise<number> {
      const trashed = await repo.listTrashedPages()
      const trashedIds = new Set(trashed.map((p) => p.id))
      const roots = trashed.filter(
        (p) =>
          (p.trashedAt as Date) < cutoff && (p.parentId === null || !trashedIds.has(p.parentId)),
      )
      for (const p of roots) await repo.deletePage(p.id) // FK cascade takes the subtree
      return roots.length
    },

    /** Copy one page (content, type, gallery settings) as its next sibling. */
    async duplicatePage(user: UserRow, pageId: string): Promise<PageRow> {
      const { page } = await requirePage(pageId, user)
      const doc = await repo.getDocument(pageId)
      if (!doc) throw new PagesError('NOT_FOUND', 'Document missing for page.')
      const siblings = (await repo.listPagesInSpace(page.spaceId)).filter(
        (p) => p.parentId === page.parentId,
      )
      const copy: PageRow = {
        ...page,
        id: nanoid(),
        title: `${page.title} (copy)`,
        position: siblings.length,
        slug: null,
        liveVersionId: null, // the copy starts unpublished
        archivedAt: null,
        archivedBy: null,
        trashedAt: null,
        trashedBy: null,
        lockPolicy: null,
        lockIdleMinutes: null,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertPage(copy)
      await repo.insertDocument({
        pageId: copy.id,
        content: doc.content,
        schemaVersion: doc.schemaVersion,
        updatedAt: now(),
      })
      for (const item of await repo.listGalleryItems(pageId)) {
        await repo.insertGalleryItem({ ...item, id: nanoid(), pageId: copy.id })
      }
      await reconcileTags(repo, copy.id, doc.content)
      await reconcileLinks(repo, copy.id, doc.content)
      await reconcileTasks(repo, copy.id, doc.content, now())
      return copy
    },

    async createPage(
      user: UserRow,
      input: { spaceId: string; parentId: string | null; title: string },
    ): Promise<PageRow> {
      assertSpaceAccess(await repo.getSpace(input.spaceId), user)
      if (input.parentId) {
        const parent = await repo.getPage(input.parentId)
        if (!parent || parent.spaceId !== input.spaceId) {
          throw new PagesError('BAD_MOVE', 'Parent page is not in this space.')
        }
      }
      const siblings = (await repo.listPagesInSpace(input.spaceId)).filter(
        (p) => p.parentId === input.parentId,
      )
      const page: PageRow = {
        id: nanoid(),
        spaceId: input.spaceId,
        parentId: input.parentId,
        title: input.title || 'Untitled',
        position: siblings.length,
        dateKey: null,
        pageType: 'doc',
        slug: null,
        liveVersionId: null,
        galleryLayout: 'grid',
        galleryAutoplaySecs: null,
        shareEnabled: false,
        coverAttachmentId: null,
        metaDescription: null,
        icon: null,
        archivedAt: null,
        archivedBy: null,
        trashedAt: null,
        trashedBy: null,
        lockPolicy: null,
        lockIdleMinutes: null,
        createdAt: now(),
        updatedAt: now(),
      }
      await repo.insertPage(page)
      await repo.insertDocument({
        pageId: page.id,
        content: EMPTY_DOC,
        schemaVersion: DOC_SCHEMA_VERSION,
        updatedAt: now(),
      })
      return page
    },

    async getPage(user: UserRow, pageId: string) {
      const { page } = await requirePage(pageId, user)
      const doc = await repo.getDocument(pageId)
      if (!doc) throw new PagesError('NOT_FOUND', 'Document missing for page.')
      return { page, doc }
    },

    async updatePageOptions(
      user: UserRow,
      input: {
        pageId: string
        galleryLayout?: 'grid' | 'carousel' | 'filmstrip' | 'mosaic'
        galleryAutoplaySecs?: number | null
        shareEnabled?: boolean
        coverAttachmentId?: string | null
        metaDescription?: string | null
        icon?: string | null
      },
    ): Promise<void> {
      await requirePage(input.pageId, user)
      const patch: Parameters<Repo['updatePage']>[1] = { updatedAt: now() }
      if (input.galleryLayout !== undefined) patch.galleryLayout = input.galleryLayout
      if (input.galleryAutoplaySecs !== undefined) {
        patch.galleryAutoplaySecs = input.galleryAutoplaySecs
      }
      if (input.shareEnabled !== undefined) patch.shareEnabled = input.shareEnabled
      if (input.coverAttachmentId !== undefined) patch.coverAttachmentId = input.coverAttachmentId
      if (input.metaDescription !== undefined) {
        patch.metaDescription = input.metaDescription?.trim() || null
      }
      if (input.icon !== undefined) patch.icon = input.icon?.trim() || null
      await repo.updatePage(input.pageId, patch)
    },

    async renamePage(user: UserRow, pageId: string, title: string): Promise<void> {
      await requirePage(pageId, user)
      await repo.updatePage(pageId, { title, updatedAt: now() })
    },

    /**
     * Reparent/reorder within one space. Rejects moves that would create a
     * cycle (a page under its own descendant) — the classic tree corruption.
     */
    async setPageType(
      user: UserRow,
      pageId: string,
      pageType: 'doc' | 'blog' | 'gallery',
    ): Promise<void> {
      const { space } = await requirePage(pageId, user)
      if (space.kind !== 'tree')
        throw new PagesError('BAD_MOVE', 'Journal pages have no page type.')
      if (!pageTypesByCategory[space.category].includes(pageType))
        throw new PagesError(
          'BAD_MOVE',
          `A ${space.category} cannot contain ${pageType} pages — ${
            pageType === 'blog' ? 'blogs live in Sites' : 'galleries live in Notebooks and Sites'
          }.`,
        )
      await repo.updatePage(pageId, { pageType, updatedAt: now() })
    },

    async movePage(
      user: UserRow,
      input: { pageId: string; parentId: string | null; index: number; spaceId?: string },
    ): Promise<void> {
      const { page } = await requirePage(input.pageId, user)

      // cross-space subtree move (how a note becomes a blog post)
      if (input.spaceId && input.spaceId !== page.spaceId) {
        const target = await repo.getSpace(input.spaceId)
        if (
          !target ||
          target.kind !== 'tree' ||
          (target.ownerId !== null && target.ownerId !== user.id)
        ) {
          throw new PagesError('NOT_FOUND', 'Target space not found.')
        }
        const targetPages = await repo.listPagesInSpace(target.id)
        if (input.parentId) {
          const parent = targetPages.find((p) => p.id === input.parentId)
          if (!parent) throw new PagesError('BAD_MOVE', 'Target parent is not in that space.')
        }

        // collect the whole subtree in the source space
        const sourcePages = await repo.listPagesInSpace(page.spaceId)
        const subtree = [page]
        let frontier = [page.id]
        while (frontier.length > 0) {
          const next = sourcePages.filter((p) => p.parentId && frontier.includes(p.parentId))
          subtree.push(...next)
          frontier = next.map((p) => p.id)
        }

        const takenSlugs = new Set(targetPages.map((p) => p.slug).filter(Boolean))
        for (const p of subtree) {
          const patch: Parameters<Repo['updatePage']>[1] = { spaceId: target.id }
          // colliding slugs reset and regenerate at the next publish
          if (p.slug && takenSlugs.has(p.slug)) patch.slug = null
          await repo.updatePage(p.id, patch)
        }
        const siblings = targetPages.filter((p) => p.parentId === input.parentId)
        await repo.updatePage(page.id, {
          parentId: input.parentId,
          position: siblings.length,
          updatedAt: now(),
        })
        // compact the source sibling group left behind
        const oldSiblings = sourcePages
          .filter((p) => p.parentId === page.parentId && p.id !== page.id)
          .sort((a, b) => a.position - b.position)
        for (let i = 0; i < oldSiblings.length; i++) {
          const sibling = oldSiblings[i]
          if (sibling && sibling.position !== i) await repo.updatePage(sibling.id, { position: i })
        }
        return
      }

      if (input.parentId) {
        const newParent = await repo.getPage(input.parentId)
        if (!newParent || newParent.spaceId !== page.spaceId) {
          throw new PagesError('BAD_MOVE', 'Target parent is not in the same space.')
        }
        if (input.parentId === page.id)
          throw new PagesError('BAD_MOVE', 'Cannot move a page into itself.')
        // walk up from the target parent; if we meet the moved page, it's a cycle
        let cursor: PageRow | null = newParent
        while (cursor?.parentId) {
          if (cursor.parentId === page.id) {
            throw new PagesError('BAD_MOVE', 'Cannot move a page under its own subpage.')
          }
          cursor = await repo.getPage(cursor.parentId)
        }
      }

      const all = await repo.listPagesInSpace(page.spaceId)
      const newSiblings = all
        .filter((p) => p.parentId === input.parentId && p.id !== page.id)
        .sort((a, b) => a.position - b.position)
      const index = Math.min(input.index, newSiblings.length)
      newSiblings.splice(index, 0, page)

      for (let i = 0; i < newSiblings.length; i++) {
        const sibling = newSiblings[i]
        if (!sibling) continue
        const patch: Parameters<Repo['updatePage']>[1] = { position: i }
        if (sibling.id === page.id) {
          patch.parentId = input.parentId
          patch.updatedAt = now()
        }
        if (sibling.position !== i || sibling.id === page.id) {
          await repo.updatePage(sibling.id, patch)
        }
      }

      // compact the old sibling group the page left behind
      if (page.parentId !== input.parentId) {
        const oldSiblings = all
          .filter((p) => p.parentId === page.parentId && p.id !== page.id)
          .sort((a, b) => a.position - b.position)
        for (let i = 0; i < oldSiblings.length; i++) {
          const sibling = oldSiblings[i]
          if (sibling && sibling.position !== i) await repo.updatePage(sibling.id, { position: i })
        }
      }
    },

    async deletePage(user: UserRow, pageId: string): Promise<void> {
      await requirePage(pageId, user)
      await repo.deletePage(pageId)
    },

    /** Autosave with optimistic locking: the client proves it saw the latest version. */
    async saveDocument(
      user: UserRow,
      input: { pageId: string; content: string; baseUpdatedAt: string },
    ): Promise<{ updatedAt: string }> {
      await requirePage(input.pageId, user)
      const doc = await repo.getDocument(input.pageId)
      if (!doc) throw new PagesError('NOT_FOUND', 'Document missing for page.')
      if (doc.updatedAt.getTime() !== new Date(input.baseUpdatedAt).getTime()) {
        throw new PagesError(
          'CONFLICT',
          'This page changed in another window. Reload to pick up the latest version.',
        )
      }
      try {
        JSON.parse(input.content)
      } catch {
        throw new PagesError('BAD_CONTENT', 'Document content is not valid JSON.')
      }
      const when = now()
      await repo.updateDocument(input.pageId, input.content, when)
      await repo.updatePage(input.pageId, { updatedAt: when })
      // keep the tasks, tags, and link indexes true to the blocks on every save
      await reconcileTasks(repo, input.pageId, input.content, when)
      await reconcileTags(repo, input.pageId, input.content)
      await reconcileLinks(repo, input.pageId, input.content)
      return { updatedAt: when.toISOString() }
    },
  }
}

export type PagesService = ReturnType<typeof createPagesService>
