import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'

/**
 * The deliberately tiny storage seam from TECH-PLAN. Keys are content hashes
 * (plus derived suffixes like `<hash>.t` for thumbnails). Fully async because
 * the S3-compatible driver (blobstore-s3.ts) cannot answer `exists` or open a
 * stream without a round-trip; the fs driver just wraps its sync answers.
 */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>
  getStream(key: string): Promise<Readable>
  read(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
}

export function createFsBlobStore(root: string): BlobStore {
  mkdirSync(root, { recursive: true })
  // two-level fanout so a big library doesn't put 100k files in one dir
  const pathFor = (key: string) => join(root, key.slice(0, 2), key)

  return {
    async put(key, data) {
      const path = pathFor(key)
      if (existsSync(path)) return // content-addressed: same key, same bytes
      mkdirSync(dirname(path), { recursive: true })
      await writeFile(path, data)
    },
    async getStream(key) {
      return createReadStream(pathFor(key))
    },
    read(key) {
      return readFile(pathFor(key))
    },
    async exists(key) {
      return existsSync(pathFor(key))
    },
    async delete(key) {
      try {
        await unlink(pathFor(key))
      } catch {
        // already gone
      }
    },
  }
}
