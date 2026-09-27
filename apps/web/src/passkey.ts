import { browserSupportsWebAuthn } from '@simplewebauthn/browser'

export { startAuthentication, startRegistration } from '@simplewebauthn/browser'

/** This browser can do WebAuthn at all (the server says whether this address can). */
export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

/** Browsers report a dismissed or timed-out prompt as NotAllowedError; say so plainly. */
export function passkeyErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return 'The passkey prompt was closed or timed out.'
  }
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account.'
  return err instanceof Error ? err.message : 'Something went wrong with the passkey.'
}
