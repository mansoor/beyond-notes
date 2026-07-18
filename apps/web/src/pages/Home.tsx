import { useState } from 'react'
import { trpc } from '../trpc'

export function HomePage() {
  const status = trpc.auth.status.useQuery()
  const isAdmin = status.data?.me?.role === 'admin'

  return (
    <div className="max-w-3xl mx-auto px-10 py-10">
      <h1 className="text-2xl font-bold mb-1">Beyond Notes</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-2)' }}>
        Pick a page in the sidebar, or create a space and start writing. Journal, inbox, and tasks
        arrive in M2; publishing in M3/M4.
      </p>
      {isAdmin && <UsersPanel />}
    </div>
  )
}

function UsersPanel() {
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
    <section
      className="rounded-xl border p-6"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Users</h2>
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

      <ul className="text-sm mb-6">
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
        <>
          <h3 className="text-sm font-semibold mb-2">Invites</h3>
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
        </>
      )}
    </section>
  )
}
