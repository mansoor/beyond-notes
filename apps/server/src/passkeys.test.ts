import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDb } from './db'
import { createPasskeyService, passkeyRelyingParty } from './passkeys'
import { createRepo } from './repo'

const BASE = 'https://notes.example.test'
const RP_ID = 'notes.example.test'
const b64u = (b: Uint8Array | string) => Buffer.from(b).toString('base64url')
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest()
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

/**
 * A software authenticator: an ES256 key pair that answers WebAuthn
 * ceremonies the way a phone or security key would ("none" attestation).
 */
function makeAuthenticator(origin = BASE, rpId = RP_ID) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const credId = randomBytes(16)
  let counter = 0
  const flags = { UP: 0x01, UV: 0x04, AT: 0x40 }

  return {
    id: b64u(credId),
    register(challenge: string, opts: { uv?: boolean } = {}): RegistrationResponseJSON {
      const cose = new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ])
      const credLen = Buffer.alloc(2)
      credLen.writeUInt16BE(credId.length)
      const authData = Buffer.concat([
        sha256(rpId),
        Buffer.from([flags.UP | flags.AT | (opts.uv === false ? 0 : flags.UV)]),
        u32(0),
        Buffer.alloc(16), // aaguid
        credLen,
        credId,
        Buffer.from(isoCBOR.encode(cose)),
      ])
      const attestation = new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ])
      const clientData = JSON.stringify({ type: 'webauthn.create', challenge, origin })
      return {
        id: b64u(credId),
        rawId: b64u(credId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientData),
          attestationObject: b64u(isoCBOR.encode(attestation as never)),
          transports: ['internal'],
        },
        clientExtensionResults: {},
      }
    },
    login(challenge: string, opts: { counter?: number } = {}): AuthenticationResponseJSON {
      counter = opts.counter ?? counter + 1
      const authData = Buffer.concat([
        sha256(rpId),
        Buffer.from([flags.UP | flags.UV]),
        u32(counter),
      ])
      const clientData = JSON.stringify({ type: 'webauthn.get', challenge, origin })
      const signature = createSign('SHA256')
        .update(Buffer.concat([authData, sha256(clientData)]))
        .sign(privateKey)
      return {
        id: b64u(credId),
        rawId: b64u(credId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientData),
          authenticatorData: b64u(authData),
          signature: b64u(signature),
        },
        clientExtensionResults: {},
      }
    },
  }
}

async function makeWorld(opts: { passwordLogin?: boolean } = {}) {
  const appDb = createDb('file::memory:')
  await appDb.migrate('./drizzle')
  const repo = createRepo(appDb)
  const auth = createAuthService(repo)
  const passkeys = createPasskeyService({
    repo,
    auth,
    baseUrl: BASE,
    passwordLoginEnabled: () => opts.passwordLogin ?? true,
  })
  const { user } = await auth.setup({
    name: 'Owner',
    email: 'owner@x.dev',
    password: 'longpassword1',
  })
  return { appDb, repo, auth, passkeys, user }
}

describe('passkeys', () => {
  it('registers a passkey, then signs in with it', async () => {
    const { appDb, repo, passkeys, user } = await makeWorld()
    const device = makeAuthenticator()
    const reg = await passkeys.registrationOptions(user)
    expect(reg.rp.id).toBe(RP_ID)
    await passkeys.register(user, device.register(reg.challenge), 'MacBook Touch ID')
    const saved = await repo.listPasskeysForUser(user.id)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.name).toBe('MacBook Touch ID')

    const opts = await passkeys.loginOptions()
    const r = await passkeys.login(device.login(opts.challenge))
    expect(r.user.id).toBe(user.id)
    expect(r.session.token).toMatch(/^[0-9a-f]{64}$/)
    expect((await repo.getPasskey(device.id))?.counter).toBe(1)
    await appDb.close()
  })

  it('rejects a replayed challenge and a signature from a different key', async () => {
    const { appDb, passkeys, user } = await makeWorld()
    const device = makeAuthenticator()
    const reg = await passkeys.registrationOptions(user)
    await passkeys.register(user, device.register(reg.challenge), 'Phone')

    const opts = await passkeys.loginOptions()
    const response = device.login(opts.challenge)
    await passkeys.login(response)
    await expect(passkeys.login(response)).rejects.toMatchObject({ code: 'FAILED' })

    // same credential id, wrong private key: the signature can't verify
    const impostor = makeAuthenticator()
    const opts2 = await passkeys.loginOptions()
    const forged = impostor.login(opts2.challenge)
    forged.id = device.id
    forged.rawId = device.id
    await expect(passkeys.login(forged)).rejects.toMatchObject({ code: 'FAILED' })
    await appDb.close()
  })

  it('refuses a passkey registered for another site', async () => {
    const { appDb, passkeys, user } = await makeWorld()
    const phish = makeAuthenticator('https://evil.test', 'evil.test')
    const reg = await passkeys.registrationOptions(user)
    await expect(passkeys.register(user, phish.register(reg.challenge), 'x')).rejects.toMatchObject(
      {
        code: 'FAILED',
      },
    )
    await appDb.close()
  })

  it('requires user verification (PIN or biometric) when registering', async () => {
    const { appDb, passkeys, user } = await makeWorld()
    const device = makeAuthenticator()
    const reg = await passkeys.registrationOptions(user)
    await expect(
      passkeys.register(user, device.register(reg.challenge, { uv: false }), 'x'),
    ).rejects.toMatchObject({ code: 'FAILED' })
    await appDb.close()
  })

  it('an unknown passkey is refused', async () => {
    const { appDb, passkeys } = await makeWorld()
    const stranger = makeAuthenticator()
    const opts = await passkeys.loginOptions()
    await expect(passkeys.login(stranger.login(opts.challenge))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await appDb.close()
  })

  it('SSO-only mode keeps members from using a passkey instead', async () => {
    const { appDb, auth, passkeys, repo, user } = await makeWorld({ passwordLogin: false })
    const invite = await auth.createInvite(user.id, { role: 'member' })
    const { user: bob } = await auth.acceptInvite({
      token: invite.token,
      name: 'Bob',
      email: 'bob@x.dev',
      password: 'longpassword1',
    })
    const device = makeAuthenticator()
    const reg = await passkeys.registrationOptions(bob)
    await passkeys.register(bob, device.register(reg.challenge), 'Bob phone')
    const opts = await passkeys.loginOptions()
    await expect(passkeys.login(device.login(opts.challenge))).rejects.toMatchObject({
      code: 'DISABLED',
    })
    expect(await repo.listPasskeysForUser(bob.id)).toHaveLength(1)
    await appDb.close()
  })

  it('only offers passkeys where browsers allow them', () => {
    expect(passkeyRelyingParty('https://notes.example.com')).toEqual({
      id: 'notes.example.com',
      origin: 'https://notes.example.com',
    })
    expect(passkeyRelyingParty('http://localhost:3800')?.id).toBe('localhost')
    expect(passkeyRelyingParty('http://127.0.0.1:3800')).toBeNull()
    expect(passkeyRelyingParty('http://notes.lan')).toBeNull()
    expect(passkeyRelyingParty('https://192.168.1.10')).toBeNull()
  })
})
