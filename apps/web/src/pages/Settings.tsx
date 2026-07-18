import { useState } from 'react'
import { ErrorNote, Field, SubmitButton, useSubmit } from '../components'
import { trpc } from '../trpc'

const TABS = ['Account', 'Security', 'Notifications', 'Users'] as const
type Tab = (typeof TABS)[number]

export function SettingsPage() {
  const status = trpc.auth.status.useQuery()
  const isAdmin = status.data?.me?.role === 'admin'
  const [tab, setTab] = useState<Tab>('Account')
  const tabs = TABS.filter((t) => t !== 'Users' || isAdmin)

  return (
    <div className="max-w-2xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <div className="flex gap-1 border-b mb-6" style={{ borderColor: 'var(--border)' }}>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="px-3 py-1.5 text-sm rounded-t-lg"
            style={{
              color: tab === t ? 'var(--accent)' : 'var(--text-2)',
              background: tab === t ? 'var(--accent-soft)' : undefined,
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Account' && <AccountTab />}
      {tab === 'Security' && <SecurityTab />}
      {tab === 'Notifications' && <NotificationsTab />}
      {tab === 'Users' && isAdmin && <UsersTab />}
    </div>
  )
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border p-5 mb-5"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      <h2 className="font-semibold mb-3">{props.title}</h2>
      {props.children}
    </section>
  )
}

function AccountTab() {
  const status = trpc.auth.status.useQuery()
  const change = trpc.auth.changePassword.useMutation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await change.mutateAsync({ current, next })
    setCurrent('')
    setNext('')
    setDone(true)
  })

  return (
    <>
      <Card title="Profile">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          {status.data?.me?.name} · {status.data?.me?.email} · {status.data?.me?.role}
        </p>
      </Card>
      <Card title="Change password">
        <form onSubmit={onSubmit}>
          <Field label="Current password" type="password" value={current} onChange={setCurrent} />
          <Field
            label="New password (10+ characters)"
            type="password"
            value={next}
            onChange={setNext}
          />
          <ErrorNote message={error} />
          {done && (
            <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
              Password changed.
            </p>
          )}
          <SubmitButton label="Change password" busy={busy} />
        </form>
      </Card>
    </>
  )
}

function SecurityTab() {
  return (
    <>
      <TwoFactorCard />
      <SessionsCard />
    </>
  )
}

