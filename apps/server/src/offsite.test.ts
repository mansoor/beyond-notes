import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import type { BackupSettings, OffsiteSettings } from '@bn/schema'
import { Decrypter, Encrypter } from 'age-encryption'
import { describe, expect, it } from 'vitest'
import { createBackupService } from './backup'
import type { BlobStore } from './blobstore'
import { createDb } from './db'
import {
  type Bucket,
  createOffsiteService,
  normalizePrefix,
  s3Bucket,
  scryptIdentity,
  scryptRecipient,
} from './offsite'
import { createRepo } from './repo'

const backupCfg: BackupSettings = {
  enabled: true,
  frequency: 'daily',
  hour: 3,
  retention: 2,
  s3Copy: false,
}

const offsiteCfg = (over: Partial<OffsiteSettings> = {}): OffsiteSettings => ({
  enabled: true,
  endpoint: '',
  region: 'us-east-1',
  bucket: 'offsite',
  prefix: 'home/',
  accessKey: 'k',
  secretKey: 's',
  passphrase: 'correct horse battery staple',
  forcePathStyle: true,
  ...over,
})

function memBucket(): Bucket & { objects: Map<string, Uint8Array>; failPut: boolean } {
  const objects = new Map<string, Uint8Array>()
  const b = {
    objects,
    failPut: false,
    async put(key: string, data: Uint8Array) {
      if (b.failPut) throw new Error('bucket is read-only')
      objects.set(key, data)
    },
    async get(key: string) {
      const v = objects.get(key)
      if (!v) throw new Error('NoSuchKey')
      return v
    },
    async delete(key: string) {
      objects.delete(key)
    },
    async list(prefix: string) {
      return [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, v]) => ({ key, size: v.length, modified: new Date('2026-10-02T03:00:00Z') }))
    },
  }
  return b
}

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

async function setup(config: OffsiteSettings | null = offsiteCfg()) {
  const db = createDb('file::memory:')
  await db.migrate('./drizzle')
  const repo = createRepo(db)
  const bucket = memBucket()
  let current = config
  const offsite = createOffsiteService({
    getConfig: () => current,
    bucketFor: () => bucket,
    scryptLogN: 10, // fast for tests; production uses age's default
  })
  let tick = 0
  const dir = mkdtempSync(join(tmpdir(), 'bn-offsite-'))
  const backup = createBackupService({
    repo,
    blobs: memBlobs(),
    backupsDir: dir,
    getConfig: () => backupCfg,
    isS3: () => false,
    offsite,
    now: () => new Date(2026, 9, 2, 3, 0, tick++),
  })
  const set = (c: OffsiteSettings | null) => {
    current = c
  }
  return { bucket, offsite, backup, dir, set }
}

