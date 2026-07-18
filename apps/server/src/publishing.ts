import { blocknoteToHtml, plainText, slugify } from '@bn/renderer'
import type { NavNode } from '@bn/renderer'
import { nanoid } from 'nanoid'
import { PagesError } from './pages'
import type { PageRow, PageVersionRow, Repo, SpaceRow, UserRow } from './repo'

/**
 * The publish pipeline. Two-track rule made physical: the working copy is
 * never public, the published snapshot is never edited. Public output is
 * computed from live versions only; a page is publicly reachable only if all
 * of its ancestors are live too.
 */
export function createPublishingService(repo: Repo, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  async function requirePage(
    pageId: string,
    user: UserRow,
  ): Promise<{ page: PageRow; space: SpaceRow }> {
    const page = await repo.getPage(pageId)
    if (!page) throw new PagesError('NOT_FOUND', 'Page not found.')
    const space = await repo.getSpace(page.spaceId)
    if (!space || (space.ownerId !== null && space.ownerId !== user.id)) {
      throw new PagesError('NOT_FOUND', 'Page not found.')
    }
    return { page, space }
  }

  async function ensureSlug(page: PageRow): Promise<string> {
    if (page.slug) return page.slug
    const base = slugify(page.title)
    const siblings = await repo.listPagesInSpace(page.spaceId)
    const taken = new Set(siblings.filter((p) => p.id !== page.id).map((p) => p.slug))
    let slug = base
    let n = 2
    while (taken.has(slug)) {
      slug = `${base}-${n}`
      n++
    }
    await repo.setPageSlug(page.id, slug)
    return slug
  }

  return {
    /** Freeze the working copy into an immutable, pre-rendered version and go live. */
    async publish(user: UserRow, pageId: string): Promise<PageVersionRow> {
      const { page, space } = await requirePage(pageId, user)
      if (space.kind !== 'tree') {
        throw new PagesError('BAD_MOVE', 'Journal pages cannot be published.')
      }
      const doc = await repo.getDocument(pageId)
      if (!doc) throw new PagesError('NOT_FOUND', 'Document missing for page.')

      const slug = await ensureSlug(page)
      const existing = await repo.listVersionsForPage(pageId)
      const versionNumber = existing.reduce((max, v) => Math.max(max, v.version), 0) + 1

      const version: PageVersionRow = {
        id: nanoid(),
        pageId,
        version: versionNumber,
        title: page.title,
        slug,
        content: doc.content,
        html: blocknoteToHtml(doc.content),
        textPlain: plainText(doc.content),
        createdBy: user.id,
        createdAt: now(),
      }
      await repo.insertPageVersion(version)
      await repo.setLivePointer(pageId, version.id)
      return version
    },

    /** Take the page off the site; history is kept, nothing is deleted. */
    async retire(user: UserRow, pageId: string): Promise<void> {
      await requirePage(pageId, user)
      await repo.setLivePointer(pageId, null)
    },

    /** Rollback = move the live pointer to an older version. */
    async republish(user: UserRow, pageId: string, versionId: string): Promise<void> {
      await requirePage(pageId, user)
      const version = await repo.getVersion(versionId)
      if (!version || version.pageId !== pageId) {
        throw new PagesError('NOT_FOUND', 'Version not found.')
      }
      await repo.setLivePointer(pageId, versionId)
    },

    async versions(user: UserRow, pageId: string) {
      const { page } = await requirePage(pageId, user)
      const list = await repo.listVersionsForPage(pageId)
      return { page, versions: list.sort((a, b) => b.version - a.version) }
    },

    async updateSpacePublishing(
      user: UserRow,
      input: {
        spaceId: string
        enabled: boolean
        host: string | null
        title: string | null
        footer: string | null
        theme: 'paper' | 'ink' | 'mist' | 'sand'
      },
    ): Promise<void> {
      const space = await repo.getSpace(input.spaceId)
      if (!space || (space.ownerId !== null && space.ownerId !== user.id)) {
        throw new PagesError('NOT_FOUND', 'Space not found.')
      }
      if (input.enabled && !input.host) {
        throw new PagesError('BAD_CONTENT', 'A host name is required to enable publishing.')
      }
      if (input.host) {
        const holder = await repo.getSpaceByPublicHost(input.host)
        if (holder && holder.id !== input.spaceId) {
          throw new PagesError('BAD_CONTENT', 'That host is already used by another space.')
        }
      }
      await repo.updateSpacePublishing(input.spaceId, {
        publicEnabled: input.enabled,
        publicHost: input.host,
        publicTitle: input.title,
        publicFooter: input.footer,
        publicTheme: input.theme,
      })
    },

    /** First-publish dates for a set of pages (post dates, RSS pubDates). */
    async firstPublishedAt(pageIds: string[]): Promise<Map<string, Date>> {
      const result = new Map<string, Date>()
      for (const pageId of pageIds) {
        const versions = await repo.listVersionsForPage(pageId)
        const first = versions.reduce<Date | null>(
          (min, v) => (min === null || v.createdAt < min ? v.createdAt : min),
          null,
        )
        if (first) result.set(pageId, first)
      }
      return result
    },

    /** Editor rail data: live status, pending edits, public path. */
    async status(page: PageRow, space: SpaceRow) {
      const live = page.liveVersionId ? await repo.getVersion(page.liveVersionId) : null
      const doc = await repo.getDocument(page.id)
      const pending =
        live !== null && doc !== null && doc.updatedAt.getTime() > live.createdAt.getTime()
      const slugPath = live ? await this.livePathForPage(page.id) : null
      return {
        spaceEnabled: space.publicEnabled,
        host: space.publicHost,
        live: live
          ? { versionId: live.id, version: live.version, publishedAt: live.createdAt.toISOString() }
          : null,
        pending,
        slugPath,
      }
    },

    // ---- the public read model ----

    /**
     * The set of publicly reachable pages of a space: live, with every
     * ancestor live. THE visibility rule — everything public derives from
     * this list and from stored version snapshots, never from working copies.
     */
    async liveTree(spaceId: string): Promise<Array<{ page: PageRow; version: PageVersionRow }>> {
      const pages = await repo.listPagesInSpace(spaceId)
      const byId = new Map(pages.map((p) => [p.id, p]))
      const lineageLive = (p: PageRow): boolean => {
        let cursor: PageRow | undefined = p
        while (cursor) {
          if (!cursor.liveVersionId) return false
          cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
        }
        return true
      }
      const result: Array<{ page: PageRow; version: PageVersionRow }> = []
      for (const page of pages.filter(lineageLive).sort((a, b) => a.position - b.position)) {
        const version = page.liveVersionId ? await repo.getVersion(page.liveVersionId) : null
        if (version) result.push({ page, version })
      }
      return result
    },

    async livePathForPage(pageId: string): Promise<string | null> {
      const page = await repo.getPage(pageId)
      if (!page) return null
      const entries = await this.liveTree(page.spaceId)
      const byId = new Map(entries.map((e) => [e.page.id, e]))
      if (!byId.has(pageId)) return null
      const segments: string[] = []
      let cursor: PageRow | undefined = page
      while (cursor) {
        const entry = byId.get(cursor.id)
        if (!entry) return null
        segments.unshift(entry.version.slug)
        cursor = cursor.parentId ? byId.get(cursor.parentId)?.page : undefined
      }
      return `/${segments.join('/')}`
    },

    /** Nav tree + flat reading order for prev/next, from live lineage only. */
    async publicSite(space: SpaceRow, activePath: string | null) {
      const entries = await this.liveTree(space.id)
      const byId = new Map(entries.map((e) => [e.page.id, e]))

      const pathOf = (pageId: string): string => {
        const segments: string[] = []
        let cursor = byId.get(pageId)
        while (cursor) {
          segments.unshift(cursor.version.slug)
          cursor = cursor.page.parentId ? byId.get(cursor.page.parentId) : undefined
        }
        return `/${segments.join('/')}`
      }

      // lineage-live guarantees every entry's ancestors are also entries,
      // so children group cleanly by parentId
      const buildNav = (parentId: string | null): NavNode[] =>
        entries
          .filter((e) => e.page.parentId === parentId)
          .map((e) => {
            const path = pathOf(e.page.id)
            return {
              title: e.version.title,
              path,
              active: path === activePath,
              children: buildNav(e.page.id),
            }
          })

      const flat: Array<{ title: string; path: string; entry: (typeof entries)[number] }> = []
      const walk = (parentId: string | null) => {
        for (const e of entries.filter((x) => x.page.parentId === parentId)) {
          flat.push({ title: e.version.title, path: pathOf(e.page.id), entry: e })
          walk(e.page.id)
        }
      }
      walk(null)

      return {
        nav: buildNav(null),
        flat,
        byPath: new Map(flat.map((f) => [f.path, f])),
        siteTitle: space.publicTitle || space.name,
        footer: space.publicFooter || '',
      }
    },
  }
}

export type PublishingService = ReturnType<typeof createPublishingService>
