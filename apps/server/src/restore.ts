/**
 * On-demand restore from a saved backup (admin only) — the read side of
 * backup.ts. A backup is the whole-instance archive (data.json + blobs); this
 * puts chosen *content* back into a live instance.
 *
 * Scope is deliberately content-only. A restore never touches users, passwords,
 * sessions, server settings/secrets, or webhooks — so it can't lock anyone out,
 * rewrite live S3/SMTP config, or wipe the backup schedule. The dangerous
 * whole-instance clone stays in importInstance (fresh DB only).
 *
 * Three buckets, mapped to how the data actually lives:
 *   - tree spaces  → per-space choice. 'merge' (the default) inserts only the
 *                    pages missing here and leaves the rest — including edits
 *                    made after the backup — untouched; 'overwrite' deletes the
 *                    live space first and restores it wholesale.
 *   - journal      → merge by day. Today and Tasks live inside the per-user
 *                    journal space (the dateKey='inbox' page holds quick-add
 *                    tasks), so this one bucket brings all of it back.
 *   - inbox        → the memos table, merged by id.
 *
 * Merge is additive: it only inserts rows absent here and never deletes what is
 * already there, so counts reflect what actually changed (restore 2 deleted
 * pages → "2 pages", not the whole space). Ids are preserved throughout, so this
 * is exact for same-instance recovery — the case it is built for. Users are
 * matched by email, so a rebuilt instance with the same admin still lines up;
 * user-scoped content owned by a user who no longer exists is skipped with a note.
 */

import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { extractAttachmentIds, thumbKey } from './attachments'
import type { BlobStore } from './blobstore'
import { type Dump, EXPORT_VERSION, revive, topoSortPages } from './export'
import { reconcileLinks } from './links'
import type {
  AttachmentRow,
  DocumentRow,
  GalleryItemRow,
  MemoRow,
  PageRow,
  PageVersionRow,
  Repo,
  SpaceRow,
} from './repo'
import { reconcileTags } from './tags'
import { reconcileTasks } from './tasks'

export type RestorePlanSpace = {
  id: string
  name: string
  pageCount: number
  /** a tree space with this id or name already exists — restoring needs a choice */
  conflict: boolean
  /** pages currently in the matching live space */
  existingPages: number
  /** backup pages not present here — what a merge would add */
  missingPages: number
}

export type RestorePlanView = {
  name: string
  exportedAt: string
  version: number
  /** false when the archive was written by a newer build than this one reads */
  compatible: boolean
  spaces: RestorePlanSpace[]
  journalPageCount: number
  journalExists: boolean
  inboxCount: number
}

export type RestoreResultView = {
  spacesRestored: number
  spacesSkipped: number
  pagesRestored: number
  journalPagesRestored: number
  memosRestored: number
  blobs: number
  warnings: string[]
}

export type RestoreSelection = {
  name: string
  spaces: { id: string; mode: 'merge' | 'overwrite' }[]
  journal: boolean
  inbox: boolean
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

type UserLike = { id: string; email: string }

/**
 * Map a backup's user ids onto the live instance by email. Same-instance
 * recovery yields an identity map (the user rows are unchanged); a rebuilt
 * instance whose admin re-registered the same email still lines up. A backup
 * user with no email match is simply absent — their journal/inbox is skipped.
 */
function buildUserMap(dumpUsers: UserLike[], liveUsers: UserLike[]): Map<string, string> {
  const byEmail = new Map(liveUsers.map((u) => [u.email.toLowerCase(), u.id]))
  const map = new Map<string, string>()
  for (const du of dumpUsers) {
    const live = byEmail.get(du.email.toLowerCase())
    if (live) map.set(du.id, live)
  }
  return map
}

function mappedDumpUserIds(dumpUsers: UserLike[] | undefined, liveUsers: UserLike[]): Set<string> {
  return new Set(buildUserMap(dumpUsers ?? [], liveUsers).keys())
}

/** Split a backup zip into its dump and its blob files (keyed by blob key). */
function parseArchive(zip: Uint8Array): { dump: Dump; blobs: Record<string, Uint8Array> } {
  const files = unzipSync(zip)
  const dataJson = files['data.json']
  if (!dataJson) throw new Error('not a Beyond Notes backup — data.json is missing')
  const dump = JSON.parse(strFromU8(dataJson)) as Dump
  const blobs: Record<string, Uint8Array> = {}
  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith('blobs/') && !path.endsWith('/')) blobs[path.slice('blobs/'.length)] = bytes
  }
  return { dump, blobs }
}

