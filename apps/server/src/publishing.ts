import { randomBytes } from 'node:crypto'
import { blocknoteToHtml, galleryHtml, plainText, slugify } from '@bn/renderer'
import type { NavNode } from '@bn/renderer'
import { nanoid } from 'nanoid'
import { extractAttachmentIds } from './attachments'
import { hashToken } from './auth'
import { PagesError } from './pages'
import type { PageRow, PageVersionRow, PreviewRow, Repo, SpaceRow, UserRow } from './repo'

export const SCHEDULED_PUBLISH = 'scheduled-publish'

/**
 * The publish pipeline. Two-track rule made physical: the working copy is
 * never public, the published snapshot is never edited. Public output is
 * computed from live versions only; a page is publicly reachable only if all
 * of its ancestors are live too.
 */
export function createPublishingService(repo: Repo, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  // public-attachment cache: recomputed after any publish-state mutation
  // (and on a slow TTL as a safety net), so going live is instant
  let attachmentCache: { ids: Set<string>; at: number } | null = null
  const invalidateAttachmentCache = () => {
    attachmentCache = null
  }

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

  /**
   * The slug follows the current title on every publish; every slug a page
   * has ever used is kept in page_slugs so old public URLs 301 instead of
   * breaking. (Before v0.4 the first slug was frozen forever.)
   */
  async function ensureSlug(page: PageRow): Promise<string> {
    const base = slugify(page.title)
    if (page.slug === base) return page.slug
    const siblings = await repo.listPagesInSpace(page.spaceId)
    const taken = new Set(siblings.filter((p) => p.id !== page.id).map((p) => p.slug))
    let slug = base
    let n = 2
    while (taken.has(slug)) {
      slug = `${base}-${n}`
      n++
    }
    if (page.slug === slug) return slug
    if (page.slug) await repo.addPageSlug(page.id, page.slug, now()) // retire the old one
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

      // snapshot which attachments this version references — the public file
      // route serves exactly the union of live versions' attachment ids
      const attachmentIds = new Set(extractAttachmentIds(doc.content))
      let html = blocknoteToHtml(doc.content)
      let textPlain = plainText(doc.content)

      if (page.pageType === 'gallery') {
        const items = (await repo.listGalleryItems(pageId)).sort((a, b) => a.position - b.position)
        html += galleryHtml(
          items.map((i) => ({
            url: `/api/files/${i.attachmentId}`,
            thumbUrl: `/api/files/${i.attachmentId}/thumb`,
            caption: i.caption,
          })),
          page.galleryLayout,
          page.galleryAutoplaySecs,
        )
        for (const i of items) attachmentIds.add(i.attachmentId)
        textPlain += `\n${items
          .map((i) => i.caption)
          .filter(Boolean)
          .join('\n')}`
      }

      // the cover rides the snapshot: it stays publicly servable exactly as
      // long as this version is live, like every other referenced attachment
      if (page.coverAttachmentId) attachmentIds.add(page.coverAttachmentId)

      const version: PageVersionRow = {
        id: nanoid(),
        pageId,
        version: versionNumber,
        title: page.title,
        slug,
        content: doc.content,
        html,
        textPlain,
        attachmentIds: JSON.stringify([...attachmentIds]),
        coverAttachmentId: page.coverAttachmentId,
        // SEO description and tags freeze with the snapshot — public tag
        // pages and meta derive from live versions, never working copies
        metaDescription: page.metaDescription,
        tags: JSON.stringify((await repo.listPageTags(pageId)).map((t) => t.tag).sort()),
        createdBy: user.id,
        createdAt: now(),
      }
      await repo.insertPageVersion(version)
      await repo.setLivePointer(pageId, version.id)
      // record the slug in history too — redirect resolution reads one table
      await repo.addPageSlug(pageId, slug, now())
      invalidateAttachmentCache()
      return version
    },

    /** Take the page off the site; history is kept, nothing is deleted. */
    async retire(user: UserRow, pageId: string): Promise<void> {
      await requirePage(pageId, user)
      await repo.setLivePointer(pageId, null)
      invalidateAttachmentCache()
    },

    /** Rollback = move the live pointer to an older version. */
    async republish(user: UserRow, pageId: string, versionId: string): Promise<void> {
      await requirePage(pageId, user)
      const version = await repo.getVersion(versionId)
      if (!version || version.pageId !== pageId) {
        throw new PagesError('NOT_FOUND', 'Version not found.')
      }
      await repo.setLivePointer(pageId, versionId)
      invalidateAttachmentCache()
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
        maintenance?: boolean
        host: string | null
        title: string | null
        footer: string | null
        theme: 'paper' | 'ink' | 'mist' | 'sand' | 'bloom'
        appearance?: 'auto' | 'light' | 'dark' | 'toggle'
        social?: Array<{ platform: string; url: string }>
        logoAttachmentId?: string | null
        tagline?: string | null
        headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
        titleSize?: 'sm' | 'md' | 'lg' | 'xl'
        logoSize?: 'sm' | 'md' | 'lg'
        faviconAttachmentId?: string | null
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
        publicMaintenance: input.maintenance ?? false,
        publicHost: input.host,
        publicTitle: input.title,
        publicFooter: input.footer,
        publicTheme: input.theme,
        publicAppearance: input.appearance ?? 'auto',
        publicSocial: JSON.stringify(input.social ?? []),
        publicLogoAttachmentId: input.logoAttachmentId ?? null,
        publicTagline: input.tagline ?? null,
        publicHeaderLayout: input.headerLayout ?? 'classic',
        publicTitleSize: input.titleSize ?? 'md',
        publicLogoSize: input.logoSize ?? 'md',
        publicFaviconAttachmentId: input.faviconAttachmentId ?? null,
      })
      invalidateAttachmentCache()
    },

    /** Attachment ids visible to the public: union over live versions of enabled spaces. */
    async publicAttachmentIds(): Promise<Set<string>> {
      if (attachmentCache && Date.now() - attachmentCache.at < 60_000) {
        return attachmentCache.ids
      }
      const ids = new Set<string>()
      const spaces = await repo.listSpaces()
      for (const space of spaces.filter((s) => s.publicEnabled)) {
        // the site logo is public chrome, servable while the site is enabled
        if (space.publicLogoAttachmentId) ids.add(space.publicLogoAttachmentId)
        const entries = await this.liveTree(space.id)
        for (const e of entries) {
          try {
            for (const id of JSON.parse(e.version.attachmentIds) as string[]) ids.add(id)
          } catch {
            // pre-attachment versions have no ids
          }
        }
      }
      attachmentCache = { ids, at: Date.now() }
      return ids
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
      const scheduled = await repo.getPendingJobByTypeRef(SCHEDULED_PUBLISH, page.id)
      return {
        spaceEnabled: space.publicEnabled,
        host: space.publicHost,
        live: live
          ? { versionId: live.id, version: live.version, publishedAt: live.createdAt.toISOString() }
          : null,
        pending,
        slugPath,
        scheduledAt: scheduled ? scheduled.runAt.toISOString() : null,
      }
    },

    // ---- scheduled publishing ----

    /** Queue a publish for later; replaces any earlier schedule for the page. */
    async schedulePublish(user: UserRow, pageId: string, at: Date): Promise<void> {
      await requirePage(pageId, user)
      if (at.getTime() <= now().getTime())
        throw new PagesError('BAD_CONTENT', 'The scheduled time must be in the future.')
      await repo.cancelPendingJobsForTypeRef(SCHEDULED_PUBLISH, pageId)
      await repo.insertJob({
        id: nanoid(),
        type: SCHEDULED_PUBLISH,
        refId: pageId,
        payload: JSON.stringify({ by: user.id }),
        runAt: at,
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: now(),
      })
    },

    async cancelScheduledPublish(user: UserRow, pageId: string): Promise<void> {
      await requirePage(pageId, user)
      await repo.cancelPendingJobsForTypeRef(SCHEDULED_PUBLISH, pageId)
    },

    // ---- draft preview links ----

    /** Mint a shareable read-only link to the working copy. Token shown once. */
    async createPreview(user: UserRow, pageId: string): Promise<{ token: string }> {
      await requirePage(pageId, user)
      const token = randomBytes(24).toString('base64url')
      const row: PreviewRow = {
        id: nanoid(),
        tokenHash: hashToken(token),
        pageId,
        createdBy: user.id,
        createdAt: now(),
        revokedAt: null,
      }
      await repo.insertPreview(row)
      return { token }
    },

    async listPreviews(user: UserRow, pageId: string): Promise<PreviewRow[]> {
      await requirePage(pageId, user)
      return (await repo.listPreviewsForPage(pageId)).filter((p) => !p.revokedAt)
    },

    async revokePreview(user: UserRow, pageId: string, previewId: string): Promise<void> {
      await requirePage(pageId, user)
      const rows = await repo.listPreviewsForPage(pageId)
      const row = rows.find((p) => p.id === previewId)
      if (row) await repo.revokePreview(row.id, now())
    },

    /** Token → page, for the anonymous preview route. Null if revoked/unknown. */
    async resolvePreviewToken(token: string): Promise<PageRow | null> {
      const row = await repo.getPreviewByTokenHash(hashToken(token))
      if (!row || row.revokedAt) return null
      const page = await repo.getPage(row.pageId)
      return page && !page.trashedAt ? page : null
    },

    /** Working copy rendered for preview (content + gallery, like publish would). */
    async renderPreview(page: PageRow): Promise<{ html: string; title: string }> {
      const doc = await repo.getDocument(page.id)
      let html = doc ? blocknoteToHtml(doc.content) : ''
      if (page.pageType === 'gallery') {
        const items = (await repo.listGalleryItems(page.id)).sort((a, b) => a.position - b.position)
        html += galleryHtml(
          items.map((i) => ({
            url: `/api/files/${i.attachmentId}`,
            thumbUrl: `/api/files/${i.attachmentId}/thumb`,
            caption: i.caption,
          })),
          page.galleryLayout,
          page.galleryAutoplaySecs,
        )
      }
      return { html, title: page.title }
    },

    /** Attachment ids the preview may serve: the working doc's + gallery's. */
    async previewAttachmentIds(page: PageRow): Promise<Set<string>> {
      const doc = await repo.getDocument(page.id)
      const ids = new Set(doc ? extractAttachmentIds(doc.content) : [])
      for (const item of await repo.listGalleryItems(page.id)) ids.add(item.attachmentId)
      if (page.coverAttachmentId) ids.add(page.coverAttachmentId)
      return ids
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
      // a trashed page (or one under a trashed ancestor) is off the site
      // immediately, without touching its publish state — restore brings it back
      const lineageLive = (p: PageRow): boolean => {
        let cursor: PageRow | undefined = p
        while (cursor) {
          if (!cursor.liveVersionId || cursor.trashedAt) return false
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
              // icon is a live nav-presentation concern (like the tree structure),
              // not part of the frozen snapshot — change it without republishing
              icon: e.page.icon,
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