describe('offsite copies', () => {
  it('encrypts each backup with age before it leaves the server', async () => {
    const { bucket, backup, offsite, dir } = await setup()
    const made = await backup.run()
    const key = `home/${made.name}.age`
    const stored = bucket.objects.get(key)
    expect(stored).toBeDefined()
    // an age file, not a zip: the bucket's owner sees ciphertext only
    expect(
      Buffer.from(stored as Uint8Array)
        .subarray(0, 21)
        .toString(),
    ).toBe('age-encryption.org/v1')
    // and standard age decrypts it back to the exact local backup
    const d = new Decrypter()
    d.addPassphrase('correct horse battery staple')
    const plain = await d.decrypt(stored as Uint8Array)
    expect(Buffer.from(plain).equals(readFileSync(join(dir, made.name)))).toBe(true)
    expect(offsite.lastResult()).toMatchObject({ name: made.name, ok: true })
  })

  it('keeps as many copies as local retention, counted from the bucket', async () => {
    const { bucket, backup } = await setup()
    for (let i = 0; i < 3; i++) await backup.run()
    const local = backup.list().map((b) => `home/${b.name}.age`)
    expect(local).toHaveLength(2)
    expect([...bucket.objects.keys()].sort()).toEqual(local.sort())

    // a local backup deleted by hand keeps its offsite copy until it rotates out,
    // and anything that isn't a backup is never touched
    bucket.objects.set('home/notes.txt', new Uint8Array([1]))
    const oldest = backup.list().at(-1)?.name as string
    await backup.remove(oldest)
    expect(bucket.objects.has(`home/${oldest}.age`)).toBe(true)
    await backup.run()
    await backup.run()
    expect(bucket.objects.has(`home/${oldest}.age`)).toBe(false)
    expect(bucket.objects.has('home/notes.txt')).toBe(true)
    expect([...bucket.objects.keys()].filter((k) => k.endsWith('.age'))).toHaveLength(2)
  })

  it('lists and fetches a copy back into the local backups for restore', async () => {
    const { offsite, backup, dir } = await setup()
    const made = await backup.run()
    const original = readFileSync(join(dir, made.name))
    await backup.remove(made.name) // the local disk died; the offsite copy didn't
    expect(backup.list()).toHaveLength(0)

    const copies = await offsite.list()
    expect(copies.map((c) => c.name)).toEqual([made.name])
    await backup.adopt(made.name, await offsite.fetch(made.name))
    expect(backup.list().map((b) => b.name)).toEqual([made.name])
    // listed under when it was made, not when it was fetched
    const stamp = made.name.replace('beyond-notes-backup-', '').replace('.zip', '')
    expect(backup.list()[0]?.createdAt.replace(/[:.]/g, '-')).toBe(stamp)
    expect(readFileSync(join(dir, made.name)).equals(original)).toBe(true)
  })

  it('ignores stray objects and refuses names that are not backups', async () => {
    const { offsite, bucket } = await setup()
    bucket.objects.set('home/notes.txt', new Uint8Array([1]))
    bucket.objects.set('home/../../etc/passwd.age', new Uint8Array([1]))
    bucket.objects.set(
      'other/beyond-notes-backup-2026-01-01T00-00-00-000Z.zip.age',
      new Uint8Array(),
    )
    expect(await offsite.list()).toEqual([])
    await expect(offsite.fetch('../../etc/passwd')).rejects.toThrow(/Not a backup name/)
  })

  it('says so when the passphrase changed since a copy was made', async () => {
    const { offsite, backup, set } = await setup()
    const made = await backup.run()
    set(offsiteCfg({ passphrase: 'a different passphrase' }))
    await expect(offsite.fetch(made.name)).rejects.toThrow(/can't be decrypted/)
  })

  it('never fails a backup because the bucket did', async () => {
    const { bucket, backup, offsite } = await setup()
    bucket.failPut = true
    const made = await backup.run()
    expect(backup.list().map((b) => b.name)).toContain(made.name)
    expect(offsite.lastResult()).toMatchObject({ ok: false, error: 'bucket is read-only' })
  })

  it('does nothing when switched off or missing a passphrase', async () => {
    const off = await setup(offsiteCfg({ enabled: false }))
    await off.backup.run()
    expect(off.bucket.objects.size).toBe(0)
    const noPass = await setup(offsiteCfg({ passphrase: '' }))
    await noPass.backup.run()
    expect(noPass.bucket.objects.size).toBe(0)
    expect(noPass.offsite.enabled()).toBe(false)
  })

  it('checks a config end to end before it is saved', async () => {
    const { offsite, bucket } = await setup()
    await offsite.check(offsiteCfg())
    expect(bucket.objects.size).toBe(0) // the probe cleans up after itself
    bucket.failPut = true
    await expect(offsite.check(offsiteCfg())).rejects.toThrow(/Offsite check failed/)
  })

  it('writes and reads the same files as the reference age implementation', async () => {
    const pass = 'correct horse battery staple'
    // ours → reference
    const ours = new Encrypter()
    ours.addRecipient(scryptRecipient(pass, 10))
    const a = await ours.encrypt('from native scrypt')
    const ref = new Decrypter()
    ref.addPassphrase(pass)
    expect(await ref.decrypt(a, 'text')).toBe('from native scrypt')
    // reference → ours
    const theirs = new Encrypter()
    theirs.setPassphrase(pass)
    theirs.setScryptWorkFactor(10)
    const b = await theirs.encrypt('from the reference')
    const mine = new Decrypter()
    mine.addIdentity(scryptIdentity(pass))
    expect(await mine.decrypt(b, 'text')).toBe('from the reference')
    // and a wrong passphrase is a refusal, not garbage
    const wrong = new Decrypter()
    wrong.addIdentity(scryptIdentity('not it at all'))
    await expect(wrong.decrypt(b)).rejects.toThrow()
  })

  it('normalizes the folder prefix', () => {
    expect(normalizePrefix('/beyond-notes//')).toBe('beyond-notes/')
    expect(normalizePrefix('  ')).toBe('')
    expect(normalizePrefix('a/b')).toBe('a/b/')
  })
})

// The real S3 client against S3Mock, when CI provides one.
describe.skipIf(!process.env.TEST_S3_ENDPOINT)('offsite copies on S3', () => {
  it('uploads, lists, fetches and deletes through the S3 API', async () => {
    const cfg = offsiteCfg({
      endpoint: process.env.TEST_S3_ENDPOINT ?? '',
      bucket: `${process.env.TEST_S3_BUCKET ?? 'bn-test'}-offsite`,
      accessKey: process.env.TEST_S3_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.TEST_S3_SECRET_KEY ?? 'minioadmin',
      prefix: `run-${Date.now()}/`,
    })
    const client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    })
    try {
      await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }))
    } catch (err) {
      if (!((err as { name?: string }).name ?? '').startsWith('BucketAlready')) throw err
    }
    const offsite = createOffsiteService({
      getConfig: () => cfg,
      bucketFor: s3Bucket,
      scryptLogN: 10,
    })
    await offsite.check(cfg)
    const name = 'beyond-notes-backup-2026-10-02T03-00-00-000Z.zip'
    const result = await offsite.upload(name, new TextEncoder().encode('zip bytes'))
    expect(result).toMatchObject({ ok: true })
    expect((await offsite.list()).map((c) => c.name)).toEqual([name])
    expect(new TextDecoder().decode(await offsite.fetch(name))).toBe('zip bytes')
    await offsite.prune(0)
    expect(await offsite.list()).toEqual([])
  })
})
