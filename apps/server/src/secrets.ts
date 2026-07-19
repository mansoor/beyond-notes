import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Encryption at rest for secrets stored in the settings table (SMTP password,
// S3 secret key). AES-256-GCM, one random IV per value. The point is that a
// DATABASE backup (pg_dump, a copied SQLite file) no longer contains usable
// credentials: the key lives outside the database — in SECRETS_KEY (env) or
// an auto-generated keyfile next to the data.

const PREFIX = 'enc:v1:'

export function loadOrCreateSecretsKey(config: {
  SECRETS_KEY: string
  SECRETS_KEY_FILE: string
}): Buffer {
  if (config.SECRETS_KEY) {
    const key = Buffer.from(config.SECRETS_KEY, 'hex')
    if (key.length !== 32) {
      throw new Error(
        "SECRETS_KEY must be 64 hex characters (32 bytes). Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      )
    }
    return key
  }
  const file = config.SECRETS_KEY_FILE
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex')
    if (key.length !== 32) {
      throw new Error(`${file} exists but does not contain a valid 32-byte hex key`)
    }
    return key
  }
  const key = randomBytes(32)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${key.toString('hex')}\n`)
  return key
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function encryptSecret(key: Buffer, plain: string): string {
  if (!plain) return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return `${PREFIX}${iv.toString('base64')}:${ct.toString('base64')}`
}

/** Legacy plaintext values pass through untouched — upgrades happen on load. */
export function decryptSecret(key: Buffer, stored: string): string {
  if (!isEncrypted(stored)) return stored
  const [ivB64, ctB64] = stored.slice(PREFIX.length).split(':')
  const iv = Buffer.from(ivB64 ?? '', 'base64')
  const data = Buffer.from(ctB64 ?? '', 'base64')
  const tag = data.subarray(data.length - 16)
  const ct = data.subarray(0, data.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Which fields of which settings group are secrets. One place, used by the
 *  settings service (rest) and export/import (portability across keys). */
export const SECRET_FIELDS: Record<string, string[]> = {
  smtp: ['pass'],
  storage: ['s3SecretKey'],
}

type Group = Record<string, unknown>

export function encryptGroup(key: Buffer | undefined, groupKey: string, value: Group): Group {
  const fields = SECRET_FIELDS[groupKey] ?? []
  if (!key || fields.length === 0) return value
  const out = { ...value }
  for (const field of fields) {
    const v = out[field]
    if (typeof v === 'string' && v) out[field] = encryptSecret(key, v)
  }
  return out
}

export function decryptGroup(
  key: Buffer | undefined,
  groupKey: string,
  value: Group,
): { value: Group; hadPlaintextSecret: boolean } {
  const fields = SECRET_FIELDS[groupKey] ?? []
  if (fields.length === 0) return { value, hadPlaintextSecret: false }
  const out = { ...value }
  let hadPlaintextSecret = false
  for (const field of fields) {
    const v = out[field]
    if (typeof v !== 'string' || !v) continue
    if (isEncrypted(v)) {
      if (key) out[field] = decryptSecret(key, v)
    } else {
      hadPlaintextSecret = true
    }
  }
  return { value: out, hadPlaintextSecret }
}
