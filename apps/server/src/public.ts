import {
  albumCardsHtml,
  buildRss,
  buildSitemap,
  docs404,
  docsSearchResults,
  docsShell,
  sectionListHtml,
  site404,
  siteBlogIndex,
  sitePage,
  sitePost,
} from '@bn/renderer'
import type { AlbumCard, Crumb, SiteNavItem } from '@bn/renderer'
import type { FastifyReply } from 'fastify'
import type { PublishingService } from './publishing'
import type { Repo, SpaceRow } from './repo'

/**
 * The unauthenticated read path. It can only reach spaces flagged
 * publicEnabled and content stored in page_versions — the working-copy
 * tables are never touched here.
 */
export function createPublicServer(repo: Repo, publishing: PublishingService) {
  async function resolveSpace(host: string) {
    const space = await repo.getSpaceByPublicHost(host.toLowerCase())
    if (!space || !space.publicEnabled) return null
    return space
  }

  /** Returns true if it handled the request. basePath '' = host routing; '/s/<host>' = dev escape. */
  async function serve(
    host: string,
    rawPath: string,
    query: Record<string, unknown>,
    basePath: string,
    reply: FastifyReply,
  ): Promise<boolean> {
    const space = await resolveSpace(host)
    if (!space) return false

    const path = rawPath === '' ? '/' : rawPath

    // 'site' category spaces render with the website theme; everything else
    // gets the docs renderer. Same read model underneath.
    if (space.category === 'site') {
      await serveWebsite(space, host, path, basePath, reply)
      return true
    }

    const site = await publishing.publicSite(space, path)

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
          query: q,
          results,
        }),
      )
      return true
    }

    if (path === '/') {
      const first = site.flat[0]
      if (!first) {
        reply.code(404).send(docs404(site.siteTitle, site.footer, basePath))
        return true
      }
      reply.redirect(`${basePath}${first.path}`, 302)
      return true
    }

    const hit = site.byPath.get(path)
    if (!hit) {
      reply.code(404).send(docs404(site.siteTitle, site.footer, basePath))
      return true
    }

    const idx = site.flat.findIndex((f) => f.path === path)
    const prev = idx > 0 ? site.flat[idx - 1] : undefined
    const next = idx >= 0 && idx < site.flat.length - 1 ? site.flat[idx + 1] : undefined

    reply.header('etag', `W/"${hit.entry.version.id}"`)
    reply.send(
      docsShell({
        siteTitle: site.siteTitle,
        footer: site.footer,
        pageTitle: hit.entry.version.title,
        contentHtml: hit.entry.version.html,
        nav: site.nav,
        basePath,
        prev: prev ? { title: prev.title, path: prev.path } : undefined,
        next: next ? { title: next.title, path: next.path } : undefined,
      }),
    )
    return true
  }

  async function serveWebsite(
    space: SpaceRow,
    host: string,
    path: string,
    basePath: string,
    reply: FastifyReply,
  ): Promise<void> {
    const site = await publishing.publicSite(space, path)
    const theme = space.publicTheme
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
          blogPath,
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime())
    }

    reply.type('text/html; charset=utf-8')

    if (path === '/sitemap.xml') {
      reply.type('application/xml; charset=utf-8')
      reply.send(buildSitemap(site.flat.map((f) => `https://${host}${f.path}`)))
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
      reply.code(404).send(site404({ siteTitle, footer, theme, basePath }))
      return
    }
    if (path === '/' && roots[0]) {
      nav[0] = { ...nav[0], title: nav[0]?.title ?? '', path: nav[0]?.path ?? '/', active: true }
    }

    reply.header('etag', `W/"${hit.entry.version.id}"`)

    // blog index page: own content + dated post list
    if (hit.entry.page.pageType === 'blog') {
      const posts = await postsOfBlog(hit.entry.page.id, hit.path)
      reply.send(
        siteBlogIndex({
          siteTitle,
          footer,
          theme,
          nav,
          basePath,
          title: hit.entry.version.title,
          introHtml: hit.entry.version.html,
          posts: posts.map((p) => ({
            title: p.title,
            path: p.path,
            date: p.date.toISOString().slice(0, 10),
            snippet: p.snippet,
          })),
          crumbs: crumbsFor(hit),
          rssPath: '/rss.xml',
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
          nav,
          basePath,
          title: hit.entry.version.title,
          date: date.toISOString().slice(0, 10),
          contentHtml:
            hit.entry.version.html +
            sectionListHtml(
              postChildren.map((c) => ({ title: c.title, path: c.path })),
              basePath,
            ),
          blogPath: parentEntry.path,
          blogTitle: parentEntry.title,
          rssPath,
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
        }))
      const rest = children.filter((c) => c.entry.page.pageType !== 'gallery')
      extras =
        albumCardsHtml(albums, basePath) +
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
        nav,
        basePath,
        title: hit.entry.version.title,
        contentHtml: hit.entry.version.html + extras,
        crumbs: crumbsFor(hit),
        rssPath,
      }),
    )
  }

  return { serve, resolveSpace }
}

function snippetAround(text: string, needle: string): string {
  const idx = text.toLowerCase().indexOf(needle)
  if (idx < 0) return text.slice(0, 120)
  const start = Math.max(0, idx - 50)
  return `${start > 0 ? '…' : ''}${text.slice(start, idx + needle.length + 70)}…`
}

export type PublicServer = ReturnType<typeof createPublicServer>
