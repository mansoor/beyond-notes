/**
 * Where an uploaded export waits between "preview" and "import".
 *
 * The review step only needs titles and structure, so the browser never gets
 * (or sends back) the notes' content or files. The server keeps them here,
 * keyed by an unguessable id and tied to the uploader, until the import runs
 * or an hour passes. Files go to a temp folder rather than memory, since an
 * export's images can run to hundreds of megabytes.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImportNodePlan } from '@bn/schema'
import type { ParsedImport } from './importers'

const TTL_MS = 60 * 60 * 1000

export type StashEntry = {
  id: string
  userId: string
  createdAt: number
  /** full node content by plan key */
  markdown: Map<string, string>
  journalDates: Map<string, string>
  files: Map<string, { name: string; mime: string; path: string }>
}

export function createImportStash(opts: { dir?: string } = {}) {
  const root = opts.dir ?? join(tmpdir(), 'beyond-notes-imports')
  const entries = new Map<string, StashEntry>()

  function drop(id: string) {
    entries.delete(id)
    rmSync(join(root, id), { recursive: true, force: true })
  }

  function prune() {
    const cutoff = Date.now() - TTL_MS
    for (const e of entries.values()) if (e.createdAt < cutoff) drop(e.id)
  }

  return {
    /** Keep a parsed upload; returns the plan nodes the browser gets (no content). */
    put(userId: string, parsed: ParsedImport): { id: string; nodes: ImportNodePlan[] } {
      prune()
      const id = randomBytes(18).toString('base64url')
      const dir = join(root, id)
      mkdirSync(dir, { recursive: true })
      const files = new Map<string, { name: string; mime: string; path: string }>()
      for (const [key, f] of parsed.files) {
        const path = join(dir, key)
        writeFileSync(path, f.data)
        files.set(key, { name: f.name, mime: f.mime, path })
      }
      const markdown = new Map<string, string>()
      const journalDates = new Map<string, string>()
      for (const n of parsed.nodes) {
        markdown.set(n.key, n.markdown)
        if (n.journalDate) journalDates.set(n.key, n.journalDate)
      }
      entries.set(id, { id, userId, createdAt: Date.now(), markdown, journalDates, files })
      return { id, nodes: parsed.nodes.map((n) => ({ ...n, markdown: '' })) }
    },

    /** Only the person who uploaded it can use it. */
    get(id: string, userId: string): StashEntry | null {
      prune()
      const e = entries.get(id)
      return e && e.userId === userId ? e : null
    },

    readFile(entry: StashEntry, key: string): { name: string; mime: string; data: Buffer } | null {
      const f = entry.files.get(key)
      if (!f) return null
      try {
        return { name: f.name, mime: f.mime, data: readFileSync(f.path) }
      } catch {
        return null
      }
    },

    drop,
  }
}

export type ImportStash = ReturnType<typeof createImportStash>
