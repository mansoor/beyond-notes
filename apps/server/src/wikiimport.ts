/**
 * The wiki importer: turn a markdown document or a GitHub repository into a tree
 * of pages.
 *
 * Two passes on purpose. `planFrom*` reads the source and proposes a structure
 * without writing anything; the user reviews it, renames, re-nests or drops
 * rows, and only then does `applyImportPlan` create pages. An import that
 * guessed wrong is a mess to clean up by hand, so the guess is always shown
 * first.
 */

import { markdownToBlocks, slugify } from '@bn/renderer'
import type { ImportApplyInput, ImportNodePlan, ImportPlanView, ImportResultView } from '@bn/schema'
import { type Fetcher, fetchRepoDocs, titleFromPath } from './github'
import { normalizeLevels, outlineMarkdown, rewriteAnchors } from './importplan'
import { reconcileLinks } from './links'
import type { PagesService } from './pages'
import type { PublishingService } from './publishing'
import type { Repo, UserRow } from './repo'
import { reconcileTags } from './tags'
import { reconcileTasks } from './tasks'

export class ImportError extends Error {}

/** Strip a file extension and directory for the plan's space-name suggestion. */
function nameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  return titleFromPath(base)
}

export function planFromMarkdown(markdown: string, filename = ''): ImportPlanView {
  const outline = outlineMarkdown(markdown, { label: filename || 'Imported document' })
  if (outline.nodes.length === 0) throw new ImportError('That document has no content to import.')
  return {
    sourceLabel: filename || 'Pasted markdown',
    suggestedName: outline.title || (filename ? nameFromFilename(filename) : 'Imported wiki'),
    nodes: outline.nodes,
    warnings: outline.warnings,
  }
}

/**
 * The repo shape a wiki wants: the README split into sections, then docs/, then
 * the policy files (CONTRIBUTING, LICENSE…) as flat pages at the bottom — which
 * is where a reader expects them and never at the top of the nav.
 */
