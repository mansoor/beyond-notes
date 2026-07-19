import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { beforeAll, describe, expect, it } from 'vitest'
import { type BlobStore, createFsBlobStore } from './blobstore'
import { createS3BlobStore } from './blobstore-s3'
import { loadConfig } from './config'

// One contract, every driver. The fs driver always runs; the S3 driver runs
// when TEST_S3_ENDPOINT is set (CI starts a MinIO container).
const drivers: Array<{ name: string; make: () => BlobStore }> = [
  {
    name: 'fs',
    make: () => createFsBlobStore(mkdtempSync(join(tmpdir(), 'bn-blob-'))),
  },
]

if (process.env.TEST_S3_ENDPOINT) {
  const s3Config = loadConfig({
    S3_ENDPOINT: process.env.TEST_S3_ENDPOINT,
    S3_BUCKET: process.env.TEST_S3_BUCKET ?? 'bn-test',
    S3_ACCESS_KEY: process.env.TEST_S3_ACCESS_KEY ?? 'minioadmin',
    S3_SECRET_KEY: process.env.TEST_S3_SECRET_KEY ?? 'minioadmin',
  })

  beforeAll(async () => {
    const client = new S3Client({
      region: s3Config.S3_REGION,
      endpoint: s3Config.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: s3Config.S3_ACCESS_KEY,
        secretAccessKey: s3Config.S3_SECRET_KEY,
      },
    })
    try {
      await client.send(new CreateBucketCommand({ Bucket: s3Config.S3_BUCKET }))
    } catch (err) {
      const name = (err as { name?: string }).name ?? ''
      if (!name.startsWith('BucketAlready')) throw err
    }
  })

  drivers.push({ name: 's3', make: () => createS3BlobStore(s3Config) })
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

for (const driver of drivers) {
  describe(`blob store contract (${driver.name})`, () => {
    it('put/read/exists/delete round-trip', async () => {
      const store = driver.make()
      const key = `cafe${Date.now().toString(16)}${driver.name}a`
      const data = Buffer.from('hello blob world')

      expect(await store.exists(key)).toBe(false)
      await store.put(key, data)
      expect(await store.exists(key)).toBe(true)
      expect((await store.read(key)).equals(data)).toBe(true)

      await store.delete(key)
      expect(await store.exists(key)).toBe(false)
      // delete is idempotent
      await store.delete(key)
    })

    it('getStream yields the stored bytes', async () => {
      const store = driver.make()
      const key = `beef${Date.now().toString(16)}${driver.name}b`
      const data = Buffer.from([0, 1, 2, 250, 251, 252]) // binary-safe
      await store.put(key, data)
      const streamed = await streamToBuffer(await store.getStream(key))
      expect(streamed.equals(data)).toBe(true)
      await store.delete(key)
    })

    it('derived thumb keys live independently of the main key', async () => {
      const store = driver.make()
      const key = `f00d${Date.now().toString(16)}${driver.name}c`
      await store.put(key, Buffer.from('original'))
      expect(await store.exists(`${key}.t`)).toBe(false)
      await store.put(`${key}.t`, Buffer.from('thumb'))
      expect((await store.read(`${key}.t`)).toString()).toBe('thumb')
      await store.delete(key)
      await store.delete(`${key}.t`)
    })
  })
}
