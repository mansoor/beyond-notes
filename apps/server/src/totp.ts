// RFC 6238 TOTP, hand-rolled on node:crypto — no deps, fully testable.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function hotp(secretB32: string, counter: number): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secretB32)).update(buf).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0xf
  const code =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0)
  return String(code % 1_000_000).padStart(6, '0')
}

export function totpCode(secretB32: string, atMs: number, stepSeconds = 30): string {
  return hotp(secretB32, Math.floor(atMs / 1000 / stepSeconds))
}

/** Accepts the current step and one step either side (clock drift). */
export function verifyTotp(secretB32: string, code: string, atMs: number): boolean {
  const normalized = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  const step = Math.floor(atMs / 1000 / 30)
  for (const offset of [-1, 0, 1]) {
    const expected = hotp(secretB32, step + offset)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return true
  }
  return false
}

export function otpauthUrl(secretB32: string, email: string, issuer = 'Beyond Notes'): string {
  const enc = encodeURIComponent
  return `otpauth://totp/${enc(issuer)}:${enc(email)}?secret=${secretB32}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex') // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
}