export function createRestoreService(deps: {
  repo: Repo
  blobs: BlobStore
  /** the path guard from backup.resolve — null when the file is gone/unsafe */
  resolvePath: (name: string) => string | null
  now?: () => Date
}) {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())

  function load(name: string): { dump: Dump; blobs: Record<string, Uint8Array> } {
    const path = deps.resolvePath(name)
    if (!path) throw new Error('backup not found')
    return parseArchive(new Uint8Array(readFileSync(path)))
  }

  async function plan(name: string): Promise<RestorePlanView> {
    const { dump } = load(name)
    const t = dump.tables
    const spaces = (t.spaces ?? []) as unknown as SpaceRow[]
    const pages = (t.pages ?? []) as unknown as PageRow[]
    const pagesBySpace = groupBy(pages, (p) => p.spaceId)

    const existing = await repo.listSpaces()
    const existingById = new Map(existing.map((s) => [s.id, s]))
    const existingTreeByName = new Map(
      existing.filter((s) => s.kind === 'tree').map((s) => [s.name.toLowerCase(), s]),
    )
    const users = await repo.listUsers()
    // page ids currently living in each space — to count what a merge would add.
    // Trashed pages are treated as gone: they don't count as "current", and the
    // backup can restore over them (see run()), so they show up as missing.
    const livePageIdsBySpace = groupBy(
      (await repo.listAllPages()).filter((p) => p.trashedAt === null),
      (p) => p.spaceId,
    )

    const treeSpaces = spaces
      .filter((s) => s.kind === 'tree')
      .map((s) => {
        const match = existingById.get(s.id) ?? existingTreeByName.get(s.name.toLowerCase())
        const livePageIds = new Set(
          (match ? (livePageIdsBySpace.get(match.id) ?? []) : []).map((p) => p.id),
        )
        const backupPages = pagesBySpace.get(s.id) ?? []
        return {
          id: s.id,
          name: s.name,
          pageCount: backupPages.length,
          conflict: Boolean(match),
          existingPages: livePageIds.size,
          missingPages: backupPages.filter((p) => !livePageIds.has(p.id)).length,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    // user-scoped content is only restorable for a backup user who maps to a
    // live one (matched by email — see run()); count only what would come back
    const mapped = mappedDumpUserIds(t.users as unknown as UserLike[] | undefined, users)
    const journalSpaces = spaces.filter(
      (s) => s.kind === 'journal' && s.ownerId && mapped.has(s.ownerId),
    )
    const journalPageCount = journalSpaces.reduce(
      (sum, s) => sum + (pagesBySpace.get(s.id) ?? []).length,
      0,
    )
    const inboxCount = ((t.memos ?? []) as unknown as MemoRow[]).filter((m) =>
      mapped.has(m.userId),
    ).length

    return {
      name,
      exportedAt: dump.exportedAt,
      version: dump.version,
      compatible: dump.version === EXPORT_VERSION,
      spaces: treeSpaces,
      journalPageCount,
      journalExists: existing.some((s) => s.kind === 'journal'),
      inboxCount,
    }
  }

  async function run(selection: RestoreSelection): Promise<RestoreResultView> {
    const { dump, blobs: blobFiles } = load(selection.name)
    if (dump.version !== EXPORT_VERSION) {
      throw new Error(
        `unsupported backup version ${dump.version} (this build reads ${EXPORT_VERSION})`,
      )
    }
    const warnings: string[] = []
    const result: RestoreResultView = {
      spacesRestored: 0,
      spacesSkipped: 0,
      pagesRestored: 0,
      journalPagesRestored: 0,
      memosRestored: 0,
      blobs: 0,
      warnings,
    }

    const t = dump.tables
    const rows = <T>(name: string): T[] =>
      (t[name] ?? []).map((r) => revive(name, r) as unknown as T)

    const allSpaces = rows<SpaceRow>('spaces')
    const allPages = rows<PageRow>('pages')
    const docByPage = new Map(rows<DocumentRow>('documents').map((d) => [d.pageId, d]))
    const versionsByPage = groupBy(rows<PageVersionRow>('pageVersions'), (v) => v.pageId)
    const slugsByPage = groupBy(
      rows<{ pageId: string; slug: string; createdAt: Date }>('pageSlugs'),
      (s) => s.pageId,
    )
    const galleryByPage = groupBy(rows<GalleryItemRow>('galleryItems'), (g) => g.pageId)
    const attById = new Map(rows<AttachmentRow>('attachments').map((a) => [a.id, a]))
    const pagesBySpace = groupBy(allPages, (p) => p.spaceId)

    const existingSpaces = await repo.listSpaces()
    const existingById = new Map(existingSpaces.map((s) => [s.id, s]))
    const existingTreeByName = new Map(
      existingSpaces.filter((s) => s.kind === 'tree').map((s) => [s.name.toLowerCase(), s]),
    )
    const liveUsers = await repo.listUsers()
    const userMap = buildUserMap(rows<UserLike>('users'), liveUsers)
    const fallbackUserId = liveUsers[0]?.id ?? null
    // nullable author fields (archivedBy/trashedBy) drop to null when unmapped
    const mapUserOptional = (id: string | null): string | null =>
      id ? (userMap.get(id) ?? null) : null
    // required FK authors (attachment/version createdBy) fall back to an admin so
    // a foreign key never dangles when restoring another install's content
    const mapUserRequired = (id: string): string => userMap.get(id) ?? fallbackUserId ?? id

    // attachments referenced by restored content — collected as we insert, then
    // brought in at the end (rows + content-addressed blobs).
    const referenced = new Set<string>()
    const collectRefs = (page: PageRow, doc: DocumentRow | null) => {
      if (page.coverAttachmentId) referenced.add(page.coverAttachmentId)
      if (doc) for (const id of extractAttachmentIds(doc.content)) referenced.add(id)
      for (const g of galleryByPage.get(page.id) ?? []) referenced.add(g.attachmentId)
      for (const v of versionsByPage.get(page.id) ?? []) {
        if (v.coverAttachmentId) referenced.add(v.coverAttachmentId)
        try {
          for (const id of JSON.parse(v.attachmentIds) as string[]) referenced.add(id)
        } catch {
          // a malformed attachmentIds list just contributes nothing
        }
      }
    }

    async function insertPageFull(page: PageRow, targetSpaceId: string): Promise<void> {
      const doc = docByPage.get(page.id) ?? null
      await repo.insertPage({
        ...page,
        spaceId: targetSpaceId,
        archivedBy: mapUserOptional(page.archivedBy),
        trashedBy: mapUserOptional(page.trashedBy),
      })
      if (doc) await repo.insertDocument({ ...doc, pageId: page.id })
      for (const v of versionsByPage.get(page.id) ?? [])
        await repo.insertPageVersion({ ...v, createdBy: mapUserRequired(v.createdBy) })
      for (const s of slugsByPage.get(page.id) ?? [])
        await repo.addPageSlug(s.pageId, s.slug, s.createdAt)
      for (const g of galleryByPage.get(page.id) ?? []) await repo.insertGalleryItem(g)
      collectRefs(page, doc)
      if (doc) {
        // derived indexes rebuild from the document, so tasks and tags come back
        // with the page rather than being copied as their own rows
        await reconcileLinks(repo, page.id, doc.content)
        await reconcileTags(repo, page.id, doc.content)
        await reconcileTasks(repo, page.id, doc.content, now())
      }
      result.pagesRestored++
    }

    // ---- tree spaces ----
    // Pages are always inserted in topological (parents-first) order over the
    // FULL backup set; on a merge we skip ids already present, so a child whose
    // parent is a kept page still finds its parent in the DB.
    for (const sel of selection.spaces) {
      const bSpace = allSpaces.find((s) => s.id === sel.id)
      if (!bSpace || bSpace.kind !== 'tree') {
        warnings.push(`Space ${sel.id} is not in this backup — skipped.`)
        continue
      }
      try {
        const clash =
          existingById.get(bSpace.id) ?? existingTreeByName.get(bSpace.name.toLowerCase())
        const backupPages = topoSortPages(pagesBySpace.get(bSpace.id) ?? []) as unknown as PageRow[]

        if (clash && sel.mode === 'overwrite') {
          await repo.deleteSpace(clash.id) // FK cascade removes its pages + owned rows
          existingById.delete(clash.id)
          existingTreeByName.delete(clash.name.toLowerCase())
        }

        // resolve the space to write into: the surviving clash on a merge, else
        // the backup's own space row (created now)
        let targetId: string
        if (clash && sel.mode === 'merge') {
          targetId = clash.id
        } else {
          let space = bSpace
          if (space.ownerId) {
            const owner = mapUserOptional(space.ownerId)
            if (!owner) {
              warnings.push(
                `"${bSpace.name}" was owned by a missing user — restored as a shared space.`,
              )
            }
            space = { ...space, ownerId: owner }
          }
          await repo.insertSpace(space)
          targetId = space.id
        }

        // a page sitting in the trash counts as gone: it is restorable, and its
        // id is freed (purge the trashed row) so the backup copy can take it back
        const targetPages = await repo.listPagesInSpace(targetId)
        const present = new Set(targetPages.filter((p) => p.trashedAt === null).map((p) => p.id))
        const trashed = new Set(targetPages.filter((p) => p.trashedAt !== null).map((p) => p.id))
        for (const page of backupPages) {
          if (present.has(page.id)) continue // merge: leave a live page you still have alone
          if (trashed.has(page.id)) await repo.deletePage(page.id) // drop the trashed copy first
          await insertPageFull(page, targetId)
        }
        result.spacesRestored++
      } catch (err) {
        warnings.push(
          `Failed to restore "${bSpace.name}": ${err instanceof Error ? err.message : err}`,
        )
      }
    }

    // ---- journal (Today + Tasks live here) : merge by page id ----
    if (selection.journal) {
      for (const bj of allSpaces.filter((s) => s.kind === 'journal')) {
        const owner = mapUserOptional(bj.ownerId)
        if (!owner) {
          if (bj.ownerId) warnings.push('A journal for a user not on this instance was skipped.')
          continue
        }
        try {
          let target = existingSpaces.find((s) => s.kind === 'journal' && s.ownerId === owner)
          if (!target) {
            target = { ...bj, ownerId: owner }
            await repo.insertSpace(target) // no journal yet for this user — adopt the backup's
          }
          const current = await repo.listPagesInSpace(target.id)
          const presentIds = new Set(current.map((p) => p.id))
          // dedupe by day, not id: a day the user already has (even freshly
          // recreated with a new id) is left alone, so restore never doubles up
          // a date. Only days missing entirely come back — "add, don't overwrite".
          const presentDays = new Set(current.map((p) => p.dateKey).filter(Boolean) as string[])
          for (const page of topoSortPages(pagesBySpace.get(bj.id) ?? []) as unknown as PageRow[]) {
            if (presentIds.has(page.id)) continue
            if (page.dateKey && presentDays.has(page.dateKey)) continue
            await insertPageFull(page, target.id)
            result.journalPagesRestored++
          }
        } catch (err) {
          warnings.push(`Failed to restore a journal: ${err instanceof Error ? err.message : err}`)
        }
      }
    }

    // ---- inbox (memos) : merge by id ----
    if (selection.inbox) {
      const present = new Set((await repo.listAllMemos()).map((m) => m.id))
      for (const memo of rows<MemoRow>('memos')) {
        const owner = mapUserOptional(memo.userId)
        if (!owner || present.has(memo.id)) continue
        try {
          await repo.insertMemo({ ...memo, userId: owner })
          result.memosRestored++
        } catch (err) {
          warnings.push(`Failed to restore a memo: ${err instanceof Error ? err.message : err}`)
        }
      }
    }

    // ---- attachments referenced by everything restored above ----
    const existingAtt = new Set((await repo.listAttachments()).map((a) => a.id))
    for (const id of referenced) {
      const att = attById.get(id)
      if (!att) continue
      try {
        if (!existingAtt.has(id)) {
          await repo.insertAttachment({ ...att, createdBy: mapUserRequired(att.createdBy) })
        }
        for (const key of [att.hash, thumbKey(att.hash)]) {
          const bytes = blobFiles[key]
          if (bytes && !(await deps.blobs.exists(key))) {
            await deps.blobs.put(key, Buffer.from(bytes))
            result.blobs++
          }
        }
      } catch (err) {
        warnings.push(
          `Failed to restore an attachment: ${err instanceof Error ? err.message : err}`,
        )
      }
    }

    return result
  }

  return { plan, run }
}

export type RestoreService = ReturnType<typeof createRestoreService>
