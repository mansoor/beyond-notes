/**
 * Passkeys (WebAuthn): sign in with Face ID, Windows Hello, a phone or a
 * security key instead of a password.
 *
 * Passkeys are registered as discoverable credentials with user verification
 * required, so one tap proves both "something you have" and "something you
 * are / know". That is why a passkey sign-in skips the TOTP step.
 *
 * Challenges live in memory for a few minutes (single process by design). The
 * relying party is BASE_URL's hostname, so passkeys only work when the app is
 * reached at that address, over https (or http://localhost while developing);
 * browsers refuse WebAuthn on a bare IP address.
 */
import { isIP } from 'node:net'
import {
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthService } from './auth'
import type { Repo, UserRow } from './repo'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export class PasskeyError extends Error {
  constructor(
    public code: 'UNAVAILABLE' | 'EXPIRED' | 'NOT_FOUND' | 'FAILED' | 'DISABLED',
    message: string,
  ) {
    super(message)
  }
}

/** Where passkeys can work: https, or localhost for development. Never an IP. */
export function passkeyRelyingParty(baseUrl: string): { id: string; origin: string } | null {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return null
  }
  const host = url.hostname
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return null
  if (url.protocol !== 'https:' && host !== 'localhost') return null
  return { id: host, origin: url.origin }
}

export function createPasskeyService(deps: {
  repo: Repo
  auth: AuthService
  baseUrl: string
  /** SSO-only mode applies here too: members can't bypass the identity provider */
  passwordLoginEnabled?: () => boolean
  now?: () => Date
}) {
  const { repo, auth } = deps
  const now = deps.now ?? (() => new Date())
  const rp = passkeyRelyingParty(deps.baseUrl)
  const pending = new Map<
    string,
    { kind: 'register' | 'login'; userId: string | null; at: number }
  >()

  function need() {
    if (!rp) {
      throw new PasskeyError(
        'UNAVAILABLE',
        'Passkeys need the app to be reached over https at its own domain (BASE_URL).',
      )
    }
    return rp
  }

  function remember(challenge: string, kind: 'register' | 'login', userId: string | null) {
    const cutoff = Date.now() - CHALLENGE_TTL_MS
    for (const [c, p] of pending) if (p.at < cutoff) pending.delete(c)
    pending.set(challenge, { kind, userId, at: Date.now() })
  }

  /** One-shot: a challenge is good for exactly one matching ceremony. */
  function take(challenge: string, kind: 'register' | 'login', userId: string | null): boolean {
    const p = pending.get(challenge)
    pending.delete(challenge)
    return Boolean(
      p && p.kind === kind && p.userId === userId && Date.now() - p.at <= CHALLENGE_TTL_MS,
    )
  }

  return {
    available: rp !== null,

    async registrationOptions(user: UserRow) {
      const { id: rpID } = need()
      const existing = await repo.listPasskeysForUser(user.id)
      const options = await generateRegistrationOptions({
        rpName: 'Beyond Notes',
        rpID,
        userName: user.email,
        userDisplayName: user.name,
        userID: new TextEncoder().encode(user.id),
        attestationType: 'none',
        excludeCredentials: existing.map((p) => ({
          id: p.id,
          transports: JSON.parse(p.transports),
        })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      })
      remember(options.challenge, 'register', user.id)
      return options
    },

    async register(user: UserRow, response: RegistrationResponseJSON, name: string) {
      const { id: rpID, origin } = need()
      let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>
      try {
        result = await verifyRegistrationResponse({
          response,
          expectedChallenge: (c) => take(c, 'register', user.id),
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown error'
        throw new PasskeyError('FAILED', `That passkey could not be added (${detail}).`)
      }
      if (!result.verified) throw new PasskeyError('FAILED', 'That passkey could not be verified.')
      const info = result.registrationInfo
      await repo.insertPasskey({
        id: info.credential.id,
        userId: user.id,
        name: name.trim() || 'Passkey',
        publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
        counter: info.credential.counter,
        transports: JSON.stringify(info.credential.transports ?? []),
        backedUp: info.credentialBackedUp,
        createdAt: now(),
        lastUsedAt: null,
      })
      return { id: info.credential.id }
    },

    /** Usernameless: the browser offers whichever passkeys it has for this site. */
    async loginOptions() {
      const { id: rpID } = need()
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
      remember(options.challenge, 'login', null)
      return options
    },

    async login(response: AuthenticationResponseJSON) {
      const { id: rpID, origin } = need()
      const row = await repo.getPasskey(response.id)
      const user = row ? await repo.getUserById(row.userId) : null
      if (!row || !user) {
        throw new PasskeyError('NOT_FOUND', 'That passkey is not registered here.')
      }
      let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
      try {
        result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: (c) => take(c, 'login', null),
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: {
            id: row.id,
            publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64url')),
            counter: row.counter,
            transports: JSON.parse(row.transports),
          },
          requireUserVerification: true,
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown error'
        throw new PasskeyError('FAILED', `Passkey sign-in failed (${detail}).`)
      }
      if (!result.verified) throw new PasskeyError('FAILED', 'Passkey sign-in failed.')
      if (deps.passwordLoginEnabled && !deps.passwordLoginEnabled() && user.role !== 'admin') {
        throw new PasskeyError('DISABLED', 'Sign-in here is single sign-on only.')
      }
      await repo.recordPasskeyUse(row.id, result.authenticationInfo.newCounter, now())
      return { user, session: await auth.sessionFor(user.id) }
    },
  }
}

export type PasskeyService = ReturnType<typeof createPasskeyService>
