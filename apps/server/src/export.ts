// Export/import: the portability promise from TECH-PLAN — "data captivity in a
// personal-notes tool is a trust failure."
//
// Three shapes:
//   1. Full instance  -> a directory of data.json + blobs/   (cli export/import)
//   2. One space      -> a zip of Markdown files + images    (UI download)
//   3. Markdown files -> pages in a space                    (cli import:markdown)

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { blocknoteToMarkdown, markdownToBlocks } from '@bn/renderer'
import { zipSync } from 'fflate'
import { extractAttachmentIds, thumbKey } from './attachments'
import type { BlobStore } from './blobstore'
import type { PagesService } from './pages'
import type { AttachmentRow, PageRow, Repo, UserRow } from './repo'
import { decryptGroup, encryptGroup } from './secrets'
import { reconcileTags } from './tags'
import { reconcileTasks } from './tasks'

const EXPORT_VERSION = 1

// Dates cross the JSON boundary as ISO strings; these are the columns to revive.
const DATE_COLUMNS: Record<string, string[]> = {
  users: ['createdAt'],
  invites: ['createdAt', 'expiresAt', 'usedAt', 'revokedAt'],
  spaces: ['createdAt'],
  pages: ['createdAt', 'updatedAt', 'archivedAt'],
  documents: ['updatedAt'],
  pageVersions: ['createdAt'],
  attachments: ['createdAt'],
  galleryItems: [],
  memos: ['createdAt', 'promotedAt'],
  tasks: ['updatedAt'],
  reminders: ['createdAt', 'completedAt'],
  scheduledJobs: ['runAt', 'createdAt'],
  settings: ['updatedAt'],
  webhooks: ['createdAt', 'lastUsedAt', 'revokedAt'],
}

type Dump = {
  version: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
}

// ---- 1. full instance ----

export async function exportInstance(
  repo: Repo,
  blobs: BlobStore,
  outDir: string,
  opts: { secretsKey?: Buffer } = {},
) {
  mkdirSync(join(outDir, 'blobs'), { recursive: true })

  // sessions and reset tokens are deliberately absent: ephemeral by design
  const tables: Dump['tables'] = {
    users: await repo.listUsers(),
    invites: await repo.listInvites(),
    spaces: await repo.listSpaces(),
    pages: await repo.listAllPages(),
    documents: await repo.listAllDocuments(),
    pageVersions: await repo.listAllVersions(),
    attachments: await repo.listAttachments(),
    galleryItems: await repo.listAllGalleryItems(),
    memos: await repo.listAllMemos(),
    tasks: await repo.listAllTasks(),
    reminders: await repo.listAllReminders(),
    scheduledJobs: await repo.listAllJobs(),
    // secrets are decrypted into the dump so it restores on an instance with
    // a different key — an export dir already holds everything and must be
    // guarded like a backup either way
    settings: (await repo.listSettings()).map((row) => {
      try {
        const parsed = JSON.parse(row.value) as Record<string, unknown>
        const { value } = decryptGroup(opts.secretsKey, row.key, parsed)
        return { ...row, value: JSON.stringify(value) }
      } catch {
        return row
      }
    }),
    webhooks: await repo.listAllWebhooks(),
  } as unknown as Dump['tables']

  const dump: Dump = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  }
  writeFileSync(join(outDir, 'data.json'), JSON.stringify(dump, null, 2))

  let blobCount = 0
  for (const attachment of tables.attachments as unknown as AttachmentRow[]) {
    for (const key of [attachment.hash, thumbKey(attachment.hash)]) {
      if (!(await blobs.exists(key))) continue
      writeFileSync(join(outDir, 'blobs', key), await blobs.read(key))
      blobCount++
    }
  }
  return { tables: Object.keys(tables).length, blobs: blobCount }
}

function revive(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const col of DATE_COLUMNS[table] ?? []) {
    if (typeof out[col] === 'string') out[col] = new Date(out[col] as string)
  }
  return out
}

