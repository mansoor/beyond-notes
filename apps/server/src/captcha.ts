import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { CaptchaMode } from '@bn/schema'

// Two spam defences for public forms:
//   basic     — a self-hosted arithmetic challenge, stateless and signed. No
//               external calls, so it works on an offline LAN.
//   recaptcha — Google reCAPTCHA v2. Opt-in; it loads Google's script and
//               verifies against Google's API (the one deliberate exception to
//               the no-CDN rule, and only when the operator turns it on).

const TTL_MS = 10 * 60 * 1000

export type MathChallenge = { question: string; token: string }

/** A signed `answer.expiry.hmac` token — no server-side state to keep. */
export function makeMathChallenge(secret: Buffer, now: number): MathChallenge {
  const a = randomInt(1, 10)
  const b = randomInt(1, 10)
  const answer = a + b
  const exp = now + TTL_MS
  const payload = `${answer}.${exp}`
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return { question: `What is ${a} + ${b}?`, token: `${payload}.${sig}` }
}

export function verifyMathChallenge(
  secret: Buffer,
  token: string,
  answer: string,
  now: number,
): boolean {
  const parts = String(token).split('.')
  if (parts.length !== 3) return false
  const [ans, exp, sig] = parts as [string, string, string]
  const expected = createHmac('sha256', secret).update(`${ans}.${exp}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  if (!Number.isFinite(Number(exp)) || Number(exp) < now) return false
  return String(answer).trim() === ans
}

/** Verify a reCAPTCHA response with Google. Any failure (network, bad token) is
 *  a non-pass — fail closed. */
export async function verifyRecaptcha(
  secret: string,
  response: string,
  remoteip?: string,
): Promise<boolean> {
  if (!secret || !response) return false
  const body = new URLSearchParams({ secret, response })
  if (remoteip) body.set('remoteip', remoteip)
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      body,
    })
    const json = (await res.json()) as { success?: boolean }
    return json.success === true
  } catch {
    return false
  }
}

/** The mode a form actually runs: `recaptcha` degrades to `basic` when no keys
 *  are configured, so choosing reCAPTCHA never silently drops protection. */
export function effectiveCaptchaMode(mode: CaptchaMode, hasRecaptchaKeys: boolean): CaptchaMode {
  if (mode === 'recaptcha') return hasRecaptchaKeys ? 'recaptcha' : 'basic'
  return mode
}
