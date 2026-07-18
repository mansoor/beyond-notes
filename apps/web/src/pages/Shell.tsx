import type { UserView } from '@bn/schema'
import { useState } from 'react'
import { trpc } from '../trpc'

const PLACEHOLDERS: Array<{ section: string; items: Array<{ label: string; milestone: string }> }> =
  [
    {
      section: '',
      items: [
        { label: 'Today', milestone: 'M2' },
        { label: 'Inbox', milestone: 'M2' },
        { label: 'Tasks', milestone: 'M2' },
      ],
    },
    { section: 'Wikis', items: [{ label: 'Your first wiki', milestone: 'M1' }] },
    { section: 'Notebooks', items: [{ label: 'Personal notes', milestone: 'M1' }] },
    { section: 'Sites', items: [{ label: 'Your site', milestone: 'M4' }] },
  ]

export function Shell(props: { me: UserView }) {
  const utils = trpc.useUtils()
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const [dark, setDark] = useState(false)

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark', !dark)
    setDark(!dark)
  }

  return (
    <div className="min-h-screen flex">
      <aside
        className="w-64 shrink-0 border-r p-4 flex flex-col gap-5"
        style={{ background: 'var(--sidebar)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-sm"
            style={{ background: 'var(--accent)' }}
          >
            B
          </span>
          <span className="font-semibold">Beyond Notes</span>
          <button
            type="button"
            onClick={toggleDark}
            title="Toggle theme"
            className="ml-auto w-6 h-6 rounded border text-xs"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            ◐
          </button>
        </div>
        <nav className="flex flex-col gap-4 text-sm">
          {PLACEHOLDERS.map((group) => (
            <div key={group.section || 'top'}>
              {group.section && (
                <div
                  className="text-[11px] uppercase tracking-wide font-semibold mb-1"
                  style={{ color: 'var(--text-3)' }}
                >
                  {group.section}
                </div>
              )}
              {group.items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between px-2 py-1 rounded"
                  style={{ color: 'var(--text-2)' }}
                >
                  {item.label}
                  <span
                    className="text-[10px] rounded px-1.5"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {item.milestone}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div
          className="mt-auto text-sm flex items-center justify-between"
          style={{ color: 'var(--text-2)' }}
        >
          <span>
            {props.me.name}
            {props.me.role === 'admin' ? ' · admin' : ''}
          </span>
          <button
            type="button"
            className="underline"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-10 max-w-3xl">
        <h1 className="text-2xl font-bold mb-1">The walking skeleton is alive</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-2)' }}>
          M0 proves the pipeline: monorepo, migrations on either database, auth with invites, this
          shell, Docker, CI. The surfaces in the sidebar arrive milestone by milestone.
        </p>
        {props.me.role === 'admin' && <UsersPanel />}
      </main>
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
    // show the app-origin URL: BASE_URL may differ in dev (vite port)
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
