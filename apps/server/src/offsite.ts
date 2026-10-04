import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
/**
 * Offsite backup copies: every backup, encrypted on this server, then uploaded
 * to an S3-compatible bucket somewhere else (Backblaze B2, Wasabi, R2, a NAS at
 * a friend's house, or a hosted add-on).
 *
 * Encryption is age (https://age-encryption.org) with a passphrase, so the
 * bucket's owner can't read the copies and anyone can decrypt one with the
 * standard tool: `age -d backup.zip.age > backup.zip`. That matters because a
 * backup holds the instance's decrypted settings secrets.
 *
 * The local backups folder stays the source of truth. Offsite copies follow
 * its retention, and "fetch" brings one back into that folder, where the
 * normal restore takes over. That is the disaster-recovery path: a new server,
 * the same bucket and passphrase, fetch, restore.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { OffsiteSettings } from '@bn/schema'
import { Decrypter, Encrypter, type Identity, type Recipient, Stanza } from 'age-encryption'

export const OFFSITE_SUFFIX = '.age'
export const MIN_PASSPHRASE = 12
// matches backup.ts's names, so a fetched copy can only land as a backup file
const NAME_RE = /^beyond-notes-backup-[0-9TZ-]+\.zip$/

/** The few bucket operations offsite needs; the S3 SDK in production, a map in tests. */
export type Bucket = {
  put(key: string, data: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<Array<{ key: string; size: number; modified: Date }>>
}

export type OffsiteCopy = { name: string; sizeBytes: number; createdAt: string }
export type OffsiteResult = { at: string; name: string; ok: boolean; error: string | null }

export class OffsiteError extends Error {}

export function s3Bucket(cfg: OffsiteSettings): Bucket {
  const client = new S3Client({
    region: cfg.region || 'us-east-1',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  })
  const Bucket = cfg.bucket
  return {
    async put(key, data) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: data }))
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }))
      if (!res.Body) throw new Error('empty response')
      return await res.Body.transformToByteArray()
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },
    async list(prefix) {
      const out: Array<{ key: string; size: number; modified: Date }> = []
      let token: string | undefined
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        )
        for (const o of res.Contents ?? []) {
          if (o.Key)
            out.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified ?? new Date(0) })
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined
      } while (token)
      return out
    },
  }
}

/** "backups/" style: no leading slash, exactly one trailing slash (or empty). */
export function normalizePrefix(prefix: string): string {
  const p = prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return p ? `${p}/` : ''
}

/*
 * age's passphrase mode, with the scrypt step done by Node's native scrypt.
 * The library's own is pure JavaScript: ~2.5 s per backup that blocks every
 * other request. This runs on libuv's thread pool and writes the identical
 * stanza (spec: age-encryption.org/v1, "scrypt recipient stanza"), so the
 * files stay standard age either way.
 */
const SCRYPT_LABEL = 'age-encryption.org/v1/scrypt'
const AGE_DEFAULT_LOGN = 18
const b64NoPad = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/=+$/, '')

function deriveKey(passphrase: string, salt: Uint8Array, logN: number): Promise<Buffer> {
  const N = 2 ** logN
  return new Promise((resolve, reject) =>
    scrypt(
      passphrase,
      Buffer.concat([Buffer.from(SCRYPT_LABEL), salt]),
      32,
      // scrypt needs 128 * N * r bytes; leave headroom over Node's 32 MiB default
      { N, r: 8, p: 1, maxmem: 256 * N * 8 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  )
}

function chacha(key: Buffer) {
  const nonce = Buffer.alloc(12) // age: the file key is wrapped once per derived key
  return {
    seal(plain: Uint8Array): Uint8Array {
      const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
      return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()])
    },
    open(sealed: Uint8Array): Uint8Array | null {
      try {
        const d = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
        d.setAuthTag(sealed.subarray(sealed.length - 16))
        return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()])
      } catch {
        return null
      }
    },
  }
}

export function scryptRecipient(passphrase: string, logN = AGE_DEFAULT_LOGN): Recipient {
  return {
    async wrapFileKey(fileKey) {
      const salt = randomBytes(16)
      const key = await deriveKey(passphrase, salt, logN)
      return [new Stanza(['scrypt', b64NoPad(salt), String(logN)], chacha(key).seal(fileKey))]
    },
  }
}

