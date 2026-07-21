import type { UserView } from '@bn/schema'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '../components'
import { todayKey } from '../editor'
import { SpacesNav } from '../spaces'
import { THEME_LABEL, applyTheme, currentTheme, nextTheme } from '../theme'
import { trpc } from '../trpc'
import { DataNav } from './Data'

export function Shell(props: { me: UserView; children: ReactNode }) {
  const utils = trpc.useUtils()
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const [theme, setTheme] = useState(currentTheme)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // resizable sidebar: width persists per browser, clamped so it can neither
  // vanish nor swallow the page. The handle sits on the sidebar's right edge,
  // so the width is just the pointer's x.
  const SIDEBAR_MIN = 180
  const SIDEBAR_MAX = 600
  const [sidebarW, setSidebarW] = useState(() => {
    const v = Number(localStorage.getItem('bn-sidebar-w'))
    return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 256
  })
  const dragging = useRef(false)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      setSidebarW(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX)))
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('bn-sidebar-w', String(sidebarW))
    } catch {}
  }, [sidebarW])
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  const cycleTheme = () => {
    const next = nextTheme(theme)
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="min-h-screen flex">
      <aside
        className="shrink-0 border-r p-3 flex flex-col gap-4 h-screen sticky top-0"
        style={{ width: sidebarW, background: 'var(--sidebar)', borderColor: 'var(--border)' }}
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
            onClick={cycleTheme}
            title={`Theme: ${THEME_LABEL[theme]} — click for ${THEME_LABEL[nextTheme(theme)]}`}
            className="ml-auto w-6 h-6 rounded border text-xs"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            {theme === 'dark' ? '☾' : theme === 'paper' ? '❧' : '☀'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-left"
          style={{
            background: 'var(--panel)',
            borderColor: 'var(--border)',
            color: 'var(--text-3)',
          }}
        >
          ⌕ Search
          <kbd
            className="ml-auto text-[10px] rounded border px-1"
            style={{ borderColor: 'var(--border)' }}
          >
            Ctrl K
          </kbd>
        </button>

        {/* only this region scrolls; logo, search, and the user menu stay put */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
          <DailyNav />
          <PinnedNav />
          <SpacesNav />
          <DataNav />
        </div>

        <UserMenu me={props.me} onSignOut={() => logout.mutate()} signingOut={logout.isPending} />
      </aside>

      {/* drag to resize the sidebar */}
      <div
        onPointerDown={startResize}
        title="Drag to resize the sidebar"
        className="shrink-0 sticky top-0 h-screen z-10 hover:bg-[var(--accent-soft)]"
        style={{ width: 5, marginLeft: -3, cursor: 'col-resize' }}
      />

      <main className="flex-1 min-w-0">{props.children}</main>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  )
}

function UserMenu(props: { me: UserView; onSignOut: () => void; signingOut: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // click-away and Escape both close; the menu is small enough that a
  // full-screen backdrop would be heavier than the interaction deserves
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemClass = 'block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-black/5'

  return (
    <div ref={rootRef} className="relative pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
      {open && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border py-1 shadow-lg z-40"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          <Link to="/settings" className={itemClass} onClick={() => setOpen(false)}>
            ⚙ Settings
          </Link>
          <Link to="/archive" className={itemClass} onClick={() => setOpen(false)}>
            🗄 Archive
          </Link>
          <Link to="/trash" className={itemClass} onClick={() => setOpen(false)}>
            🗑 Trash
          </Link>
          <Link to="/stale" className={itemClass} onClick={() => setOpen(false)}>
            ⏳ Needs a look
          </Link>
          <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
          <button
            type="button"
            className={itemClass}
            onClick={props.onSignOut}
            disabled={props.signingOut}
          >
            ↩ Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-black/5"
        style={{ color: 'var(--text-2)' }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs font-semibold shrink-0"
          style={{ background: 'var(--accent)' }}
        >
          {props.me.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate">
          {props.me.name}
          {props.me.role === 'admin' ? ' · admin' : ''}
        </span>
        <span className="ml-auto text-xs" style={{ color: 'var(--text-3)' }}>
          {open ? '▾' : '▴'}
        </span>
      </button>
    </div>
  )
}

function SearchModal(props: { onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const results = trpc.search.all.useQuery({ q }, { enabled: q.trim().length >= 2 })

  const open = (kind: 'page' | 'memo', id: string) => {
    props.onClose()
    if (kind === 'memo') navigate({ to: '/inbox' })
    else navigate({ to: '/p/$pageId', params: { pageId: id } })
  }

  return (
    <Modal title="Search" onClose={props.onClose}>
      <input
        autoFocus
        className="w-full rounded-lg border px-3 py-2 text-sm mb-3 outline-none"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        placeholder="Search pages and memos…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-72 overflow-y-auto">
        {results.data?.map((r) => (
          <button
            key={`${r.kind}:${r.id}`}
            type="button"
            onClick={() => open(r.kind, r.id)}
            className="block w-full text-left py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="text-sm font-medium truncate">
              {r.kind === 'memo' ? '💭 ' : '📄 '}
              {r.title}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
              {r.context} — {r.snippet}
            </div>
          </button>
        ))}
        {q.trim().length >= 2 && results.data?.length === 0 && (
          <p className="text-sm py-2" style={{ color: 'var(--text-3)' }}>
            No results.
          </p>
        )}
      </div>
    </Modal>
  )
}

function PinnedNav() {
  const pins = trpc.pins.list.useQuery()
  if (!pins.data || pins.data.length === 0) return null
  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-wide font-semibold mb-1 px-2"
        style={{ color: 'var(--text-3)' }}
      >
        ★ Pinned
      </div>
      {pins.data.map((pin) => (
        <Link
          key={pin.pageId}
          to="/p/$pageId"
          params={{ pageId: pin.pageId }}
          className="block truncate px-2 py-1 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: 'var(--text-2)' }}
          activeProps={{ style: { color: 'var(--accent)', background: 'var(--accent-soft)' } }}
          title={pin.title}
        >
          {pin.pageType === 'blog' ? '📰 ' : pin.pageType === 'gallery' ? '🖼 ' : ''}
          {pin.title}
        </Link>
      ))}
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
    { label: 'Tags', to: '/tags', params: {}, count: null as number | null },
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
