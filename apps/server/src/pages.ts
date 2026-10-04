import { mergeDocuments, plainText } from '@bn/renderer'
import { pageSubtreeIds, pageTypesByCategory } from '@bn/schema'
import { nanoid } from 'nanoid'
import { AccessError, type AccessService, type Need, createAccess } from './access'
import { extractTriples } from './concepts'
import { type Embedder, topSimilarPairs } from './embeddings'
import { type GraphEdgeType, type GraphSimilar, type SpaceGraph, buildSpaceGraph } from './graph'
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
const subtreeIds = (all: PageRow[], rootId: string): string[] => pageSubtreeIds(all, rootId)

export function createPagesService(
  repo: Repo,
  opts: {
    now?: () => Date
    embedder?: Embedder
    embedThreshold?: number
    embedNeighbors?: number
    /** the app's one access service; a standalone service makes its own */
    access?: AccessService
  } = {},
) {
  const now = opts.now ?? (() => new Date())
  const access = opts.access ?? createAccess(repo)

  /** The space, if this user has `need` in it (access.ts); PagesError otherwise. */
  async function assertSpaceAccess(
    space: SpaceRow | null,
    user: UserRow,
    need: Need,
  ): Promise<SpaceRow> {
    try {
      return await access.assert(space, user, need)
    } catch (err) {
      if (err instanceof AccessError) throw new PagesError(err.code, err.message)
      throw err
    }
  }
  const embedder = opts.embedder
  const embedThreshold = opts.embedThreshold ?? 0.55
  const embedNeighbors = opts.embedNeighbors ?? 4
  // above this many pages the O(n²) similarity sweep isn't worth it for a live
  // request; the graph just skips the semantic layer for that space
  const EMBED_PAGE_CAP = 400

  /**
   * The semantic edges for a set of pages, or [] when the layer is off, the
   * space is too big/small, or the model fails to load. Never throws — the graph
   * degrades to its classical edges rather than erroring.
   */
  async function semanticPairs(docs: Array<{ id: string; text: string }>): Promise<GraphSimilar[]> {
    if (!embedder?.enabled || docs.length < 2 || docs.length > EMBED_PAGE_CAP) return []
    try {
      const vectors = new Map<string, number[]>()
      const embedded = await embedder.embed(docs.map((d) => d.text))
      docs.forEach((d, i) => {
        const v = embedded[i]
        if (v) vectors.set(d.id, v)
      })
      return topSimilarPairs(vectors, { threshold: embedThreshold, perNode: embedNeighbors })
    } catch (err) {
      console.warn('[graph] semantic layer unavailable, falling back:', (err as Error).message)
      return []
    }
  }

  async function requirePage(
    pageId: string,
    user: UserRow,
    need: Need,
  ): Promise<{ page: PageRow; space: SpaceRow }> {
    const page = await repo.getPage(pageId)
    if (!page) throw new PagesError('NOT_FOUND', 'Page not found.')
    const space = await assertSpaceAccess(await repo.getSpace(page.spaceId), user, need)
    return { page, space }
  }

  return {
    // ---- spaces ----

    async listSpaces(user: UserRow): Promise<SpaceRow[]> {
      const all = await repo.listSpaces()
      // system spaces (journal) have their own surfaces; the sidebar lists trees only
      const visible = await access.filter(user)
      return all.filter((s) => s.kind === 'tree' && visible(s))
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
        publicMaintenance: false,
        publicHost: null,
        publicTitle: null,
        publicFooter: null,
        publicTheme: 'paper',
        publicAppearance: 'auto',
        publicSocial: '[]',
        publicLogoAttachmentId: null,
        publicTagline: null,
        publicHeaderLayout: 'classic',
        publicTitleSize: 'md',
        publicLogoSize: 'md',
        publicFaviconAttachmentId: null,
        analyticsProvider: 'none',
        analyticsSiteId: null,
        analyticsHost: null,
        lockPolicy: null,
        lockIdleMinutes: null,
        createdAt: now(),
      }
      await repo.insertSpace(space)
      return space
    },

    async renameSpace(user: UserRow, spaceId: string, name: string): Promise<void> {
      await assertSpaceAccess(await repo.getSpace(spaceId), user, 'owner')
      await repo.renameSpace(spaceId, name)
    },

    async deleteSpace(user: UserRow, spaceId: string): Promise<void> {
      await assertSpaceAccess(await repo.getSpace(spaceId), user, 'owner')
      await repo.deleteSpace(spaceId)
    },

    // ---- pages ----

    async tree(user: UserRow, spaceId: string): Promise<PageRow[]> {
      await assertSpaceAccess(await repo.getSpace(spaceId), user, 'read')
      const pages = await repo.listPagesInSpace(spaceId)
      return pages
        .filter((p) => p.archivedAt === null && p.trashedAt === null)
        .sort((a, b) => a.position - b.position)
    },

    /**
     * The categories already in use in a space — the picker's "choose an
     * existing one" list. There is no category table: this IS the set, derived
     * from the pages, so a category disappears when its last page lets it go.
     */
    async categories(user: UserRow, spaceId: string): Promise<string[]> {
      await assertSpaceAccess(await repo.getSpace(spaceId), user, 'read')
      const seen = new Map<string, string>()
      for (const page of await repo.listPagesInSpace(spaceId)) {
        const name = page.category?.trim()
        // case-insensitive dedupe, first spelling wins — so "Travel" and
        // "travel" do not both sit in the list
        if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
      }
      return [...seen.values()].sort((a, b) => a.localeCompare(b))
    },

    /**
     * The space's concept graph — pages tied together by the salient nouns they
     * share. Access is gated exactly like `tree`: a space you cannot see never
     * yields a graph. Trashed and archived pages are excluded, as is anything
     * with no readable text.
     *
     * `excludePageIds` is the lock boundary: the graph distills page *content*,
     * so a locked page's words must not surface here. The router passes the
     * session's hidden-page set — a fully locked space therefore contributes
     * nothing, exactly as its editor would show nothing.
     */
    async spaceGraph(
      user: UserRow,
      spaceId: string,
      opts: { excludePageIds?: Set<string>; edges?: Set<GraphEdgeType> } = {},
    ): Promise<SpaceGraph> {
      await assertSpaceAccess(await repo.getSpace(spaceId), user, 'read')
      const on = (type: GraphEdgeType) => !opts.edges || opts.edges.has(type)
      const hidden = opts.excludePageIds ?? new Set<string>()
      const pages = (await repo.listPagesInSpace(spaceId))
        .filter((p) => p.archivedAt === null && p.trashedAt === null && !hidden.has(p.id))
        .sort((a, b) => a.position - b.position)

      const loaded = await Promise.all(
        pages.map(async (p) => {
          const doc = await repo.getDocument(p.id)
          const body = doc ? plainText(doc.content) : ''
          // the title carries real signal too — a page called "Docker backups"
          // should surface those concepts even if its body is thin
          return { id: p.id, title: p.title, icon: p.icon, text: `${p.title}. ${body}` }
        }),
      )

      // explicit relationships, scoped to this space's visible pages. Links or
      // tags that touch an excluded/other-space page are simply dropped, since
      // that page is not a node here.
      // gather only what the enabled edge set needs — the semantic sweep and
      // triple extraction are the costly parts, so a graph without them skips
      // the work entirely rather than computing edges to be filtered away.
      const visible = new Set(pages.map((p) => p.id))
      const links = on('link')
        ? (await repo.listAllPageLinks())
            .filter((l) => visible.has(l.fromPageId) && visible.has(l.toPageId))
            .map((l) => ({ from: l.fromPageId, to: l.toPageId }))
        : []
      const tags = on('tag')
        ? (await repo.listAllPageTags()).filter((t) => visible.has(t.pageId))
        : []

      // the optional semantic layer: embed each page and connect the pairs that
      // point the same way. Best-effort — if the model can't load (offline box,
      // first-run download blocked), the graph is still links + tags + concepts.
      const similar = on('semantic') ? await semanticPairs(loaded) : []

      // typed edges: subject–verb–object triples across every page's text
      const triples = on('relation') ? loaded.flatMap((d) => extractTriples(d.text)) : []

      return buildSpaceGraph(loaded, { include: opts.edges }, { links, tags, similar, triples })
    },

    // ---- archive ----

    /** Archive a page and its whole subtree. Publish state is untouched. */
    async archivePage(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user, 'write')
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
      const { page } = await requirePage(pageId, user, 'write')
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
      const writable = await access.filter(user, 'write')
      const accessible = new Map(spaces.filter(writable).map((s) => [s.id, s]))
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
      const { page } = await requirePage(pageId, user, 'write')
      const all = await repo.listPagesInSpace(page.spaceId)
      await repo.setPagesTrashed(subtreeIds(all, pageId), now(), user.id)
    },

    async restoreTrashedPage(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user, 'write')
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
      const writable = await access.filter(user, 'write')
      const accessible = new Map(spaces.filter(writable).map((s) => [s.id, s]))
      const trashedIds = new Set(trashed.map((p) => p.id))
      return trashed
        .filter((p) => accessible.has(p.spaceId))
        .filter((p) => p.parentId === null || !trashedIds.has(p.parentId))
        .sort((a, b) => (b.trashedAt?.getTime() ?? 0) - (a.trashedAt?.getTime() ?? 0))
        .map((p) => ({ page: p, space: accessible.get(p.spaceId) as SpaceRow }))
    },

    /** "Delete forever" — only reachable for pages already in the trash. */
    async deleteForever(user: UserRow, pageId: string): Promise<void> {
      const { page } = await requirePage(pageId, user, 'write')
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
      const { page } = await requirePage(pageId, user, 'write')
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
      input: {
        spaceId: string
        parentId: string | null
        title: string
        afterPageId?: string | null
      },
    ): Promise<PageRow> {
      await assertSpaceAccess(await repo.getSpace(input.spaceId), user, 'write')
      if (input.parentId) {
        const parent = await repo.getPage(input.parentId)
        if (!parent || parent.spaceId !== input.spaceId) {
          throw new PagesError('BAD_MOVE', 'Parent page is not in this space.')
        }
      }
      // Sorted over every sibling, archived and trashed included: their
      // positions are real and renumbering around them would shuffle the group
      // when they come back.
      const siblings = (await repo.listPagesInSpace(input.spaceId))
        .filter((p) => p.parentId === input.parentId)
        .sort((a, b) => a.position - b.position)
      // "Add sibling" wants the new page next to the one you clicked, not at
      // the bottom of the group. An afterPageId that is not in this group (a
      // stale sidebar, say) falls back to appending rather than failing —
      // landing in the wrong place beats refusing to create the page.
      const after = input.afterPageId ? siblings.findIndex((p) => p.id === input.afterPageId) : -1
      const at = after >= 0 ? after + 1 : siblings.length
      const page: PageRow = {
        id: nanoid(),
        spaceId: input.spaceId,
        parentId: input.parentId,
        title: input.title || 'Untitled',
        position: at,
        dateKey: null,
        pageType: 'doc',
        slug: null,
        liveVersionId: null,
        galleryLayout: 'grid',
        galleryAutoplaySecs: null,
        blogLayout: 'list',
        category: null,
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
      // push everything at or below the insertion point down one, so the group
      // stays 0..n with no duplicate positions. Nothing to do when appending.
      for (let i = at; i < siblings.length; i++) {
        const sibling = siblings[i]
        if (sibling) await repo.updatePage(sibling.id, { position: i + 1 })
      }
      await repo.insertDocument({
        pageId: page.id,
        content: EMPTY_DOC,
        schemaVersion: DOC_SCHEMA_VERSION,
        updatedAt: now(),
      })
      return page
    },

    /** Throws unless the user has `need` in the page's space (read, write, owner). */
    async checkPage(user: UserRow, pageId: string, need: Need): Promise<void> {
      await requirePage(pageId, user, need)
    },

    async getPage(user: UserRow, pageId: string) {
      const { page } = await requirePage(pageId, user, 'read')
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
        blogLayout?: 'list' | 'grid'
        category?: string | null
        shareEnabled?: boolean
        coverAttachmentId?: string | null
        metaDescription?: string | null
        icon?: string | null
      },
    ): Promise<void> {
      await requirePage(input.pageId, user, 'write')
      const patch: Parameters<Repo['updatePage']>[1] = { updatedAt: now() }
      if (input.galleryLayout !== undefined) patch.galleryLayout = input.galleryLayout
      if (input.galleryAutoplaySecs !== undefined) {
        patch.galleryAutoplaySecs = input.galleryAutoplaySecs
      }
      if (input.blogLayout !== undefined) patch.blogLayout = input.blogLayout
      if (input.category !== undefined) patch.category = input.category?.trim() || null
      if (input.shareEnabled !== undefined) patch.shareEnabled = input.shareEnabled
      if (input.coverAttachmentId !== undefined) patch.coverAttachmentId = input.coverAttachmentId
      if (input.metaDescription !== undefined) {
        patch.metaDescription = input.metaDescription?.trim() || null
      }
      if (input.icon !== undefined) patch.icon = input.icon?.trim() || null
      await repo.updatePage(input.pageId, patch)
    },

    async renamePage(user: UserRow, pageId: string, title: string): Promise<void> {
      await requirePage(pageId, user, 'write')
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
      const { space } = await requirePage(pageId, user, 'write')
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
      const { page } = await requirePage(input.pageId, user, 'write')

      // cross-space subtree move (how a note becomes a blog post)
      if (input.spaceId && input.spaceId !== page.spaceId) {
        const target = await repo.getSpace(input.spaceId)
        if (!target || target.kind !== 'tree' || !(await access.can(target, user, 'write'))) {
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
      await requirePage(pageId, user, 'write')
      await repo.deletePage(pageId)
    },

    /**
     * Fold `source`'s document into `target`, re-home `source`'s sub-pages under
     * `target`, and send the emptied `source` to the Trash. The block-level twin
     * of the importer's merge: content is appended (source title as an H2), the
     * children outlive the merge, and the source is recoverable for 30 days.
     */
    async mergePages(
      user: UserRow,
      input: { sourceId: string; targetId: string },
    ): Promise<{ targetId: string }> {
      if (input.sourceId === input.targetId) {
        throw new PagesError('BAD_MOVE', 'Cannot merge a page into itself.')
      }
      const { page: source } = await requirePage(input.sourceId, user, 'write')
      const { page: target } = await requirePage(input.targetId, user, 'write')
      if (source.spaceId !== target.spaceId) {
        throw new PagesError('BAD_MOVE', 'Pages are in different spaces.')
      }
      const all = await repo.listPagesInSpace(source.spaceId)
      // the target must not be inside the source, or its content would be folded
      // into a page that is about to be trashed
      if (subtreeIds(all, source.id).includes(target.id)) {
        throw new PagesError('BAD_MOVE', 'Cannot merge a page into its own sub-page.')
      }

      const [tgtDoc, srcDoc] = await Promise.all([
        repo.getDocument(target.id),
        repo.getDocument(source.id),
      ])
      const when = now()
      const merged = mergeDocuments(
        tgtDoc?.content ?? EMPTY_DOC,
        source.title,
        srcDoc?.content ?? EMPTY_DOC,
      )
      await repo.updateDocument(target.id, merged, when)
      await reconcileTasks(repo, target.id, merged, when)
      await reconcileTags(repo, target.id, merged)
      await reconcileLinks(repo, target.id, merged)

      // re-parent the source's direct children onto the end of the target's
      const srcChildren = all
        .filter((p) => p.parentId === source.id)
        .sort((a, b) => a.position - b.position)
      let pos = all.filter((p) => p.parentId === target.id && p.id !== source.id).length
      for (const child of srcChildren) {
        await repo.updatePage(child.id, { parentId: target.id, position: pos++, updatedAt: when })
      }

      // the source is childless now — trash it (recoverable), rather than a hard
      // delete that would drop its pre-merge document
      await repo.setPagesTrashed([source.id], when, user.id)
      return { targetId: target.id }
    },

    /** Autosave with optimistic locking: the client proves it saw the latest version. */
    async saveDocument(
      user: UserRow,
      input: { pageId: string; content: string; baseUpdatedAt: string },
    ): Promise<{ updatedAt: string }> {
      const { page } = await requirePage(input.pageId, user, 'write')
      // A deleted page must stop accepting writes. Without this the editor left
      // open on a page someone trashed keeps autosaving into it, and the edits
      // reappear if the page is ever restored.
      if (page.trashedAt) {
        throw new PagesError('NOT_FOUND', 'This page is in the Trash. Restore it to keep editing.')
      }
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
