import { Readable } from 'node:stream'
import type { BlobStore } from './blobstore'
import type { Repo } from './repo'

/**
 * Database blob driver: blobs live in the `blobs` table (bytea / BLOB).
 * The right fit for light-mode deployments — one SQLite file (or one pg_dump)
 * captures everything, no uploads volume to remember in backups. Attachment
 * sizes are already capped and images recompressed at ingest, so rows stay
 * reasonable.
 */
export function createDbBlobStore(repo: Repo, opts: { now?: () => Date } = {}): BlobStore {
  const now = opts.now ?? (() => new Date())
  return {
    async put(key, data) {
      await repo.putBlob(key, data, now())
    },
    async getStream(key) {
      const data = await repo.getBlob(key)
      if (!data) throw new Error(`blob not found: ${key}`)
      return Readable.from(data)
    },
    async read(key) {
      const data = await repo.getBlob(key)
      if (!data) throw new Error(`blob not found: ${key}`)
      return data
    },
    async exists(key) {
      return (await repo.getBlob(key)) !== null
    },
    async delete(key) {
      await repo.deleteBlob(key)
    },
  }
}