/** Pages self-reference via parentId; insert parents before children. */
function topoSortPages(pages: Record<string, unknown>[]): Record<string, unknown>[] {
  const remaining = [...pages]
  const inserted = new Set<string>()
  const ordered: Record<string, unknown>[] = []
  while (remaining.length > 0) {
    const before = remaining.length
    for (let i = remaining.length - 1; i >= 0; i--) {
      const page = remaining[i] as { id: string; parentId: string | null }
      if (page.parentId === null || inserted.has(page.parentId)) {
        ordered.push(remaining[i] as Record<string, unknown>)
        inserted.add(page.id)
        remaining.splice(i, 1)
      }
    }
    if (remaining.length === before) {
      throw new Error('page tree contains a cycle or a dangling parentId — refusing to import')
    }
  }
  return ordered
}

export async function importInstance(
  repo: Repo,
  blobs: BlobStore,
  inDir: string,
  opts: { secretsKey?: Buffer } = {},
) {
  if ((await repo.countUsers()) > 0) {
    throw new Error('this instance already has data — import only into a fresh database')
  }
  const dump = JSON.parse(readFileSync(join(inDir, 'data.json'), 'utf8')) as Dump
  if (dump.version !== EXPORT_VERSION) {
    throw new Error(
      `unsupported export version ${dump.version} (this build reads ${EXPORT_VERSION})`,
    )
  }
  const t = dump.tables
  const rows = (name: string) => (t[name] ?? []).map((r) => revive(name, r))

  for (const row of rows('users')) await repo.insertUser(row as never)
  for (const row of rows('invites')) await repo.insertInvite(row as never)
  for (const row of rows('spaces')) await repo.insertSpace(row as never)
  for (const row of topoSortPages(rows('pages'))) await repo.insertPage(row as never)
  for (const row of rows('documents')) await repo.insertDocument(row as never)
  for (const row of rows('pageVersions')) await repo.insertPageVersion(row as never)
  for (const row of rows('attachments')) await repo.insertAttachment(row as never)
  for (const row of rows('galleryItems')) await repo.insertGalleryItem(row as never)
  for (const row of rows('memos')) await repo.insertMemo(row as never)
  for (const row of rows('tasks')) await repo.insertTask(row as never)
  for (const row of rows('reminders')) await repo.insertReminder(row as never)
  for (const row of rows('scheduledJobs')) await repo.insertJob(row as never)
  for (const row of rows('settings') as Array<{ key: string; value: string; updatedAt: Date }>) {
    let value = row.value
    try {
      // re-encrypt secrets under the importing instance's key
      const parsed = JSON.parse(row.value) as Record<string, unknown>
      value = JSON.stringify(encryptGroup(opts.secretsKey, row.key, parsed))
    } catch {
      // keep unparseable rows verbatim
    }
    await repo.putSetting(row.key, value, row.updatedAt)
  }
  for (const row of rows('webhooks')) await repo.insertWebhook(row as never)

  let blobCount = 0
  const blobDir = join(inDir, 'blobs')
  for (const key of safeReaddir(blobDir)) {
    await blobs.put(key, readFileSync(join(blobDir, key)))
    blobCount++
  }
  return { users: (t.users ?? []).length, pages: (t.pages ?? []).length, blobs: blobCount }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

// ---- 2. one space as a Markdown zip ----

function fileSafe(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Untitled'
}

export async function exportSpaceZip(
  repo: Repo,
  blobs: BlobStore,
  spaceId: string,
): Promise<{ filename: string; data: Buffer }> {
  const space = await repo.getSpace(spaceId)
  if (!space) throw new Error('no such space')
  const pages = await repo.listPagesInSpace(spaceId)
  const byParent = new Map<string | null, PageRow[]>()
  for (const page of pages) {
    const list = byParent.get(page.parentId) ?? []
    list.push(page)
    byParent.set(page.parentId, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position)

  const files: Record<string, Uint8Array> = {}
  const attachmentIds = new Set<string>()

  const walk = async (parentId: string | null, prefix: string, taken: Set<string>) => {
    for (const page of byParent.get(parentId) ?? []) {
      const doc = await repo.getDocument(page.id)
      let markdown = doc ? blocknoteToMarkdown(doc.content) : ''
      for (const id of doc ? extractAttachmentIds(doc.content) : []) attachmentIds.add(id)
      // /api/files/<id> urls -> relative _attachments/ paths, resolved below
      markdown = markdown.replace(/\/api\/files\/([A-Za-z0-9_-]+)/g, '_ATTACH_$1_')

      let name = fileSafe(page.title)
      let n = 2
      while (taken.has(name.toLowerCase())) name = `${fileSafe(page.title)} ${n++}`
      taken.add(name.toLowerCase())

      const children = byParent.get(page.id) ?? []
      const path = `${prefix}${name}`
      files[`${path}.md`] = new TextEncoder().encode(`# ${page.title}\n\n${markdown}`)
      if (children.length > 0) await walk(page.id, `${path}/`, new Set())
    }
  }
  await walk(null, '', new Set())

  // resolve attachment placeholders and bundle the binaries
  const attachmentNames = new Map<string, string>()
  for (const id of attachmentIds) {
    const attachment = await repo.getAttachment(id)
    if (!attachment || !(await blobs.exists(attachment.hash))) continue
    const name = `${id}-${fileSafe(attachment.filename)}`
    attachmentNames.set(id, name)
    files[`_attachments/${name}`] = new Uint8Array(await blobs.read(attachment.hash))
  }
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.endsWith('.md')) continue
    let text = new TextDecoder().decode(bytes)
    text = text.replace(/_ATTACH_([A-Za-z0-9_-]+)_/g, (_, id) => {
      const name = attachmentNames.get(id)
      // paths in the zip are relative to the root; keep it simple and rooted
      return name ? `_attachments/${name}` : ''
    })
    files[path] = new TextEncoder().encode(text)
  }

  return {
    filename: `${fileSafe(space.name)}.zip`,
    data: Buffer.from(zipSync(files, { level: 6 })),
  }
}

