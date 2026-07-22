import {
  FORM_CSS,
  FORM_JS,
  RECAPTCHA_SCRIPT,
  TABLE_EMBED_CSS,
  TABLE_EMBED_JS,
  albumCardsHtml,
  analyticsHtml,
  buildRss,
  buildSitemap,
  categoryFilterHtml,
  categorySlug,
  docs404,
  docsSearchResults,
  docsShell,
  docsTagPage,
  extractHeadings,
  formHtml,
  sectionListHtml,
  shareBarHtml,
  site404,
  siteBlogIndex,
  sitePage,
  sitePost,
  siteSearchResults,
  siteTagPage,
  tableEmbedHtml,
} from '@bn/renderer'
import type {
  AlbumCard,
  Crumb,
  FormCaptchaInput,
  FormItemInput,
  SiteMeta,
  SiteNavItem,
  SocialLink,
} from '@bn/renderer'
import { clampFormColumns, normalizeFormLayout, normalizeFormOrder } from '@bn/schema'
import type { DbCellValue, DbColumn, FormConfig } from '@bn/schema'
import type { FastifyReply } from 'fastify'
import { effectiveCaptchaMode, makeMathChallenge } from './captcha'
import type { PublishingService } from './publishing'
import type { Repo, SpaceRow } from './repo'

/** What the serve path needs to render captchas into embedded forms. */
export type PublicSecurity = {
  captchaSecret: Buffer
  recaptchaSiteKey: () => string | null
  now: () => number
}

/**
 * The unauthenticated read path. It can only reach spaces flagged
 * publicEnabled and content stored in page_versions — the working-copy
 * tables are never touched here.
 */
