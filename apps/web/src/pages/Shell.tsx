import type { UserView } from '@bn/schema'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { todayKey } from '../editor'
import { SpacesNav } from '../spaces'
import { trpc } from '../trpc'

export function Shell(props: { me: UserView; children: ReactNode }) {
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
        className="w-64 shrink-0 border-r p-3 flex flex-col gap-4 h-screen sticky top-0 overflow-y-auto"
        style={{ background: 'var(--sidebar)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 px-1">
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

        <DailyNav />

        <SpacesNav />

        <div
          className="mt-auto text-sm flex items-center justify-between px-1 pt-3"
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

      <main className="flex-1 min-w-0">{props.children}</main>
    </div>
  )
}

function DailyNav() {
  const memos = trpc.memos.list.useQuery()
  const agenda = trpc.tasks.agenda.useQuery()
  const today = todayKey()

  const inboxCount = (memos.data ?? []).filter((m) => !m.promotedTo).length
  const dueCount = (agenda.data ?? []).filter(
    (t) => !t.checked && t.due !== null && t.due <= today,
  ).length

  const items = [
    { label: 'Today', to: '/day/$date', params: { date: today }, count: null as number | null },
    { label: 'Inbox', to: '/inbox', params: {}, count: inboxCount },
    { label: 'Tasks', to: '/tasks', params: {}, count: dueCount },
  ]

  return (
    <div className="flex flex-col text-sm">
      {items.map((item) => (
        <Link
          key={item.label}
          to={item.to}
          params={item.params}
          className="flex items-center justify-between px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: 'var(--text-2)' }}
          activeProps={{ style: { color: 'var(--accent)', background: 'var(--accent-soft)' } }}
        >
          {item.label}
          {item.count !== null && item.count > 0 && (
            <span
              className="text-[11px] rounded-full px-1.5"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {item.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
