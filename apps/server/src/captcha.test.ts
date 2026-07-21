import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { effectiveCaptchaMode, makeMathChallenge, verifyMathChallenge } from './captcha'

const secret = Buffer.from('a'.repeat(64), 'hex')

function answerFor(question: string): string {
  const m = question.match(/What is (\d+) \+ (\d+)/)
  return String(Number(m?.[1]) + Number(m?.[2]))
}

describe('math captcha', () => {
  it('verifies a correct answer to its own challenge', () => {
    const now = 1_000_000
    const ch = makeMathChallenge(secret, now)
    expect(verifyMathChallenge(secret, ch.token, answerFor(ch.question), now)).toBe(true)
  })

  it('rejects a wrong answer, a tampered token, and an expired one', () => {
    const now = 1_000_000
    const ch = makeMathChallenge(secret, now)
    const answer = answerFor(ch.question)
    expect(verifyMathChallenge(secret, ch.token, '999', now)).toBe(false)
    expect(verifyMathChallenge(secret, `${ch.token}x`, answer, now)).toBe(false)
    expect(verifyMathChallenge(secret, ch.token, answer, now + 11 * 60 * 1000)).toBe(false)
    // a different key can't validate it
    expect(verifyMathChallenge(Buffer.alloc(32, 7), ch.token, answer, now)).toBe(false)
  })
})

describe('effectiveCaptchaMode', () => {
  it('degrades reCAPTCHA to basic without keys, keeps the rest', () => {
    expect(effectiveCaptchaMode('recaptcha', false)).toBe('basic')
    expect(effectiveCaptchaMode('recaptcha', true)).toBe('recaptcha')
    expect(effectiveCaptchaMode('basic', true)).toBe('basic')
    expect(effectiveCaptchaMode('none', true)).toBe('none')
  })
})