export function createPublicServer(
  repo: Repo,
  publishing: PublishingService,
  security: PublicSecurity,
) {
  async function resolveSpace(host: string) {
    const space = await repo.getSpaceByPublicHost(host.toLowerCase())
    if (!space || !space.publicEnabled) return null
    return space
  }

  /**
   * A missed path may be built from slugs a page USED to publish under
   * (titles change, slugs follow). Walk the segments allowing historical
   * slugs at every level; a hit returns the canonical path for a 301.
   */
  async function resolveHistoricalPath(
    site: Awaited<ReturnType<PublishingService['publicSite']>>,
    path: string,
  ): Promise<string | null> {
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) return null
    const history = new Map<string, Set<string>>()
    for (const row of await repo.listAllPageSlugs()) {
      let set = history.get(row.pageId)
      if (!set) history.set(row.pageId, (set = new Set()))
      set.add(row.slug)
    }
    let parentId: string | null = null
    let hit: (typeof site.flat)[number] | undefined
    let usedHistory = false
    for (const segment of segments) {
      const children: typeof site.flat = site.flat.filter((f) => f.entry.page.parentId === parentId)
      hit = children.find((f) => f.entry.version.slug === segment)
      if (!hit) {
        hit = children.find((f) => history.get(f.entry.page.id)?.has(segment))
        if (!hit) return null
        usedHistory = true
      }
      parentId = hit.entry.page.id
    }
    // only redirect when a historical slug did the resolving — otherwise the
    // path would have matched byPath already
    return usedHistory && hit ? hit.path : null
  }

  /** Returns true if it handled the request. basePath '' = host routing; '/s/<host>' = dev escape. */
  async function serve(
    host: string,
    rawPath: string,
    query: Record<string, unknown>,
    basePath: string,
    reply: FastifyReply,
    /** editBase is the app's URL, set only when the visitor has a session */
    opts: { editBase?: string | null } = {},
  ): Promise<boolean> {
    const space = await resolveSpace(host)
    if (!space) return false

    // Analytics is added once, here, rather than threaded through a dozen
    // shell calls: every published page leaves through this function, and each
    // shell emits exactly one </head>. Nothing is added when the space has no
    // provider — the tag simply does not exist on the page.
    const analytics = analyticsHtml({
      provider: space.analyticsProvider,
      siteId: space.analyticsSiteId,
      host: space.analyticsHost,
    })
    if (analytics) {
      const send = reply.send.bind(reply)
      reply.send = ((payload: unknown) => {
        if (typeof payload === 'string' && payload.includes('</head>')) {
          return send(payload.replace('</head>', `${analytics}</head>`))
        }
        return send(payload)
      }) as typeof reply.send
    }

    const path = rawPath === '' ? '/' : rawPath

    if (path === '/robots.txt') {
      reply.type('text/plain; charset=utf-8')
      reply.send(`User-agent: *\nAllow: /\nSitemap: https://${host}/sitemap.xml\n`)
      return true
    }

    // tokened draft preview: the working copy, noindex, revocable
    if (path.startsWith('/_preview/')) {
      await servePreview(space, path.slice('/_preview/'.length), basePath, reply)
      return true
    }

    // 'site' category spaces render with the website theme; everything else
    // gets the docs renderer. Same read model underneath.
    if (space.category === 'site') {
      await serveWebsite(space, host, path, query, basePath, reply)
      return true
    }

    const site = await publishing.publicSite(space, path)
    // wikis are themed like websites (same tokens, same appearance rule)
    const theme = space.publicTheme
    const appearance = space.publicAppearance
    const socials = parseSocialLinks(space.publicSocial)
    const tagsOfDoc = (entry: { entry: { version: { tags: string } } }): string[] => {
      try {
        const parsed = JSON.parse(entry.entry.version.tags)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }

    reply.type('text/html; charset=utf-8')

    if (path === '/sitemap.xml') {
      reply.type('application/xml; charset=utf-8')
      reply.send(buildSitemap(site.flat.map((f) => `https://${host}${f.path}`)))
      return true
    }

    if (path === '/_search') {
      const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
      const needle = q.toLowerCase()
      const results = q
        ? site.flat
            .filter(
              (f) =>
                f.entry.version.title.toLowerCase().includes(needle) ||
                f.entry.version.textPlain.toLowerCase().includes(needle),
            )
            .slice(0, 30)
            .map((f) => ({
              title: f.title,
              path: f.path,
              snippet: snippetAround(f.entry.version.textPlain, needle),
            }))
        : []
      reply.send(
        docsSearchResults({
          siteTitle: site.siteTitle,
          footer: site.footer,
          basePath,
          nav: site.nav,
          theme,
          appearance,
          social: socials,
          query: q,
          results,
        }),
      )
      return true
    }

    if (path.startsWith('/tags/')) {
      const tag = decodeURIComponent(path.slice('/tags/'.length)).toLowerCase()
      reply.send(
        docsTagPage({
          siteTitle: site.siteTitle,
          footer: site.footer,
          basePath,
          nav: site.nav,
          theme,
          appearance,
          social: socials,
          tag,
          items: site.flat
            .filter((f) => tagsOfDoc(f).includes(tag))
            .map((f) => ({
              title: f.title,
              path: f.path,
              snippet: f.entry.version.textPlain.trim().replace(/\s+/g, ' ').slice(0, 160),
            })),
        }),
      )
      return true
    }

    if (path === '/') {
      const first = site.flat[0]
      if (!first) {
        reply.code(404).send(docs404(site.siteTitle, site.footer, basePath, theme, appearance))
        return true
      }
      reply.redirect(`${basePath}${first.path}`, 302)
      return true
    }

    const hit = site.byPath.get(path)
    if (!hit) {
      const canonical = await resolveHistoricalPath(site, path)
      if (canonical) {
        reply.redirect(`${basePath}${canonical}`, 301)
        return true
      }
      reply.code(404).send(docs404(site.siteTitle, site.footer, basePath, theme, appearance))
      return true
    }

    const idx = site.flat.findIndex((f) => f.path === path)
    const prev = idx > 0 ? site.flat[idx - 1] : undefined
    const next = idx >= 0 && idx < site.flat.length - 1 ? site.flat[idx + 1] : undefined

    // breadcrumb trail from the live tree (the site renderer has had this)
    const byId = new Map(site.flat.map((f) => [f.entry.page.id, f]))
    const crumbs: Array<{ title: string; path: string }> = []
    let cursor = hit.entry.page.parentId ? byId.get(hit.entry.page.parentId) : undefined
    while (cursor) {
      crumbs.unshift({ title: cursor.title, path: cursor.path })
      cursor = cursor.entry.page.parentId ? byId.get(cursor.entry.page.parentId) : undefined
    }

    reply.header('etag', `W/"${hit.entry.version.id}"`)
    reply.send(
      docsShell({
        siteTitle: site.siteTitle,
        footer: site.footer,
        pageTitle: hit.entry.version.title,
        contentHtml: await expandForms(
          repo,
          rewriteInternalLinks(hit.entry.version.html, site, basePath),
          security,
        ),
        nav: site.nav,
        basePath,
        prev: prev ? { title: prev.title, path: prev.path } : undefined,
        next: next ? { title: next.title, path: next.path } : undefined,
        crumbs,
        social: socials,
        // the TOC is derived from the snapshot's blocks, so it always matches
        // the ids baked into the stored HTML
        toc: extractHeadings(hit.entry.version.content),
        updatedAt: hit.entry.version.createdAt.toISOString(),
        editUrl: opts.editBase ? `${opts.editBase}/p/${hit.entry.page.id}` : null,
        theme,
        appearance,
        tags: tagsOfDoc(hit),
        meta: {
          description:
            hit.entry.version.metaDescription ||
            hit.entry.version.textPlain.trim().replace(/\s+/g, ' ').slice(0, 160) ||
            null,
          url: `https://${host}${hit.path}`,
        },
      }),
    )
    return true
  }

  async function serveWebsite(
    space: SpaceRow,
    host: string,
    path: string,
    query: Record<string, unknown>,
    basePath: string,
    reply: FastifyReply,
  ): Promise<void> {
    const site = await publishing.publicSite(space, path)
    const theme = space.publicTheme
    const appearance = space.publicAppearance
    const socials = parseSocialLinks(space.publicSocial)
    const branding = {
      logoUrl: space.publicLogoAttachmentId ? `/api/files/${space.publicLogoAttachmentId}` : null,
      tagline: space.publicTagline,
      headerLayout: space.publicHeaderLayout,
      faviconUrl: space.publicLogoAttachmentId
        ? `/api/files/${space.publicLogoAttachmentId}/thumb`
        : null,
    }
    const absUrl = (p2: string) => `https://${host}${p2}`
    // og/meta head block: description falls back to the snapshot's text
    const metaFor = (
      entry: {
        entry: {
          version: {
            metaDescription: string | null
            textPlain: string
            coverAttachmentId: string | null
          }
        }
        path: string
      },
      type: 'website' | 'article' = 'website',
    ): SiteMeta => ({
      description:
        entry.entry.version.metaDescription ||
        entry.entry.version.textPlain.trim().replace(/\s+/g, ' ').slice(0, 160) ||
        null,
      ogImage: entry.entry.version.coverAttachmentId
        ? absUrl(`/api/files/${entry.entry.version.coverAttachmentId}`)
        : space.publicLogoAttachmentId
          ? absUrl(`/api/files/${space.publicLogoAttachmentId}`)
          : null,
      url: absUrl(entry.path),
      type,
    })
    const tagsOf = (entry: { entry: { version: { tags: string } } }): string[] => {
      try {
        const parsed = JSON.parse(entry.entry.version.tags)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    const siteTitle = site.siteTitle
    const footer = site.footer
    const byId = new Map(site.flat.map((f) => [f.entry.page.id, f]))

    // Hierarchical nav from the live tree. Children of blog pages are posts —
    // the blog index (dated, complete) is their menu, so they stay out of the
    // dropdowns; everything else nests. Parents light up on the active trail.
    const toNav = (nodes: typeof site.nav): SiteNavItem[] =>
      nodes.map((n) => {
        const entry = site.byPath.get(n.path)
        const isBlog = entry?.entry.page.pageType === 'blog'
        return {
          title: n.title,
          path: n.path,
          active: path === n.path || path.startsWith(`${n.path}/`),
          icon: n.icon,
          children: isBlog ? [] : toNav(n.children),
        }
      })
    const nav = toNav(site.nav)
    const roots = site.flat.filter((f) => f.entry.page.parentId === null)

    const crumbsFor = (item: (typeof site.flat)[number]): Crumb[] => {
      const chain: Crumb[] = []
      let cursor = item.entry.page.parentId ? byId.get(item.entry.page.parentId) : undefined
      while (cursor) {
        chain.unshift({ title: cursor.title, path: cursor.path })
        cursor = cursor.entry.page.parentId ? byId.get(cursor.entry.page.parentId) : undefined
      }
      return chain
    }
    const blogEntries = site.flat.filter((f) => f.entry.page.pageType === 'blog')
    const rssPath = blogEntries.length > 0 ? '/rss.xml' : undefined

    const postsOfBlog = async (blogPageId: string, blogPath: string) => {
      const children = site.flat.filter((f) => f.entry.page.parentId === blogPageId)
      const dates = await publishing.firstPublishedAt(children.map((c) => c.entry.page.id))
      return children
        .map((c) => ({
          title: c.title,
          path: c.path,
          date: dates.get(c.entry.page.id) ?? c.entry.version.createdAt,
          snippet: c.entry.version.textPlain.slice(0, 160),
          cover: c.entry.version.coverAttachmentId
            ? `/api/files/${c.entry.version.coverAttachmentId}/thumb`
            : null,
          // the category lives on the live page, not the snapshot — like the
          // nav icon, recategorising is presentation and needs no republish
          category: c.entry.page.category,
          blogPath,
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime())
    }

    /** ?category=<slug>, as a slug — the one place the query param is read. */
    const askedCategory = typeof query.category === 'string' ? query.category.toLowerCase() : ''
    /** Distinct categories over a set of live pages, in display order. */
    const categoriesOf = (names: Array<string | null | undefined>): string[] => {
      const seen = new Map<string, string>()
      for (const name of names) {
        const trimmed = name?.trim()
        if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed)
      }
      return [...seen.values()].sort((a, b) => a.localeCompare(b))
    }

    // per-page opt-in share buttons, composed at serve time (needs the host)
    const shareFor = (entry: (typeof site.flat)[number]) =>
      entry.entry.page.shareEnabled
        ? shareBarHtml({ url: `https://${host}${entry.path}`, title: entry.title })
        : ''

    reply.type('text/html; charset=utf-8')

    if (path === '/sitemap.xml') {
      reply.type('application/xml; charset=utf-8')
      reply.send(buildSitemap(site.flat.map((f) => `https://${host}${f.path}`)))
      return
    }

    if (path === '/_search') {
      const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
      const needle = q.toLowerCase()
      const results = q
        ? site.flat
            .filter(
              (f) =>
                f.entry.version.title.toLowerCase().includes(needle) ||
                f.entry.version.textPlain.toLowerCase().includes(needle),
            )
            .slice(0, 30)
            .map((f) => ({
              title: f.title,
              path: f.path,
              snippet: snippetAround(f.entry.version.textPlain, needle),
            }))
        : []
      reply.send(
        siteSearchResults({
          siteTitle,
          footer,
          theme,
          appearance,
          socials,
          ...branding,
          nav,
          basePath,
          query: q,
          results,
        }),
      )
      return
    }

    if (path.startsWith('/tags/')) {
      const tag = decodeURIComponent(path.slice('/tags/'.length)).toLowerCase()
      const items = site.flat
        .filter((f) => tagsOf(f).includes(tag))
        .sort((a, b) => b.entry.version.createdAt.getTime() - a.entry.version.createdAt.getTime())
        .map((f) => ({
          title: f.title,
          path: f.path,
          snippet: f.entry.version.textPlain.trim().replace(/\s+/g, ' ').slice(0, 160),
        }))
      reply.send(
        siteTagPage({
          siteTitle,
          footer,
          theme,
          appearance,
          socials,
          ...branding,
          nav,
          basePath,
          tag,
          items,
        }),
      )
      return
    }

    if (path === '/rss.xml') {
      const items = []
      for (const blog of blogEntries) {
        items.push(...(await postsOfBlog(blog.entry.page.id, blog.path)))
      }
      items.sort((a, b) => b.date.getTime() - a.date.getTime())
      reply.type('application/rss+xml; charset=utf-8')
      reply.send(
        buildRss({
          siteTitle,
          siteUrl: `https://${host}`,
          description: footer || siteTitle,
          items: items.map((i) => ({
            title: i.title,
            path: i.path,
            date: i.date,
            snippet: i.snippet,
          })),
        }),
      )
      return
    }

    // '/' renders the first root page as the home page
    const hit = path === '/' ? roots[0] : site.byPath.get(path)
    if (!hit) {
      const canonical = await resolveHistoricalPath(site, path)
      if (canonical) {
        reply.redirect(`${basePath}${canonical}`, 301)
        return
      }
      reply.code(404).send(site404({ siteTitle, footer, theme, appearance, basePath }))
      return
    }
    if (path === '/' && roots[0]) {
      nav[0] = { ...nav[0], title: nav[0]?.title ?? '', path: nav[0]?.path ?? '/', active: true }
    }

    reply.header('etag', `W/"${hit.entry.version.id}"`)

    // blog index page: own content + dated post list
    if (hit.entry.page.pageType === 'blog') {
      const POSTS_PER_PAGE = 10
      const everything = await postsOfBlog(hit.entry.page.id, hit.path)
      // chips list every category the blog has, even while filtered — the way
      // back out of a filter has to stay on the page
      const categories = categoriesOf(everything.map((p) => p.category))
      const activeCategory =
        askedCategory && categories.some((c) => categorySlug(c) === askedCategory)
          ? askedCategory
          : null
      const all = activeCategory
        ? everything.filter((p) => p.category && categorySlug(p.category) === activeCategory)
        : everything
      const totalPages = Math.max(1, Math.ceil(all.length / POSTS_PER_PAGE))
      const pageNum = Math.min(
        totalPages,
        Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1),
      )
      const posts = all.slice((pageNum - 1) * POSTS_PER_PAGE, pageNum * POSTS_PER_PAGE)
      reply.send(
        siteBlogIndex({
          siteTitle,
          footer,
          theme,
          appearance,
          socials,
          ...branding,
          nav,
          basePath,
          title: hit.entry.version.title,
          introHtml: await expandForms(
            repo,
            rewriteInternalLinks(hit.entry.version.html, site, basePath) + shareFor(hit),
            security,
          ),
          posts: posts.map((p) => ({
            title: p.title,
            path: p.path,
            date: p.date.toISOString().slice(0, 10),
            snippet: p.snippet,
            cover: p.cover,
            category: p.category,
          })),
          layout: hit.entry.page.blogLayout,
          categories,
          activeCategory,
          crumbs: crumbsFor(hit),
          rssPath: '/rss.xml',
          meta: metaFor(hit),
          pagination: { page: pageNum, totalPages, blogPath: hit.path },
        }),
      )
      return
    }

    // post page: a live child of a blog page
    const parentEntry = hit.entry.page.parentId
      ? site.flat.find((f) => f.entry.page.id === hit.entry.page.parentId)
      : undefined
    if (parentEntry && parentEntry.entry.page.pageType === 'blog') {
      const dates = await publishing.firstPublishedAt([hit.entry.page.id])
      const date = dates.get(hit.entry.page.id) ?? hit.entry.version.createdAt
      // a post's live sub-pages are only reachable forward from here — list
      // them below the content (breadcrumbs cover the way back)
      const postChildren = site.flat.filter((f) => f.entry.page.parentId === hit.entry.page.id)
      reply.send(
        sitePost({
          siteTitle,
          footer,
          theme,
          appearance,
          socials,
          ...branding,
          nav,
          basePath,
          title: hit.entry.version.title,
          date: date.toISOString().slice(0, 10),
          contentHtml: await expandForms(
            repo,
            rewriteInternalLinks(hit.entry.version.html, site, basePath) +
              shareFor(hit) +
              sectionListHtml(
                postChildren.map((c) => ({ title: c.title, path: c.path })),
                basePath,
              ),
            security,
          ),
          blogPath: parentEntry.path,
          blogTitle: parentEntry.title,
          rssPath,
          meta: metaFor(hit, 'article'),
          tags: tagsOf(hit),
          category: hit.entry.page.category,
        }),
      )
      return
    }

    // standard page (home, about, contact, gallery, ...) — children compose
    // at SERVE time, like the blog's post list: publishing a sub-page must
    // surface on the parent without republishing it (snapshots stay frozen)
    const children = site.flat.filter((f) => f.entry.page.parentId === hit.entry.page.id)
    let extras = ''
    if (hit.entry.page.pageType === 'gallery') {
      const albums: AlbumCard[] = children
        .filter((c) => c.entry.page.pageType === 'gallery')
        .map((c) => ({
          title: c.title,
          path: c.path,
          // cover + count come from the child's published grid — the snapshot
          // is the source of truth, so drafts never leak a cover image
          coverUrl:
            c.entry.version.html.match(/class="cell" href="[^"]*"><img src="([^"]+)"/)?.[1] ?? null,
          count: (c.entry.version.html.match(/class="cell"/g) ?? []).length,
          category: c.entry.page.category,
        }))
      // albums narrow the same way posts do, on the same query param
      const albumCategories = categoriesOf(albums.map((a) => a.category))
      const activeCategory =
        askedCategory && albumCategories.some((c) => categorySlug(c) === askedCategory)
          ? askedCategory
          : null
      const shown = activeCategory
        ? albums.filter((a) => a.category && categorySlug(a.category) === activeCategory)
        : albums
      const rest = children.filter((c) => c.entry.page.pageType !== 'gallery')
      extras =
        categoryFilterHtml({
          categories: albumCategories,
          active: activeCategory,
          basePath,
          path: hit.path,
        }) +
        albumCardsHtml(shown, basePath) +
        sectionListHtml(
          rest.map((c) => ({ title: c.title, path: c.path })),
          basePath,
        )
    } else {
      extras = sectionListHtml(
        children.map((c) => ({ title: c.title, path: c.path })),
        basePath,
      )
    }

    reply.send(
      sitePage({
        siteTitle,
        footer,
        theme,
        appearance,
        socials,
        ...branding,
        nav,
        basePath,
        title: hit.entry.version.title,
        contentHtml: await expandForms(
          repo,
          rewriteInternalLinks(hit.entry.version.html, site, basePath) + shareFor(hit) + extras,
          security,
        ),
        crumbs: crumbsFor(hit),
        rssPath,
        meta: metaFor(hit),
      }),
    )
  }

  /** The working copy behind a preview token, rendered with the site chrome. */
  async function servePreview(
    space: SpaceRow,
    token: string,
    basePath: string,
    reply: FastifyReply,
  ): Promise<void> {
    reply.type('text/html; charset=utf-8')
    const page = await publishing.resolvePreviewToken(token)
    if (!page || page.spaceId !== space.id) {
      reply.code(404).send('<h1>Preview not found</h1><p>The link may have been revoked.</p>')
      return
    }
    const { html, title } = await publishing.renderPreview(page)
    // draft images are not public — tag their URLs with the token so the
    // file route can authorize exactly this page's attachments
    const tokened = html.replace(
      /(src|href)="(\/api\/files\/[A-Za-z0-9_-]+(?:\/thumb)?)"/g,
      `$1="$2?preview=${token}"`,
    )
    const banner =
      '<p class="meta" style="border:1px dashed currentColor;border-radius:8px;padding:6px 12px">Draft preview — not published</p>'
    if (space.category === 'site') {
      reply.send(
        sitePage({
          siteTitle: space.publicTitle || space.name,
          footer: space.publicFooter || '',
          theme: space.publicTheme,
          appearance: space.publicAppearance,
          nav: [],
          basePath,
          title,
          contentHtml: banner + tokened,
          meta: { noindex: true },
        }),
      )
      return
    }
    reply.send(
      docsShell({
        siteTitle: space.publicTitle || space.name,
        footer: space.publicFooter || '',
        pageTitle: title,
        contentHtml: banner + tokened,
        nav: [],
        basePath,
        noindex: true,
        theme: space.publicTheme,
        appearance: space.publicAppearance,
        social: parseSocialLinks(space.publicSocial),
      }),
    )
  }

  return { serve, resolveSpace }
}

/**
 * Editor @-mentions produce app links (/p/<id>). At serve time the ones whose
 * target is live on this site become real site URLs — snapshots stay frozen,
 * so a target published LATER still resolves without republishing the source.
 */
function rewriteInternalLinks(
  html: string,
  site: { flat: Array<{ path: string; entry: { page: { id: string } } }> },
  basePath: string,
): string {
  const pathById = new Map(site.flat.map((f) => [f.entry.page.id, f.path]))
  return html.replace(/href="\/p\/([A-Za-z0-9_-]{10,})"/g, (match, id: string) => {
    const target = pathById.get(id)
    return target ? `href="${basePath}${target}"` : match
  })
}

const FORM_TOKEN = /\[\[form:([A-Za-z0-9_-]+)\]\]/g

async function renderFormById(
  repo: Repo,
  id: string,
  security: PublicSecurity,
): Promise<{ html: string; recaptcha: boolean } | null> {
  const table = await repo.getDbTable(id)
  if (!table || !table.form) return null
  let form: FormConfig
  try {
    form = JSON.parse(table.form) as FormConfig
  } catch {
    return null
  }
  if (!form.enabled) return null
  let columns: DbColumn[]
  try {
    columns = JSON.parse(table.columns) as DbColumn[]
  } catch {
    columns = []
  }
  const byId = new Map(columns.map((c) => [c.id, c]))
  const blockById = new Map((form.blocks ?? []).map((b) => [b.id, b]))
  // forms saved before layouts existed carry neither columns nor placements —
  // normalize rather than trust, and they render as the stack they always were
  const formColumns = clampFormColumns(form.columns)
  const order = normalizeFormOrder(
    [...form.fields, ...(form.blocks ?? []).map((b) => b.id)],
    form.order,
  )
  const placements = normalizeFormLayout(order, formColumns, form.layout)
  // one ordered stream: a divider only means anything relative to the fields
  // it sits between
  const fields: FormItemInput[] = order.flatMap((itemId): FormItemInput[] => {
    const at = placements[itemId] ?? { col: 1, width: 1 }
    const block = blockById.get(itemId)
    if (block) {
      return [{ item: block.kind, id: block.id, text: block.text, col: at.col, width: at.width }]
    }
    const c = byId.get(itemId)
    if (!c) return []
    return [
      {
        id: c.id,
        name: c.name,
        type: c.type,
        required: c.required,
        choices: c.choices,
        label: form.labels?.[c.id] ?? '',
        col: at.col,
        width: at.width,
      },
    ]
  })

  const siteKey = security.recaptchaSiteKey()
  const mode = effectiveCaptchaMode(form.captcha ?? 'none', Boolean(siteKey))
  let captcha: FormCaptchaInput = null
  let recaptcha = false
  if (mode === 'basic') {
    const ch = makeMathChallenge(security.captchaSecret, security.now())
    captcha = { mode: 'basic', question: ch.question, token: ch.token }
  } else if (mode === 'recaptcha' && siteKey) {
    captcha = { mode: 'recaptcha', siteKey }
    recaptcha = true
  }

  return {
    html: formHtml({
      actionPath: `/api/forms/${id}`,
      title: form.title,
      description: form.description,
      submitLabel: form.submitLabel,
      successMessage: form.successMessage,
      fields,
      captcha,
      columns: formColumns,
    }),
    recaptcha,
  }
}

const TABLE_TOKEN = /\[\[table=[^\]]*\]\]/g

function parseEmbedAttrs(inner: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of inner.matchAll(/(\w+)\s*=\s*('[^']*'|"[^"]*"|[^\s\]]+)/g)) {
    attrs[(m[1] as string).toLowerCase()] = (m[2] ?? '').replace(/^['"]|['"]$/g, '')
  }
  return attrs
}

function cellDisplay(v: DbCellValue | undefined, type: string): string {
  if (v === null || v === undefined) return ''
  if (type === 'checkbox') return v === true || v === 'true' ? 'Yes' : 'No'
  return String(v)
}

const PRIVATE_EMBED =
  '<div class="bn-table-embed"><p class="bn-embed-empty">This table is private and can’t be shown publicly.</p></div>'

/** Render one `[[table=...]]` token as a read-only presentation, or null to
 *  leave the token untouched (unknown table id). Personal-database tables are
 *  never exposed — their data may not cross onto a public page. */
async function renderTableEmbed(repo: Repo, token: string): Promise<string | null> {
  // the token was escaped by the renderer at publish (quotes -> &#39;/&quot;),
  // so undo that before reading the attributes
  const inner = token
    .slice(2, -2)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
  const attrs = parseEmbedAttrs(inner)
  const id = attrs.table || attrs.id
  if (!id) return null
  const table = await repo.getDbTable(id)
  if (!table) return null
  const database = await repo.getDbDatabase(table.databaseId)
  if (!database || database.ownerId !== null) return PRIVATE_EMBED

  let columns: DbColumn[]
  try {
    columns = JSON.parse(table.columns) as DbColumn[]
  } catch {
    columns = []
  }
  const findCol = (ref: string) =>
    columns.find((c) => c.id === ref || c.name.toLowerCase() === ref.toLowerCase()) ?? null
  if (attrs.columns) {
    const chosen = attrs.columns
      .split(',')
      .map((s) => findCol(s.trim()))
      .filter((c): c is DbColumn => Boolean(c))
    if (chosen.length > 0) columns = chosen
  }

  const cellsOf = (raw: string): Record<string, DbCellValue> => {
    try {
      const p = JSON.parse(raw)
      return p && typeof p === 'object' ? p : {}
    } catch {
      return {}
    }
  }

  let rows = (await repo.listDbRows(id)).sort(
    (a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
  )
  if (attrs.filter?.includes(':')) {
    const [ref, ...rest] = attrs.filter.split(':')
    const col = findCol(ref as string)
    const want = rest.join(':').toLowerCase()
    if (col)
      rows = rows.filter((r) => String(cellsOf(r.cells)[col.id] ?? '').toLowerCase() === want)
  }
  if (attrs.sort) {
    const [ref, dir] = attrs.sort.split(':')
    const col = findCol(ref as string)
    if (col) {
      const sign = dir?.toLowerCase() === 'desc' ? -1 : 1
      rows = [...rows].sort((a, b) => {
        const av = cellsOf(a.cells)[col.id]
        const bv = cellsOf(b.cells)[col.id]
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign
        return String(av ?? '').localeCompare(String(bv ?? '')) * sign
      })
    }
  }
  const limit = Math.min(Math.max(Number(attrs.limit) || 500, 1), 2000)
  rows = rows.slice(0, limit)

  const layout = attrs.layout === 'cards' || attrs.layout === 'list' ? attrs.layout : 'table'
  const pageSize = Math.min(Math.max(Number(attrs.pagesize) || 0, 0), 500)
  const displayRows = rows.map((r) => {
    const cells = cellsOf(r.cells)
    return columns.map((c) => cellDisplay(cells[c.id], c.type))
  })
  return tableEmbedHtml({
    columns: columns.map((c) => c.name),
    rows: displayRows,
    layout,
    pageSize,
  })
}

/**
 * Expand `[[form:<id>]]` and `[[table=...]]` tokens in published content into
 * live intake forms and read-only table presentations. Both compose at serve
 * time (not baked at publish), so edits show without republishing. A token
 * alone in its own paragraph replaces the whole `<p>`.
 */
async function expandForms(repo: Repo, html: string, security: PublicSecurity): Promise<string> {
  const hasForm = html.includes('[[form:')
  const hasTable = html.includes('[[table=')
  if (!hasForm && !hasTable) return html
  let out = html
  let tail = ''

  if (hasForm) {
    const ids = new Set<string>()
    for (const m of out.matchAll(FORM_TOKEN)) ids.add(m[1] as string)
    const rendered = new Map<string, string>()
    let anyRecaptcha = false
    for (const id of ids) {
      const r = await renderFormById(repo, id, security)
      if (r) {
        rendered.set(id, r.html)
        if (r.recaptcha) anyRecaptcha = true
      }
    }
    if (rendered.size > 0) {
      out = out.replace(
        /<p[^>]*>\s*\[\[form:([A-Za-z0-9_-]+)\]\]\s*<\/p>/g,
        (m, id: string) => rendered.get(id) ?? m,
      )
      out = out.replace(FORM_TOKEN, (m, id: string) => rendered.get(id) ?? m)
      tail += `<style>${FORM_CSS}</style><script>${FORM_JS}</script>`
      if (anyRecaptcha) tail += RECAPTCHA_SCRIPT
    }
  }

  if (hasTable) {
    const tokens = new Set<string>()
    for (const m of out.matchAll(TABLE_TOKEN)) tokens.add(m[0])
    const rendered = new Map<string, string>()
    for (const token of tokens) {
      const h = await renderTableEmbed(repo, token)
      if (h) rendered.set(token, h)
    }
    if (rendered.size > 0) {
      out = out.replace(
        /<p[^>]*>\s*(\[\[table=[^\]]*\]\])\s*<\/p>/g,
        (m, tok: string) => rendered.get(tok) ?? m,
      )
      out = out.replace(TABLE_TOKEN, (m) => rendered.get(m) ?? m)
      tail += `<style>${TABLE_EMBED_CSS}</style><script>${TABLE_EMBED_JS}</script>`
    }
  }

  return out + tail
}

function parseSocialLinks(raw: string): SocialLink[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SocialLink[]) : []
  } catch {
    return []
  }
}

function snippetAround(text: string, needle: string): string {
  const idx = text.toLowerCase().indexOf(needle)
  if (idx < 0) return text.slice(0, 120)
  const start = Math.max(0, idx - 50)
  return `${start > 0 ? '…' : ''}${text.slice(start, idx + needle.length + 70)}…`
}

export type PublicServer = ReturnType<typeof createPublicServer>
