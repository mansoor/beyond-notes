import type { StorageDriver } from '@bn/schema'
import { type BlobStore, createFsBlobStore } from './blobstore'
import { createDbBlobStore } from './blobstore-db'
import { type S3Config, createS3BlobStore } from './blobstore-s3'
import type { Config } from './config'
import type { Repo } from './repo'
import type { SettingsService } from './settings'

/**
 * The store the app actually uses. Which driver is *active* resolves through
 * the settings service on every call, so switching storage in the admin UI
 * applies immediately. Writes go to the active driver only; reads fall back
 * across every driver — after a switch, old blobs stay readable where they
 * already live (keys are content-addressed and unique), and `cli
 * blobs:migrate` consolidates when you want one home for everything.
 */
export function createDynamicBlobStore(
  settings: SettingsService,
  config: Config,
  repo: Repo,
): BlobStore & { activeDriver(): StorageDriver } {
  const fs = createFsBlobStore(config.UPLOADS_DIR)
  const db = createDbBlobStore(repo)
  let s3Cache: { key: string; store: BlobStore } | null = null

  function s3Store(): BlobStore | null {
    const s = settings.effectiveStorage()
    if (!s.s3Bucket) return null
    const cfg: S3Config = {
      bucket: s.s3Bucket,
      endpoint: s.s3Endpoint,
      region: s.s3Region,
      accessKey: s.s3AccessKey,
      secretKey: s.s3SecretKey,
      forcePathStyle: s.s3ForcePathStyle,
    }
    const key = JSON.stringify(cfg)
    if (s3Cache?.key !== key) s3Cache = { key, store: createS3BlobStore(cfg) }
    return s3Cache.store
  }

  function active(): BlobStore {
    const driver = settings.effectiveStorage().driver
    if (driver === 'db') return db
    if (driver === 's3') return s3Store() ?? fs // misconfigured s3 falls back to fs
    return fs
  }

  /** Active driver first, then the others — read path only. */
  function chain(): BlobStore[] {
    const first = active()
    const s3 = s3Store()
    const all = [first, fs, db, ...(s3 ? [s3] : [])]
    return all.filter((store, i) => all.indexOf(store) === i)
  }

  return {
    activeDriver() {
      return settings.effectiveStorage().driver
    },
    async put(key, data) {
      await active().put(key, data)
    },
    async getStream(key) {
      for (const store of chain()) {
        if (await store.exists(key)) return store.getStream(key)
      }
      throw new Error(`blob not found in any store: ${key}`)
    },
    async read(key) {
      for (const store of chain()) {
        if (await store.exists(key)) return store.read(key)
      }
      throw new Error(`blob not found in any store: ${key}`)
    },
    async exists(key) {
      for (const store of chain()) {
        if (await store.exists(key)) return true
      }
      return false
    },
    async delete(key) {
      for (const store of chain()) {
        try {
          await store.delete(key)
        } catch {
          // best-effort per store; content-addressed keys make retries safe
        }
      }
    },
  }
}