function TwoFactorCard() {
  const utils = trpc.useUtils()
  const start = trpc.auth.totpStart.useMutation()
  const confirm = trpc.auth.totpConfirm.useMutation()
  const disable = trpc.auth.totpDisable.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const [enrollment, setEnrollment] = useState<{ secret: string; url: string } | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)

  // 2FA state isn't in AuthStatus; derive lazily: totpStart fails when enabled
  const begin = async () => {
    setError(null)
    try {
      setEnrollment(await start.mutateAsync())
      setEnabled(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('already enabled')) setEnabled(true)
      else setError(message)
    }
  }

  const verify = async () => {
    setError(null)
    try {
      const res = await confirm.mutateAsync({ code })
      setRecovery(res.recoveryCodes)
      setEnrollment(null)
      setEnabled(true)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <Card title="Two-factor authentication (TOTP)">
      {recovery && (
        <div
          className="rounded-lg border p-3 mb-4 text-sm"
          style={{ borderColor: 'var(--live)', background: 'var(--bg)' }}
        >
          <p className="font-semibold mb-2" style={{ color: 'var(--live)' }}>
            2FA enabled. Save these recovery codes now — they are shown once:
          </p>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">
            {recovery.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}
      {enrollment ? (
        <div className="text-sm">
          <p className="mb-2" style={{ color: 'var(--text-2)' }}>
            Add this secret to your authenticator app (or paste the otpauth URL), then enter the
            6-digit code:
          </p>
          <p
            className="font-mono text-xs break-all rounded border p-2 mb-1"
            style={{ borderColor: 'var(--border)' }}
          >
            {enrollment.secret}
          </p>
          <p className="font-mono text-[10px] break-all mb-3" style={{ color: 'var(--text-3)' }}>
            {enrollment.url}
          </p>
          <div className="flex gap-2">
            <input
              className="rounded-lg border px-3 py-1.5 text-sm w-32"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="button"
              onClick={verify}
              disabled={confirm.isPending}
              className="rounded-lg px-3 py-1.5 text-sm text-white"
              style={{ background: 'var(--accent)' }}
            >
              Verify & enable
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={begin}
            disabled={start.isPending}
            className="rounded-lg px-3 py-1.5 text-sm text-white"
            style={{ background: 'var(--accent)' }}
          >
            {enabled === true ? '2FA is enabled' : 'Set up 2FA'}
          </button>
          {enabled === true && (
            <span className="flex items-center gap-2 text-sm">
              <input
                type="password"
                className="rounded-lg border px-3 py-1.5 text-sm w-40"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                placeholder="password to disable"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="underline text-sm"
                style={{ color: 'var(--danger)' }}
                onClick={() => disable.mutate({ password })}
              >
                Disable
              </button>
            </span>
          )}
        </div>
      )}
      <ErrorNote message={error} />
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Locked out? Shell access is the rescue:{' '}
        <code>node dist/cli.js user:reset-password &lt;email&gt; &lt;new-password&gt;</code>
      </p>
    </Card>
  )
}

function SessionsCard() {
  const utils = trpc.useUtils()
  const sessions = trpc.auth.sessions.useQuery()
  const revoke = trpc.auth.revokeSession.useMutation({
    onSuccess: () => utils.auth.sessions.invalidate(),
  })
  return (
    <Card title="Active sessions">
      <ul className="text-sm">
        {sessions.data?.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <span style={{ color: 'var(--text-2)' }}>
              Signed in {new Date(s.createdAt).toLocaleString()}
              {s.current && (
                <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--live)' }}>
                  this device
                </span>
              )}
            </span>
            {!s.current && (
              <button
                type="button"
                className="text-xs underline"
                style={{ color: 'var(--danger)' }}
                onClick={() => revoke.mutate({ sessionId: s.id })}
              >
                revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function NotificationsTab() {
  return (
    <Card title="Channels">
      <p className="text-sm mb-2" style={{ color: 'var(--text-2)' }}>
        Notifications are opt-in and configured on the server (a deployment fact, so it lives in
        env, not here):
      </p>
      <ul className="text-sm list-disc ml-5" style={{ color: 'var(--text-2)' }}>
        <li>
          <b>ntfy</b> — set <code>NTFY_URL</code> and <code>NTFY_TOPIC</code>; reminder and heads-up
          notifications push to your devices.
        </li>
        <li>
          <b>Email (SMTP)</b> — arrives in v0.2 together with the forgot-password flow.
        </li>
      </ul>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Without a channel configured, notifications appear in the server log only.
      </p>
    </Card>
  )
}

function UsersTab() {
  const utils = trpc.useUtils()
  const users = trpc.users.list.useQuery()
  const invites = trpc.users.invites.useQuery()
  const createInvite = trpc.users.createInvite.useMutation({
    onSuccess: () => utils.users.invites.invalidate(),
  })
  const revoke = trpc.users.revokeInvite.useMutation({
    onSuccess: () => utils.users.invites.invalidate(),
  })
  const [lastUrl, setLastUrl] = useState<string | null>(null)

  const makeInvite = async () => {
    const res = await createInvite.mutateAsync({ role: 'member' })
    setLastUrl(`${window.location.origin}/invite/${res.token}`)
  }

  return (
    <Card title="Members & invites">
      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={makeInvite}
          disabled={createInvite.isPending}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          + Invite link
        </button>
      </div>
      {lastUrl && (
        <div
          className="rounded-lg border px-3 py-2 mb-4 text-xs font-mono break-all"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          {lastUrl}
          <div className="mt-1 font-sans" style={{ color: 'var(--text-3)' }}>
            Single use, expires in 7 days. Shown once — copy it now.
          </div>
        </div>
      )}
      <ul className="text-sm mb-5">
        {users.data?.map((u) => (
          <li
            key={u.id}
            className="flex justify-between py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <span>
              {u.name} <span style={{ color: 'var(--text-3)' }}>({u.email})</span>
            </span>
            <span style={{ color: 'var(--text-2)' }}>{u.role}</span>
          </li>
        ))}
      </ul>
      {(invites.data?.length ?? 0) > 0 && (
        <ul className="text-sm">
          {invites.data?.map((i) => (
            <li
              key={i.id}
              className="flex justify-between items-center py-2 border-b last:border-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <span style={{ color: 'var(--text-2)' }}>
                {i.suggestedEmail ?? 'anyone'} · {i.status} · expires{' '}
                {new Date(i.expiresAt).toLocaleDateString()}
              </span>
              {i.status === 'pending' && (
                <button
                  type="button"
                  className="underline text-xs"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => revoke.mutate({ id: i.id })}
                >
                  revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
