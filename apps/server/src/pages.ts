import { nanoid } from 'nanoid'
import type { PageRow, Repo, SpaceRow, UserRow } from './repo'

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
      return all.filter((s) => s.ownerId === null || s.ownerId === user.id)
    },

    async createSpace(
      user: UserRow,
      input: { name: string; category: 'notebook' | 'wiki' | 'site'; personal: boolean },
    ): Promise<SpaceRow> {
      const space: SpaceRow = {
        id: nanoid(),
        name: input.name,
        category: input.category,
        ownerId: input.personal ? user.id : null,
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
      return pages.sort((a, b) => a.position - b.position)
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

    async renamePage(user: UserRow, pageId: string, title: string): Promise<void> {
      await requirePage(pageId, user)
      await repo.updatePage(pageId, { title, updatedAt: now() })
    },

    /**
     * Reparent/reorder within one space. Rejects moves that would create a
     * cycle (a page under its own descendant) — the classic tree corruption.
     */
    async movePage(
      user: UserRow,
      input: { pageId: string; parentId: string | null; index: number },
    ): Promise<void> {
      const { page } = await requirePage(input.pageId, user)

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
      return { updatedAt: when.toISOString() }
    },
  }
}

export type PagesService = ReturnType<typeof createPagesService>