export function scryptIdentity(passphrase: string): Identity {
  return {
    async unwrapFileKey(stanzas) {
      for (const s of stanzas) {
        if (s.args[0] !== 'scrypt') continue
        // the same checks as the reference implementation
        if (stanzas.length !== 1)
          throw new Error('scrypt recipient is not the only one in the header')
        const [, saltB64 = '', logNStr = ''] = s.args
        if (s.args.length !== 3 || !/^[1-9][0-9]*$/.test(logNStr))
          throw new Error('invalid scrypt stanza')
        const salt = Buffer.from(saltB64, 'base64')
        if (salt.length !== 16 || b64NoPad(salt) !== saltB64)
          throw new Error('invalid scrypt stanza')
        const logN = Number(logNStr)
        if (logN > 20) throw new Error('scrypt work factor is too high')
        if (s.body.length !== 32) throw new Error('invalid stanza')
        const fileKey = chacha(await deriveKey(passphrase, salt, logN)).open(s.body)
        if (fileKey) return fileKey
      }
      return null
    },
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function createOffsiteService(deps: {
  /** the saved settings, or null when never configured */
  getConfig: () => OffsiteSettings | null
  bucketFor?: (cfg: OffsiteSettings) => Bucket
  /** age's scrypt work factor; tests lower it, production keeps age's default */
  scryptLogN?: number
  now?: () => Date
  log?: (msg: string) => void
}) {
  const bucketFor = deps.bucketFor ?? s3Bucket
  const now = deps.now ?? (() => new Date())
  let last: OffsiteResult | null = null

  function active(): OffsiteSettings | null {
    const cfg = deps.getConfig()
    return cfg?.enabled && cfg.bucket && cfg.passphrase ? cfg : null
  }

  async function encrypt(cfg: OffsiteSettings, data: Uint8Array): Promise<Uint8Array> {
    const e = new Encrypter()
    e.addRecipient(scryptRecipient(cfg.passphrase, deps.scryptLogN ?? AGE_DEFAULT_LOGN))
    return await e.encrypt(data)
  }

  async function decrypt(cfg: OffsiteSettings, data: Uint8Array): Promise<Uint8Array> {
    const d = new Decrypter()
    d.addIdentity(scryptIdentity(cfg.passphrase))
    try {
      return await d.decrypt(data)
    } catch {
      throw new OffsiteError(
        "This copy can't be decrypted with the saved passphrase. It may have been made with a different one.",
      )
    }
  }

  const keyOf = (cfg: OffsiteSettings, name: string) =>
    `${normalizePrefix(cfg.prefix)}${name}${OFFSITE_SUFFIX}`

  function requireActive(): OffsiteSettings {
    const cfg = active()
    if (!cfg) throw new OffsiteError('Offsite copies are not set up.')
    return cfg
  }

  return {
    enabled: () => active() !== null,
    lastResult: () => last,

    /**
     * Encrypt and upload one backup. Never throws: an offsite failure must not
     * fail the backup itself, which is already safe on local disk.
     */
    async upload(name: string, data: Uint8Array): Promise<OffsiteResult | null> {
      const cfg = active()
      if (!cfg) return null
      try {
        await bucketFor(cfg).put(keyOf(cfg, name), await encrypt(cfg, data))
        last = { at: now().toISOString(), name, ok: true, error: null }
      } catch (err) {
        last = { at: now().toISOString(), name, ok: false, error: message(err) }
        deps.log?.(`offsite copy of ${name} failed: ${message(err)}`)
      }
      return last
    },

    /**
     * Keep the newest `keep` copies in the bucket and delete older ones. Works
     * from the bucket's own listing, so copies whose local backup was deleted
     * by hand still rotate out. Only backup-named objects in this folder are
     * ever touched.
     */
    async prune(keep: number): Promise<void> {
      const cfg = active()
      if (!cfg) return
      let copies: OffsiteCopy[]
      try {
        copies = await this.list()
      } catch (err) {
        deps.log?.(`offsite cleanup skipped: ${message(err)}`)
        return
      }
      const bucket = bucketFor(cfg)
      for (const c of copies.slice(keep)) {
        await bucket.delete(keyOf(cfg, c.name)).catch(() => {})
      }
    },

    async list(): Promise<OffsiteCopy[]> {
      const cfg = requireActive()
      const prefix = normalizePrefix(cfg.prefix)
      let objects: Awaited<ReturnType<Bucket['list']>>
      try {
        objects = await bucketFor(cfg).list(prefix)
      } catch (err) {
        throw new OffsiteError(`Could not list the bucket: ${message(err)}`)
      }
      return objects
        .map((o) => ({ ...o, name: o.key.slice(prefix.length, -OFFSITE_SUFFIX.length) }))
        .filter((o) => o.key.endsWith(OFFSITE_SUFFIX) && NAME_RE.test(o.name))
        .map((o) => ({ name: o.name, sizeBytes: o.size, createdAt: o.modified.toISOString() }))
        .sort((a, b) => b.name.localeCompare(a.name))
    },

    /** Download and decrypt one copy; the caller stores it as a local backup. */
    async fetch(name: string): Promise<Uint8Array> {
      if (!NAME_RE.test(name)) throw new OffsiteError('Not a backup name.')
      const cfg = requireActive()
      let data: Uint8Array
      try {
        data = await bucketFor(cfg).get(keyOf(cfg, name))
      } catch (err) {
        throw new OffsiteError(`Could not download ${name}: ${message(err)}`)
      }
      return await decrypt(cfg, data)
    },

    /**
     * Before saving settings: can we write, read back, decrypt and delete?
     * Uses the settings being saved, not the stored ones.
     */
    async check(cfg: OffsiteSettings): Promise<void> {
      const bucket = bucketFor(cfg)
      const key = `${normalizePrefix(cfg.prefix)}.beyond-notes-check-${now().getTime().toString(36)}`
      const probe = new TextEncoder().encode('beyond-notes offsite check')
      try {
        await bucket.put(key, await encrypt(cfg, probe))
        const back = await decrypt(cfg, await bucket.get(key))
        await bucket.delete(key)
        if (new TextDecoder().decode(back) !== 'beyond-notes offsite check') {
          throw new Error('the copy read back did not match')
        }
      } catch (err) {
        throw new OffsiteError(`Offsite check failed: ${message(err)}`)
      }
    },
  }
}

export type OffsiteService = ReturnType<typeof createOffsiteService>
