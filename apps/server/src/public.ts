import { docs404, docsSearchResults, docsShell } from '@bn/renderer'
import type { FastifyReply } from 'fastify'
import type { PublishingService } from './publishing'
import type { Repo } from './repo'

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
    const site = await publishing.publicSite(space, path)

    reply.type('text/html; charset=utf-8')

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

  return { serve, resolveSpace }
}

function snippetAround(text: string, needle: string): string {
  const idx = text.toLowerCase().indexOf(needle)
  if (idx < 0) return text.slice(0, 120)
  const start = Math.max(0, idx - 50)
  return `${start > 0 ? '…' : ''}${text.slice(start, idx + needle.length + 70)}…`
}

export type PublicServer = ReturnType<typeof createPublicServer>
