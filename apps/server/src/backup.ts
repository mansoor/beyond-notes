/**
 * Automatic + on-demand full backups (admin only). A backup is the whole-
 * instance archive from export.ts (data.json + blobs) written as one zip to
 * BACKUPS_DIR — the local disk is the source of truth for the list and
 * retention. When S3 storage is configured and the setting is on, each backup
 * is also mirrored to S3 under `backups/`.
 *
 * Scheduling rides the existing scheduled_jobs table: one `backup` job at a
 * time. When it fires the scheduler calls runScheduled(), which backs up, prunes
 * to the retention count, and inserts the next job. Config changes reschedule.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupSettings } from '@bn/schema'
import { nanoid } from 'nanoid'
import type { BlobStore } from './blobstore'
import { buildInstanceArchive } from './export'
import type { JobRow, Repo } from './repo'

const NAME_PREFIX = 'beyond-notes-backup-'
const S3_PREFIX = 'backups/'
const BACKUP_JOB = 'backup'
// filesystem-safe ISO: 2026-07-26T03-14-05-123Z; also the traversal guard
const NAME_RE = /^beyond-notes-backup-[0-9TZ-]+\.zip$/

export type BackupInfo = { name: string; sizeBytes: number; createdAt: string }

/** beyond-notes-backup-2026-07-26T03-14-05-123Z.zip → that instant */
function createdFromName(name: string): Date | null {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name)
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The next time a backup should run, at `hour` local time, per frequency. */
export function nextBackupRunAt(config: BackupSettings, from: Date): Date {
  const next = new Date(from)
  next.setHours(config.hour, 0, 0, 0)
  if (next <= from) next.setDate(next.getDate() + 1) // today's slot passed → tomorrow
  if (config.frequency === 'weekly') {
    while (next.getDay() !== 1) next.setDate(next.getDate() + 1) // Monday
  } else if (config.frequency === 'monthly') {
    next.setDate(1) // the 1st
    if (next <= from) next.setMonth(next.getMonth() + 1)
    next.setHours(config.hour, 0, 0, 0)
  }
  return next
}

export function createBackupService(deps: {
  repo: Repo
  blobs: BlobStore
  backupsDir: string
  getConfig: () => BackupSettings
  isS3: () => boolean
  secretsKey?: Buffer
  /** an encrypted copy somewhere else (offsite.ts); failures never fail a backup */
  offsite?: {
    upload(name: string, data: Uint8Array): Promise<unknown>
    prune(keep: number): Promise<void>
  }
  now?: () => Date
}) {
  const now = deps.now ?? (() => new Date())
  const pathFor = (name: string) => join(deps.backupsDir, name)
  const assertSafe = (name: string) => {
    if (!NAME_RE.test(name)) throw new Error('invalid backup name')
  }

  function list(): BackupInfo[] {
    let entries: string[]
    try {
      entries = readdirSync(deps.backupsDir)
    } catch {
      return [] // dir not created yet
    }
    return entries
      .filter((n) => NAME_RE.test(n))
      .map((name) => {
        const st = statSync(pathFor(name))
        return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() }
      })
      .sort((a, b) => b.name.localeCompare(a.name)) // newest first (name is timestamp)
  }

  async function prune(retention: number): Promise<void> {
    for (const b of list().slice(retention)) {
      await unlink(pathFor(b.name)).catch(() => {})
      if (deps.isS3()) await deps.blobs.delete(`${S3_PREFIX}${b.name}`).catch(() => {})
    }
  }

  async function run(): Promise<BackupInfo> {
    const config = deps.getConfig()
    mkdirSync(deps.backupsDir, { recursive: true })
    const name = `${NAME_PREFIX}${now().toISOString().replace(/[:.]/g, '-')}.zip`
    const zip = await buildInstanceArchive(deps.repo, deps.blobs, { secretsKey: deps.secretsKey })
    const buf = Buffer.from(zip)
    await writeFile(pathFor(name), buf)
    if (config.s3Copy && deps.isS3()) {
      await deps.blobs.put(`${S3_PREFIX}${name}`, buf).catch(() => {
        // an S3 mirror failure must not lose the local backup we just wrote
      })
    }
    await deps.offsite?.upload(name, buf)
    await prune(config.retention)
    // offsite keeps as many as local does, counted from the bucket itself
    await deps.offsite?.prune(config.retention)
    const st = statSync(pathFor(name))
    return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() }
  }

  /** Cancel any pending backup job and, if enabled, queue the next one. */
  async function reschedule(): Promise<void> {
    await deps.repo.deleteJobsByType(BACKUP_JOB)
    const config = deps.getConfig()
    if (!config.enabled) return
    const job: JobRow = {
      id: nanoid(),
      type: BACKUP_JOB,
      refId: BACKUP_JOB,
      payload: '{}',
      runAt: nextBackupRunAt(config, now()),
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now(),
    }
    await deps.repo.insertJob(job)
  }

  return {
    list,
    run,
    reschedule,
    /** Called by the scheduler when a backup job fires: back up, then queue next. */
    async runScheduled(): Promise<void> {
      await run()
      await reschedule()
    },
    async remove(name: string): Promise<void> {
      assertSafe(name)
      await unlink(pathFor(name)).catch(() => {})
      if (deps.isS3()) await deps.blobs.delete(`${S3_PREFIX}${name}`).catch(() => {})
    },
    /**
     * Put a backup fetched from elsewhere (an offsite copy) into the local
     * folder under its own name, so it lists and restores like any other.
     */
    async adopt(name: string, data: Uint8Array): Promise<BackupInfo> {
      assertSafe(name)
      mkdirSync(deps.backupsDir, { recursive: true })
      await writeFile(pathFor(name), data)
      // list it under when it was made, not when it was fetched
      const made = createdFromName(name)
      if (made) await utimes(pathFor(name), made, made)
      const st = statSync(pathFor(name))
      return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() }
    },
    /** Absolute path for a download stream, or null if the file is gone. */
    resolve(name: string): string | null {
      assertSafe(name)
      const p = pathFor(name)
      return existsSync(p) ? p : null
    },
  }
}

export type BackupService = ReturnType<typeof createBackupService>
