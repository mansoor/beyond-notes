import type { UserView } from '@bn/schema'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { BrandMark, Modal } from '../components'
import { todayKey } from '../editor'
import { SpacesNav } from '../spaces'
import {
  type AppTheme,
  THEMES,
  THEME_ICON,
  THEME_LABEL,
  applyTheme,
  currentTheme,
  previewTheme,
} from '../theme'
import { trpc } from '../trpc'
import { DatabasesNav } from './Data'

export function Shell(props: { me: UserView; children: ReactNode }) {
  const utils = trpc.useUtils()
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const [theme, setTheme] = useState(currentTheme)
  const [searchOpen, setSearchOpen] = useState(false)

  // On a phone the sidebar can't sit alongside the page — it becomes an
  // off-canvas drawer behind a hamburger, with the persistent controls (brand,
  // theme, account) lifted into a fixed top bar. Driven by a JS media query
  // rather than `md:` classes so the two layouts stay readable as one branch
  // each, and the resize handle / drawer machinery simply don't mount on mobile.
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)

  // any navigation closes the drawer — covers every link inside it without each
  // nav component needing to know the drawer exists
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is an intentional trigger — fire on every route change to close the drawer
  useEffect(() => setNavOpen(false), [pathname])

  useEffect(() => {
    if (!isMobile || !navOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobile, navOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') setNavOpen(false)
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

  return (
    <div className="min-h-screen flex">
      {/* Mobile-only top bar: hamburger, brand, and the persistent controls */}
      {isMobile && (
        <header
          className="fixed top-0 inset-x-0 h-14 z-30 flex items-center gap-2 px-3 border-b"
          style={{ background: 'var(--sidebar)', borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--text-2)' }}
          >
            <span className="msym" style={{ fontSize: 24 }}>
              menu
            </span>
          </button>
          <BrandMark size={24} />
          <span className="font-semibold text-sm">Beyond Notes</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemePicker theme={theme} onPick={setTheme} />
            <UserMenu
              me={props.me}
              onSignOut={() => logout.mutate()}
              signingOut={logout.isPending}
              placement="down"
              compact
            />
          </div>
        </header>
      )}

      {/* backdrop dims the page behind the open drawer and closes it on tap */}
      {isMobile && navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/40"
        />
      )}

      <aside
        className={`border-r p-3 flex flex-col gap-4 h-screen top-0 ${
          isMobile
            ? `fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[300px] transition-transform duration-200 ${
                navOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
              }`
            : 'shrink-0 sticky'
        }`}
        style={{
          width: isMobile ? undefined : sidebarW,
          background: 'var(--sidebar)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex items-center gap-2 px-1">
          <BrandMark />
          <span className="font-semibold">Beyond Notes</span>
          <ThemePicker theme={theme} onPick={setTheme} className="ml-auto" />
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
          <DatabasesNav />
        </div>

        <UserMenu me={props.me} onSignOut={() => logout.mutate()} signingOut={logout.isPending} />
      </aside>

      {/* drag to resize the sidebar — desktop only */}
      {!isMobile && (
        <div
          onPointerDown={startResize}
          title="Drag to resize the sidebar"
          className="shrink-0 sticky top-0 h-screen z-10 hover:bg-[var(--accent-soft)]"
          style={{ width: 5, marginLeft: -3, cursor: 'col-resize' }}
        />
      )}

      <main className={`flex-1 min-w-0 ${isMobile ? 'pt-14' : ''}`}>{props.children}</main>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  )
}

/** True below Tailwind's `md` breakpoint (768px). Synchronous first read (this
 *  is a client-only SPA), so the correct layout paints on the first frame. */
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const on = () => setMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}

const THEME_CELL = 26 // px per swatch
const THEME_OPEN_MS = 160

/**
 * Theme swatches that grow out from the one you're on. The current theme keeps
 * its spot and the others unfold to either side of it — lighter to the left,
 * darker to the right, matching the THEMES order — so the row reads like a
 * dimmer with your setting in the middle. Hovering wears a theme for real;
 * leaving puts yours back.
 */
function ThemePicker(props: { theme: AppTheme; onPick: (t: AppTheme) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  // Hover previews stay off until the strip has finished unfolding. While it
  // slides, swatches travel *under* a stationary cursor — each one it passes
  // would repaint the whole app, which reads as a flicker rather than a preview.
  const [settled, setSettled] = useState(false)
  const shown = useRef<AppTheme | null>(null)
  const selected = Math.max(0, THEMES.indexOf(props.theme))

  useEffect(() => {
    if (!open) {
      setSettled(false)
      return
    }
    const t = setTimeout(() => setSettled(true), THEME_OPEN_MS + 20)
    return () => clearTimeout(t)
  }, [open])

  /** Preview, but only once the strip is still — and never twice for the same theme. */
  const preview = (t: AppTheme) => {
    if (!settled || shown.current === t) return
    shown.current = t
    previewTheme(t)
  }

  const close = () => {
    setOpen(false)
    shown.current = null
    previewTheme(props.theme) // undo whatever the last hover was showing
  }

  return (
    // fixed-size anchor so the header never reflows; the strip overlays it
    <div
      className={`relative ${props.className ?? ''}`}
      style={{ width: THEME_CELL, height: THEME_CELL }}
    >
      <div
        className="absolute top-0 flex items-center rounded border overflow-hidden"
        style={{
          borderColor: open ? 'var(--border)' : 'transparent',
          background: open ? 'var(--panel)' : 'transparent',
          // keep the selected cell pinned to the anchor: shift the strip left by
          // the cells that unfold before it
          left: open ? -selected * THEME_CELL : 0,
          width: open ? THEMES.length * THEME_CELL : THEME_CELL,
          transition: 'width 160ms ease, left 160ms ease',
          zIndex: 40,
        }}
        onMouseLeave={close}
      >
        {(open ? THEMES : [props.theme]).map((t) => (
          <button
            key={t}
            type="button"
            title={
              open
                ? `${THEME_LABEL[t]}${t === props.theme ? ' (current)' : ' — hover to preview'}`
                : `Theme: ${THEME_LABEL[props.theme]} — click to choose`
            }
            className="h-6 text-xs shrink-0"
            style={{
              width: THEME_CELL,
              color: open && t === props.theme ? 'var(--accent)' : 'var(--text-2)',
              background:
                open && t === props.theme
                  ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                  : 'transparent',
            }}
            onMouseEnter={() => preview(t)}
            // the cursor is often already sitting on a swatch when the strip
            // settles, so the first movement after that is what starts a preview
            onMouseMove={() => preview(t)}
            onFocus={() => preview(t)}
            onClick={() => {
              if (!open) {
                setOpen(true)
                return
              }
              applyTheme(t)
              shown.current = null
              props.onPick(t)
              setOpen(false)
            }}
          >
            {THEME_ICON[t]}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The account menu. Two shapes from one definition so both entry points open
 * the same items: the sidebar's full-width row that opens upward, and the
 * mobile header's bare avatar that opens downward (`compact` + `placement`).
 */
function UserMenu(props: {
  me: UserView
  onSignOut: () => void
  signingOut: boolean
  placement?: 'up' | 'down'
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const down = props.placement === 'down'

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
    <div
      ref={rootRef}
      className={`relative ${props.compact ? '' : 'pt-2 border-t'}`}
      style={props.compact ? undefined : { borderColor: 'var(--border)' }}
    >
      {open && (
        <div
          className={`absolute rounded-lg border py-1 shadow-lg z-50 ${
            down ? 'top-full mt-1' : 'bottom-full mb-1'
          } ${props.compact ? 'right-0 w-52' : 'left-0 right-0'}`}
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
      {props.compact ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-9 h-9 flex items-center justify-center rounded-full"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
        >
          <span
            className="w-7 h-7 rounded-full text-white flex items-center justify-center text-xs font-semibold"
            style={{ background: 'var(--accent)' }}
          >
            {props.me.name.slice(0, 1).toUpperCase()}
          </span>
        </button>
      ) : (
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
      )}
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