// ---- 3. markdown folder -> pages ----

export async function importMarkdownDir(
  repo: Repo,
  pages: PagesService,
  user: UserRow,
  dir: string,
  spaceName: string,
  now: () => Date = () => new Date(),
): Promise<{ spaceId: string; pages: number }> {
  const space = await pages.createSpace(user, {
    name: spaceName,
    category: 'notebook',
    personal: false,
  })
  let count = 0

  const walk = async (currentDir: string, parentId: string | null) => {
    const entries = readdirSync(currentDir).sort()
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === '_attachments') continue
      const full = join(currentDir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        const folder = await pages.createPage(user, {
          spaceId: space.id,
          parentId,
          title: entry,
        })
        count++
        await walk(full, folder.id)
        continue
      }
      if (extname(entry).toLowerCase() !== '.md') continue

      let markdown = readFileSync(full, 'utf8')
      let title = basename(entry, extname(entry))
      // a leading H1 becomes the page title instead of a duplicated heading
      const h1 = markdown.match(/^#\s+(.+)\r?\n/)
      if (h1?.[1]) {
        title = h1[1].trim()
        markdown = markdown.slice(h1[0].length)
      }
      const page = await pages.createPage(user, { spaceId: space.id, parentId, title })
      const content = JSON.stringify(markdownToBlocks(markdown))
      await repo.updateDocument(page.id, content, now())
      await reconcileTasks(repo, page.id, content, now())
      await reconcileTags(repo, page.id, content)
      count++
    }
  }
  await walk(dir, null)
  return { spaceId: space.id, pages: count }
}
