import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { CenterCard, ErrorNote, Field, SubmitButton, useSubmit } from '../components'
import { trpc } from '../trpc'

export function ResetPasswordPage() {
  const { token } = useParams({ from: '/reset/$token' })
  const navigate = useNavigate()
  const reset = trpc.auth.resetPassword.useMutation()
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await reset.mutateAsync({ token, password })
    setDone(true)
  })

  if (done) {
    return (
      <CenterCard title="Password reset" subtitle="All sessions were signed out.">
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          Your new password is active. Sign in with it now.
        </p>
        <button
          type="button"
          onClick={() => navigate({ to: '/' })}
          className="w-full rounded-lg py-2 text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          Go to sign in
        </button>
      </CenterCard>
    )
  }

  return (
    <CenterCard title="Choose a new password" subtitle="This link works once, within one hour.">
      <form onSubmit={onSubmit}>
        <Field
          label="New password (10+ characters)"
          type="password"
          value={password}
          onChange={setPassword}
          autoFocus
        />
        <ErrorNote message={error} />
        <SubmitButton label="Set new password" busy={busy} />
      </form>
    </CenterCard>
  )
}