export async function planFromGithub(
  input: { url: string; token?: string; includeDocs?: boolean },
  fetcher?: Fetcher,
): Promise<ImportPlanView> {
  const repo = await fetchRepoDocs(input, fetcher)
  const nodes: ImportNodePlan[] = []
  const warnings = [...repo.warnings]

  if (repo.readme) {
    const outline = outlineMarkdown(repo.readme.markdown, {
      label: repo.readme.path,
      keyPrefix: 'readme',
    })
    nodes.push(...outline.nodes.map((n) => ({ ...n, path: repo.readme?.path })))
    warnings.push(...outline.warnings)
  } else {
    warnings.push('No README found in that repository.')
  }

  // docs/ keeps its folder shape: each folder becomes a parent page for its files
  if (repo.docs.length > 0) {
    let key = 0
    const nextKey = () => `docs-${++key}`
    nodes.push({
      key: nextKey(),
      title: 'Documentation',
      level: 0,
      kind: 'file',
      markdown: '',
      excerpt: `${repo.docs.length} file${repo.docs.length === 1 ? '' : 's'} from docs/`,
    })
    const folders = new Set<string>()
    for (const doc of repo.docs) {
      // docs/guides/install.md -> folders ['guides'], file one level deeper
      const segments = doc.path.split('/').slice(1, -1)
      for (let depth = 0; depth < segments.length; depth++) {
        const folderPath = segments.slice(0, depth + 1).join('/')
        if (folders.has(folderPath)) continue
        folders.add(folderPath)
        nodes.push({
          key: nextKey(),
          title: titleFromPath(segments[depth] ?? ''),
          level: depth + 1,
          kind: 'file',
          markdown: '',
          excerpt: 'Folder',
        })
      }
      const h1 = doc.markdown.match(/^#\s+(.+?)\s*$/m)
      const body = doc.markdown.replace(/^#\s+.+\r?\n/, '')
      nodes.push({
        key: nextKey(),
        title: (h1?.[1] ?? doc.name).trim(),
        level: segments.length + 1,
        kind: 'file',
        path: doc.path,
        markdown: body,
        excerpt: body.slice(0, 160).replace(/\s+/g, ' ').trim(),
      })
    }
  }

  // policy files last, flat, in the order GitHub itself lists them
  for (const [i, policy] of repo.policies.entries()) {
    nodes.push({
      key: `policy-${i + 1}`,
      title: policy.name,
      level: 0,
      kind: 'file',
      path: policy.path,
      markdown: policy.markdown.replace(/^#\s+.+\r?\n/, ''),
      excerpt: policy.markdown.slice(0, 160).replace(/\s+/g, ' ').trim(),
    })
  }

  if (nodes.length === 0) throw new ImportError('Nothing importable was found in that repository.')

  // A README section and a root file often cover the same ground (a `## License`
  // section next to LICENSE). Both are real content, so keep them — but say so,
  // because two identically named pages in the nav is confusing, and the review
  // step is exactly where that gets decided.
  const seen = new Map<string, number>()
  for (const node of nodes) {
    const key = node.title.toLowerCase()
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1)
  for (const [title] of dupes) {
    const label = nodes.find((n) => n.title.toLowerCase() === title)?.title ?? title
    warnings.push(`Two pages are called "${label}" — rename or untick one below.`)
  }

  return {
    sourceLabel: `github.com/${repo.owner}/${repo.repo} @ ${repo.ref}`,
    suggestedName: repo.repo.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    nodes,
    warnings,
  }
}

export type ImportDeps = {
  repo: Repo
  pages: PagesService
  publishing: PublishingService
  now?: () => Date
}

/**
 * Create the pages. Runs in plan order with a parent stack, so a node's level
 * decides its parent — exactly what the review list showed.
 */
export async function applyImportPlan(
  deps: ImportDeps,
  user: UserRow,
  input: ImportApplyInput,
): Promise<ImportResultView> {
  const now = deps.now ?? (() => new Date())
  const nodes = normalizeLevels(input.nodes)

  const space = input.spaceId
    ? await deps.repo.getSpace(input.spaceId)
    : await deps.pages.createSpace(user, {
        name: input.newSpaceName ?? 'Imported wiki',
        category: input.category,
        personal: input.personal,
      })
  if (!space) throw new ImportError('That space no longer exists.')

  // pass 1: create every page, so anchors can resolve to real ids in pass 2
  const parents: string[] = []
  const created: Array<{ node: ImportNodePlan; pageId: string }> = []
  for (const node of nodes) {
    const parentId = node.level === 0 ? null : (parents[node.level - 1] ?? null)
    const page = await deps.pages.createPage(user, {
      spaceId: space.id,
      parentId,
      title: node.title,
    })
    parents[node.level] = page.id
    parents.length = node.level + 1
    created.push({ node, pageId: page.id })
  }

  // in-document anchors become links to the page that section became
  const anchors = new Map<string, string>()
  for (const { node, pageId } of created) {
    const anchor = node.anchor || slugify(node.title)
    if (anchor) anchors.set(anchor.toLowerCase(), `/p/${pageId}`)
  }

  // pass 2: content
  for (const { node, pageId } of created) {
    const markdown = rewriteAnchors(node.markdown, anchors)
    const content = JSON.stringify(markdownToBlocks(markdown))
    await deps.repo.updateDocument(pageId, content, now())
    await reconcileTasks(deps.repo, pageId, content, now())
    await reconcileTags(deps.repo, pageId, content)
    await reconcileLinks(deps.repo, pageId, content)
  }

  let published = 0
  if (input.publish) {
    for (const { pageId } of created) {
      await deps.publishing.publish(user, pageId)
      published++
    }
  }

  return {
    spaceId: space.id,
    pages: created.length,
    published,
    firstPageId: created[0]?.pageId ?? null,
  }
}
