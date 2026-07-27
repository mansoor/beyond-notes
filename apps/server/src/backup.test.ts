import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { BackupSettings } from '@bn/schema'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createBackupService, nextBackupRunAt } from './backup'
import type { BlobStore } from './blobstore'
import { createDb } from './db'
import { createRepo } from './repo'

const cfg = (over: Partial<BackupSettings> = {}): BackupSettings => ({
  enabled: true,
  frequency: 'daily',
  hour: 3,
  retention: 4,
  s3Copy: false,
  ...over,
})

function memBlobs(): BlobStore {
  const m = new Map<string, Buffer>()
  return {
    put: async (k, d) => void m.set(k, d),
    read: async (k) => m.get(k) ?? Buffer.alloc(0),
    getStream: async (k) => Readable.from(m.get(k) ?? Buffer.alloc(0)),
    exists: async (k) => m.has(k),
    delete: async (k) => void m.delete(k),
  }
}

describe('nextBackupRunAt', () => {
  it('daily: today if the hour is ahead, else tomorrow', () => {
    const from = new Date('2026-07-26T01:00:00')
    expect(nextBackupRunAt(cfg({ hour: 3 }), from).getHours()).toBe(3)
    expect(nextBackupRunAt(cfg({ hour: 3 }), from).getDate()).toBe(26) // 3am today
    // the slot already passed → tomorrow
    expect(nextBackupRunAt(cfg({ hour: 0 }), from).getDate()).toBe(27)
  })

  it('weekly lands on a Monday', () => {
    const from = new Date('2026-07-26T01:00:00') // a Sunday
    const next = nextBackupRunAt(cfg({ frequency: 'weekly', hour: 3 }), from)
    expect(next.getDay()).toBe(1) // Monday
  })

  it('monthly lands on the 1st', () => {
    const from = new Date('2026-07-26T01:00:00')
    const next = nextBackupRunAt(cfg({ frequency: 'monthly', hour: 3 }), from)
    expect(next.getDate()).toBe(1)
    expect(next.getMonth()).toBe(7) // August (0-based)
  })
})

describe('backup service', () => {
  async function setup(config: BackupSettings) {
    const db = createDb('file::memory:')
    await db.migrate('./drizzle')
    const repo = createRepo(db)
    await createAuthService(repo).setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
    const dir = mkdtempSync(join(tmpdir(), 'bn-backup-'))
    let tick = 0
    const service = createBackupService({
      repo,
      blobs: memBlobs(),
      backupsDir: dir,
      getConfig: () => config,
      isS3: () => false,
      // distinct, increasing timestamps so rapid runs get distinct filenames
      now: () => new Date(2026, 6, 26, 3, 0, tick++),
    })
    return { repo, service, dir }
  }

  it('writes a backup zip and lists it', async () => {
    const { service } = await setup(cfg())
    const info = await service.run()
    expect(info.name).toMatch(/^beyond-notes-backup-.*\.zip$/)
    expect(info.sizeBytes).toBeGreaterThan(0)
    const list = service.list()
    expect(list).toHaveLength(1)
    expect(service.resolve(list[0]?.name ?? '')).not.toBeNull()
  })

  it('prunes to the retention count, newest kept', async () => {
    const { service } = await setup(cfg({ retention: 2 }))
    await service.run()
    await service.run()
    await service.run()
    const list = service.list()
    expect(list).toHaveLength(2)
    // newest-first, so the two most recent survive
    expect(list[0]?.name.localeCompare(list[1]?.name ?? '')).toBeGreaterThan(0)
  })

  it('reschedule inserts one pending backup job when enabled, none when off', async () => {
    const { repo, service } = await setup(cfg({ enabled: true }))
    await service.reschedule()
    let jobs = (await repo.listAllJobs()).filter((j) => j.type === 'backup')
    expect(jobs).toHaveLength(1)

    // flipping to disabled cancels it
    const off = createBackupService({
      repo,
      blobs: memBlobs(),
      backupsDir: mkdtempSync(join(tmpdir(), 'bn-backup-')),
      getConfig: () => cfg({ enabled: false }),
      isS3: () => false,
    })
    await off.reschedule()
    jobs = (await repo.listAllJobs()).filter((j) => j.type === 'backup')
    expect(jobs).toHaveLength(0)
  })

  it('rejects a traversal-y backup name', () => {
    return setup(cfg()).then(({ service }) => {
      expect(() => service.resolve('../../etc/passwd')).toThrow()
    })
  })
})
