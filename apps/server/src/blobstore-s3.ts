import type { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { BlobStore } from './blobstore'
import type { Config } from './config'

export function s3Configured(config: Config): boolean {
  return Boolean(config.S3_BUCKET)
}

/**
 * S3-compatible driver: MinIO, AWS S3, Wasabi, R2, B2 — endpoint + bucket +
 * keys via env. Path-style is the default because MinIO (and most self-hosted
 * gateways) require it; AWS accepts it too. No presigned URLs anywhere: all
 * access stays proxied through the app so the visibility boundary holds
 * (TECH-PLAN, files section).
 */
export function createS3BlobStore(config: Config): BlobStore {
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT || undefined,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  })
  const Bucket = config.S3_BUCKET
  // same two-level fanout as the fs driver, so keys list sanely in a browser
  const keyFor = (key: string) => `${key.slice(0, 2)}/${key}`

  return {
    async put(key, data) {
      await client.send(new PutObjectCommand({ Bucket, Key: keyFor(key), Body: data }))
    },
    async getStream(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: keyFor(key) }))
      return res.Body as Readable
    },
    async read(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: keyFor(key) }))
      const bytes = await res.Body?.transformToByteArray()
      if (!bytes) throw new Error(`empty S3 response for ${key}`)
      return Buffer.from(bytes)
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: keyFor(key) }))
        return true
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFound') return false
        throw err
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: keyFor(key) }))
    },
  }
}
