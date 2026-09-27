import { Outlet } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { CenterCard, ErrorNote, Field, PageIcon, SubmitButton, useSubmit } from '../components'
import { passkeyErrorMessage, passkeysSupported, startAuthentication } from '../passkey'
import { trpc } from '../trpc'
import { Shell } from './Shell'

export function Gate() {
  const status = trpc.auth.status.useQuery()

  if (status.isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--text-3)' }}
      >
        Loading…
      </div>
    )
  }
  if (status.error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p style={{ color: 'var(--text-2)' }}>Couldn’t reach the server.</p>
        <button
          type="button"
          onClick={() => status.refetch()}
          disabled={status.isFetching}
          className="rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--accent)' }}
        >
          {status.isFetching ? 'Trying…' : 'Try again'}
        </button>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {status.error.message}
        </p>
      </div>
    )
  }
  if (status.data?.me) {
    return (
      <Shell me={status.data.me}>
        <Outlet />
      </Shell>
    )
  }
  if (status.data?.needsSetup) return <SetupPage />
  return <LoginPage />
}

function SetupPage() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const sso = status.data?.sso ?? null
  const [ssoError] = useState(takeSsoError)
  const setup = trpc.auth.setup.useMutation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, onSubmit } = useSubmit(async () => {
    await setup.mutateAsync({ name, email, password })
    await utils.auth.status.invalidate()
  })

  return (
    <CenterCard
      title="Welcome to Beyond Notes"
      subtitle="Claim this instance: the first account becomes the admin."
    >
      {sso && (
        <>
          {/* single sign-on is configured already (env): the first person
              through it becomes the admin, no password needed */}
          <a
            href={ssoHref()}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            <PageIcon icon="key" className="text-[18px]" />
            Continue with {sso.label}
          </a>
          <ErrorNote message={ssoError} />
          <div className="flex items-center gap-3 my-5 text-xs" style={{ color: 'var(--text-3)' }}>
            <span className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
            or create a password account
            <span className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
          </div>
        </>
      )}
      <form onSubmit={onSubmit}>
        <Field label="Your name" value={name} onChange={setName} autoFocus />
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field
          label="Password (10+ characters)"
          type="password"
          value={password}
          onChange={setPassword}
        />
        <ErrorNote message={error} />
        <SubmitButton label="Create admin account" busy={busy} />
      </form>
    </CenterCard>
  )
}

/** Start single sign-on, coming back to wherever the person was headed. */
function ssoHref(): string {
  const next = `${window.location.pathname}${window.location.search.replace(/[?&]sso_error=[^&]*/, '')}`
  return `/auth/oidc/login?next=${encodeURIComponent(next || '/')}`
}

/** The callback reports failures as ?sso_error=…; read it once, then tidy the URL. */
function takeSsoError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const message = params.get('sso_error')
  if (message === null) return null
  params.delete('sso_error')
  const rest = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`)
  return message
}

function LoginPage() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const login = trpc.auth.login.useMutation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [ssoError] = useState(takeSsoError)
  // ?local shows the password form even in SSO-only mode: the admins' way in
  // when the identity provider is down
  const [local, setLocal] = useState(() => new URLSearchParams(window.location.search).has('local'))
  const sso = status.data?.sso ?? null
  const showPassword = !sso || sso.passwordLogin || local

  // straight to the provider, unless it just sent us back with an error
  const redirecting = Boolean(sso?.autoRedirect && !ssoError && !local)
  useEffect(() => {
    if (redirecting) window.location.assign(ssoHref())
  }, [redirecting])
  const { busy, error, onSubmit } = useSubmit(async () => {
    try {
      await login.mutateAsync({ email, password, totpCode: totpCode || undefined })
      await utils.auth.status.invalidate()
    } catch (err) {
      // the password was right; the account wants a second factor
      if (err instanceof Error && err.message.includes('authenticator code')) setNeedsTotp(true)
      throw err
    }
  })

  if (forgot) {
    return <ForgotPasswordPage initialEmail={email} onBack={() => setForgot(false)} />
  }

  if (redirecting) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--text-3)' }}
      >
        Redirecting to {sso?.label}…
      </div>
    )
  }

  return (
    <CenterCard title="Beyond Notes" subtitle="Sign in to continue.">
      {sso && (
        <>
          <a
            href={ssoHref()}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            <PageIcon icon="key" className="text-[18px]" />
            Continue with {sso.label}
          </a>
          {ssoError && !showPassword && (
            <p className="text-sm mt-3" style={{ color: 'var(--danger)' }}>
              {ssoError}
            </p>
          )}
          {showPassword && (
            <div
              className="flex items-center gap-3 my-5 text-xs"
              style={{ color: 'var(--text-3)' }}
            >
              <span className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
              or use your password
              <span className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
            </div>
          )}
        </>
      )}
      {showPassword ? (
        <form onSubmit={onSubmit}>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus={!sso} />
          <Field label="Password" type="password" value={password} onChange={setPassword} />
          {needsTotp && (
            <Field
              label="Authenticator code (or a recovery code)"
              value={totpCode}
              onChange={setTotpCode}
            />
          )}
          <ErrorNote message={error ?? ssoError} />
          <SubmitButton label="Sign in" busy={busy} />
          {status.data?.passkeys && passkeysSupported() && <PasskeySignIn />}
          {status.data?.mailConfigured && (
            <p className="text-sm mt-4 text-center">
              <button
                type="button"
                className="underline"
                style={{ color: 'var(--text-2)' }}
                onClick={() => setForgot(true)}
              >
                Forgot password?
              </button>
            </p>
          )}
        </form>
      ) : (
        <p className="text-xs mt-5 text-center">
          <button
            type="button"
            className="underline"
            style={{ color: 'var(--text-3)' }}
            onClick={() => setLocal(true)}
          >
            Admin sign-in with a password
          </button>
        </p>
      )}
    </CenterCard>
  )
}

/** Usernameless: the browser offers whichever passkey it holds for this site. */
function PasskeySignIn() {
  const utils = trpc.useUtils()
  const options = trpc.auth.passkeyOptions.useMutation()
  const login = trpc.auth.passkeyLogin.useMutation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const optionsJSON = await options.mutateAsync()
      const response = await startAuthentication({ optionsJSON })
      await login.mutateAsync({ response: response as unknown as Record<string, unknown> })
      await utils.auth.status.invalidate()
    } catch (err) {
      setError(passkeyErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium disabled:opacity-60"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        <PageIcon icon="passkey" className="text-[18px]" />
        {busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </button>
      {error && (
        <p className="text-sm mt-2" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </>
  )
}

function ForgotPasswordPage(props: { initialEmail: string; onBack: () => void }) {
  const request = trpc.auth.requestPasswordReset.useMutation()
  const [email, setEmail] = useState(props.initialEmail)
  const [sent, setSent] = useState(false)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await request.mutateAsync({ email })
    setSent(true)
  })

  return (
    <CenterCard title="Reset password" subtitle="We will email you a reset link.">
      {sent ? (
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          If an account exists for <b>{email}</b>, a reset link is on its way. It is valid for one
          hour.
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus />
          <ErrorNote message={error} />
          <SubmitButton label="Send reset link" busy={busy} />
        </form>
      )}
      <p className="text-sm mt-4 text-center">
        <button
          type="button"
          className="underline"
          style={{ color: 'var(--text-2)' }}
          onClick={props.onBack}
        >
          Back to sign in
        </button>
      </p>
    </CenterCard>
  )
}
