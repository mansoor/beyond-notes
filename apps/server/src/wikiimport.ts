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

import { dedupeBlockIds, markdownToBlocks, slugify } from '@bn/renderer'
import type { ImportApplyInput, ImportNodePlan, ImportPlanView, ImportResultView } from '@bn/schema'
import { foldMergedNodes } from '@bn/schema'
import type { AttachmentsService } from './attachments'
import type { DailyService } from './daily'
import { type Fetcher, fetchRepoDocs, titleCase, titleFromPath } from './github'
import { collectImageUrls, importImages, rewriteImageUrls } from './importimages'
import { normalizeLevels, outlineMarkdown, rewriteAnchors } from './importplan'
import type { ImportStash } from './importstash'
import { reconcileLinks } from './links'
import type { PagesService } from './pages'
import type { PublishingService } from './publishing'
import type { Repo, UserRow } from './repo'
import { reconcileTags } from './tags'
import { appendBlocksToContent, reconcileTasks } from './tasks'

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
    // pasted markdown has no repo to resolve relative paths against, so only
    // absolute image urls can be fetched from it
    imageBase: null,
    imageCount: collectImageUrls(outline.nodes.map((n) => n.markdown)).length,
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
    suggestedName: titleCase(repo.repo),
    imageBase: repo.rawBase,
    imageCount: collectImageUrls(nodes.map((n) => n.markdown)).length,
    nodes,
    warnings,
  }
}

export type ImportDeps = {
  repo: Repo
  pages: PagesService
  publishing: PublishingService
  /** only needed when an import is asked to bring the images too */
  attachments?: AttachmentsService
  /** uploaded exports (Notion, Obsidian, Evernote) waiting to be applied */
  stash?: ImportStash
  /** for daily notes, which go into the Journal */
  daily?: DailyService
  now?: () => Date
}

