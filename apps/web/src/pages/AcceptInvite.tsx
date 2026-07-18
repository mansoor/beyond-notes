import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { CenterCard, ErrorNote, Field, SubmitButton, useSubmit } from '../components'
import { trpc } from '../trpc'

export function AcceptInvitePage() {
  const { token } = useParams({ from: '/invite/$token' })
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const preview = trpc.auth.invitePreview.useQuery({ token })
  const accept = trpc.auth.acceptInvite.useMutation()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const suggestedEmail = preview.data?.valid ? preview.data.suggestedEmail : null
  const { busy, error, onSubmit } = useSubmit(async () => {
    await accept.mutateAsync({ token, name, email: email || suggestedEmail || '', password })
    await utils.auth.status.invalidate()
    navigate({ to: '/' })
  })

  if (preview.isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--text-3)' }}
      >
        Checking invite…
      </div>
    )
  }
  if (!preview.data?.valid) {
    return (
      <CenterCard title="Invite not valid" subtitle="This link was used, revoked, or has expired.">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          Ask the person who runs this instance for a fresh invite link.
        </p>
      </CenterCard>
    )
  }

  return (
    <CenterCard
      title="Join Beyond Notes"
      subtitle="Set up your account. You choose your own password."
    >
      <form onSubmit={onSubmit}>
        <Field label="Your name" value={name} onChange={setName} autoFocus />
        <Field
          label="Email"
          type="email"
          value={email || suggestedEmail || ''}
          onChange={setEmail}
        />
        <Field
          label="Password (10+ characters)"
          type="password"
          value={password}
          onChange={setPassword}
        />
        <ErrorNote message={error} />
        <SubmitButton label="Create account" busy={busy} />
      </form>
    </CenterCard>
  )
}
