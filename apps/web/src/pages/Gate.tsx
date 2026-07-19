import { Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import { CenterCard, ErrorNote, Field, SubmitButton, useSubmit } from '../components'
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
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--danger)' }}
      >
        Cannot reach the server: {status.error.message}
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

function LoginPage() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const login = trpc.auth.login.useMutation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [forgot, setForgot] = useState(false)
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

  return (
    <CenterCard title="Beyond Notes" subtitle="Sign in to continue.">
      <form onSubmit={onSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {needsTotp && (
          <Field
            label="Authenticator code (or a recovery code)"
            value={totpCode}
            onChange={setTotpCode}
          />
        )}
        <ErrorNote message={error} />
        <SubmitButton label="Sign in" busy={busy} />
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
    </CenterCard>
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