/** Point (bn-page:KEY) links at the pages that were made; unknown keys become text. */
function resolvePageLinks(markdown: string, target: (key: string) => string | null): string {
  return markdown.replace(
    /\[([^\]\n]*)\]\(bn-page:([^)\s]+)\)/g,
    (_m, label: string, key: string) => {
      const href = target(key)
      return href ? `[${label}](${href})` : label
    },
  )
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

  // An uploaded export: the content never left the server, so take it from the
  // stash by key, then fold the merges the reviewer asked for.
  const stash = input.stashId ? (deps.stash?.get(input.stashId, user.id) ?? null) : null
  if (input.stashId && !stash) {
    throw new ImportError('That upload has expired. Upload the file again to import it.')
  }
  const sourceNodes = stash
    ? foldMergedNodes(
        input.nodes.map((n) => ({
          ...n,
          markdown: stash.markdown.get(n.key) ?? '',
          journalDate: stash.journalDates.get(n.key),
        })),
        input.merges ?? {},
      )
    : input.nodes
  // daily notes don't become pages; everything else is the tree
  const journalNodes = sourceNodes.filter((n) => n.journalDate)
  const nodes = normalizeLevels(sourceNodes.filter((n) => !n.journalDate))
  if (nodes.length === 0 && journalNodes.length === 0) {
    throw new ImportError('Nothing was left to import.')
  }

  const space = input.spaceId
    ? await deps.repo.getSpace(input.spaceId)
    : await deps.pages.createSpace(user, {
        name: input.newSpaceName ?? 'Imported wiki',
        category: input.category,
        personal: input.personal,
      })
  if (!space) throw new ImportError('That space no longer exists.')

  // Re-importing a wiki over itself is the common case (the source moved on),
  // and the old pages are what makes that a mess. Archiving rather than deleting
  // keeps every published version and every restore path intact.
  let archived = 0
  if (input.archiveExisting && input.spaceId) {
    const existing = await deps.repo.listPagesInSpace(space.id)
    // archiving a page takes its subtree with it, so only the roots need asking
    const roots = existing.filter((p) => p.parentId === null && p.archivedAt === null)
    for (const page of roots) {
      await deps.pages.archivePage(user, page.id)
      archived++
    }
  }

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

  // images first, so the content pass can point at the stored copies rather
  // than at raw.githubusercontent (which would break the day the repo moves)
  let images = 0
  const warnings: string[] = []
  let imageRewrites = new Map<string, string>()

  // Links between imported notes: a merged note's links go to the page it
  // joined, a daily note's to its Journal day.
  const pageOfKey = new Map(created.map(({ node, pageId }) => [node.key, `/p/${pageId}`]))
  for (const j of journalNodes) pageOfKey.set(j.key, `/day/${j.journalDate}`)
  const merges = input.merges ?? {}
  const linkTarget = (key: string): string | null => {
    let k = key
    const seen = new Set<string>()
    while (!pageOfKey.has(k) && merges[k] && !seen.has(k)) {
      seen.add(k)
      k = merges[k] as string
    }
    return pageOfKey.get(k) ?? null
  }

  // files carried inside an upload: store each one referenced, once
  const fileHrefs = new Map<string, string>()
  if (stash && deps.attachments) {
    const wanted = new Set<string>()
    for (const n of [...nodes, ...journalNodes]) {
      for (const m of n.markdown.matchAll(/\(bn-file:([^)\s]+)\)/g)) if (m[1]) wanted.add(m[1])
    }
    for (const key of wanted) {
      const file = deps.stash?.readFile(stash, key)
      if (!file) continue
      try {
        const attachment = await deps.attachments.upload(user, {
          filename: file.name,
          mime: file.mime,
          data: file.data,
        })
        fileHrefs.set(key, `/api/files/${attachment.id}`)
        images++
      } catch (err) {
        warnings.push(`Left out ${file.name} (${(err as Error).message}).`)
      }
    }
  }
  const finish = (markdown: string) =>
    resolvePageLinks(markdown, linkTarget).replace(
      /(!?)\[([^\]\n]*)\]\(bn-file:([^)\s]+)\)/g,
      (_m, bang: string, label: string, key: string) => {
        const href = fileHrefs.get(key)
        return href ? `${bang}[${label}](${href})` : label
      },
    )

  if (input.importImages && deps.attachments && !stash) {
    const result = await importImages(
      { attachments: deps.attachments },
      user,
      nodes.map((n) => n.markdown),
      { rawBase: input.imageBase ?? null },
    )
    imageRewrites = result.rewrites
    warnings.push(...result.warnings)
    images = result.rewrites.size
  }

  // pass 2: content
  for (const { node, pageId } of created) {
    const markdown = finish(rewriteImageUrls(rewriteAnchors(node.markdown, anchors), imageRewrites))
    const content = JSON.stringify(markdownToBlocks(markdown))
    await deps.repo.updateDocument(pageId, content, now())
    await reconcileTasks(deps.repo, pageId, content, now())
    await reconcileTags(deps.repo, pageId, content)
    await reconcileLinks(deps.repo, pageId, content)
  }

  // daily notes are appended to that day's Journal entry
  let journal = 0
  if (journalNodes.length && deps.daily) {
    for (const node of journalNodes) {
      const { page, doc } = await deps.daily.day(user, node.journalDate as string)
      const existing = JSON.parse(doc.content) as Array<{ id?: string }>
      const seen = new Set(existing.map((b) => b.id).filter((id): id is string => Boolean(id)))
      const blocks = dedupeBlockIds(markdownToBlocks(finish(node.markdown)), seen)
      const content = appendBlocksToContent(doc.content, blocks as never)
      await deps.repo.updateDocument(page.id, content, now())
      await reconcileTasks(deps.repo, page.id, content, now())
      await reconcileTags(deps.repo, page.id, content)
      await reconcileLinks(deps.repo, page.id, content)
      journal++
    }
  } else if (journalNodes.length) {
    warnings.push(
      `${journalNodes.length} daily notes were skipped (the Journal is not available here).`,
    )
  }

  let published = 0
  if (input.publish) {
    for (const { pageId } of created) {
      await deps.publishing.publish(user, pageId)
      published++
    }
  }

  if (stash) deps.stash?.drop(stash.id)

  return {
    spaceId: space.id,
    journal,
    pages: created.length,
    published,
    archived,
    images,
    warnings,
    firstPageId: created[0]?.pageId ?? null,
  }
}
