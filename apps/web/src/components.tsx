import type { FormEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function CenterCard(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-xl border p-8"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-sm"
            style={{ background: 'var(--accent)' }}
          >
            B
          </span>
          <h1 className="text-xl font-semibold">{props.title}</h1>
        </div>
        {props.subtitle && (
          <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
            {props.subtitle}
          </p>
        )}
        {props.children}
      </div>
    </div>
  )
}

export function Field(props: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium mb-1">{props.label}</span>
      <input
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        type={props.type ?? 'text'}
        value={props.value}
        autoFocus={props.autoFocus}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  )
}

export function SubmitButton(props: { label: string; busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={props.busy}
      className="w-full rounded-lg py-2 text-sm font-medium text-white disabled:opacity-60"
      style={{ background: 'var(--accent)' }}
    >
      {props.busy ? 'Working…' : props.label}
    </button>
  )
}

export function ErrorNote(props: { message: string | null }) {
  if (!props.message) return null
  return (
    <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
      {props.message}
    </p>
  )
}

export function Modal(props: {
  title: string
  onClose: () => void
  /**
   * When true (the form has unsaved edits), clicking the backdrop does NOT
   * dismiss — only an explicit action does: save, the ✕ button, or Escape.
   */
  dirty?: boolean
  /** 'lg' for content-heavy dialogs (tabbed settings); default is a compact card. */
  width?: 'sm' | 'lg'
  children: ReactNode
}) {
  // Escape is an explicit cancel and always closes, dirty or not
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Portaled to <body>: modals used to render inline in the React tree, where
  // an ancestor stacking context (sidebar, editor) could trap z-50 and let
  // page content paint over the dialog.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={() => {
        if (!props.dirty) props.onClose()
      }}
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
      role="presentation"
    >
      <dialog
        open
        className={`w-full ${props.width === 'lg' ? 'max-w-2xl' : 'max-w-sm'} rounded-xl border p-6 relative m-0 max-h-[85vh] overflow-y-auto`}
        style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
        aria-label={props.title}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="font-semibold">{props.title}</h2>
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={props.onClose}
            className="rounded px-1.5 text-sm leading-6"
            style={{ color: 'var(--text-3)' }}
          >
            ✕
          </button>
        </div>
        {props.children}
      </dialog>
    </div>,
    document.body,
  )
}

// ---- iOS-alarm-style time wheel ----
//
// Two scroll-snap columns (hours, minutes); the row sitting in the centre band
// is the value. Scrolling settles onto a row and reports it up. Value is 'HH:MM'.

const ROW = 34
const VISIBLE = 5 // odd, so exactly one row is centred
const PAD = ((VISIBLE - 1) / 2) * ROW
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function WheelColumn(props: {
  values: string[]
  index: number
  onIndex: (i: number) => void
  ariaLabel: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  // keep the scroll position pinned to the selected row; re-runs when the value
  // changes from outside (and harmlessly no-ops when the user's own scroll set it)
  useEffect(() => {
    const el = ref.current
    if (el && Math.round(el.scrollTop / ROW) !== props.index) el.scrollTop = props.index * ROW
  }, [props.index])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const i = Math.max(0, Math.min(props.values.length - 1, Math.round(el.scrollTop / ROW)))
      if (i !== props.index) props.onIndex(i)
    }, 110)
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      aria-label={props.ariaLabel}
      className="relative overflow-y-auto [&::-webkit-scrollbar]:hidden"
      style={{ height: VISIBLE * ROW, scrollSnapType: 'y mandatory', scrollbarWidth: 'none' }}
    >
      <div style={{ height: PAD }} />
      {props.values.map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' })}
          className="flex w-full items-center justify-center"
          style={{
            height: ROW,
            scrollSnapAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
            color: i === props.index ? 'var(--text)' : 'var(--text-3)',
            fontWeight: i === props.index ? 650 : 400,
            fontSize: i === props.index ? 19 : 15,
            opacity: Math.abs(i - props.index) >= 2 ? 0.4 : 1,
            transition: 'color .1s, font-size .1s, opacity .1s',
          }}
        >
          {v}
        </button>
      ))}
      <div style={{ height: PAD }} />
    </div>
  )
}

export function TimeWheel(props: { value: string; onChange: (v: string) => void }) {
  const [h = '00', m = '00'] = props.value.split(':')
  const hi = Math.max(0, HOURS.indexOf(h))
  const mi = Math.max(0, MINUTES.indexOf(m))
  return (
    <div className="relative flex justify-center gap-1 select-none">
      {/* the highlighted centre band the chosen row sits in */}
      <div
        className="pointer-events-none absolute left-0 right-0 rounded-lg"
        style={{ top: PAD, height: ROW, background: 'var(--accent-soft)' }}
      />
      <WheelColumn
        values={HOURS}
        index={hi}
        ariaLabel="Hour"
        onIndex={(i) => props.onChange(`${HOURS[i]}:${MINUTES[mi]}`)}
      />
      <span
        className="flex items-center font-semibold"
        style={{ height: VISIBLE * ROW, color: 'var(--text-2)' }}
      >
        :
      </span>
      <WheelColumn
        values={MINUTES}
        index={mi}
        ariaLabel="Minute"
        onIndex={(i) => props.onChange(`${HOURS[hi]}:${MINUTES[i]}`)}
      />
    </div>
  )
}

// A curated grid of emoji for page icons — the ones that actually read well as
// tiny nav glyphs. Not exhaustive; a page can only wear one.
const PAGE_ICONS = [
  '📄',
  '📘',
  '📗',
  '📙',
  '📕',
  '📓',
  '📔',
  '📒',
  '📝',
  '🗂️',
  '📁',
  '📦',
  '🚀',
  '⚙️',
  '🔧',
  '🔑',
  '🔒',
  '🌐',
  '💡',
  '⭐',
  '🔔',
  '📊',
  '📈',
  '🧩',
  '🧪',
  '🎨',
  '🖼️',
  '🎬',
  '🎵',
  '🏷️',
  '🔖',
  '📌',
  '✅',
  '❓',
  '⚠️',
  'ℹ️',
  '💬',
  '👋',
  '🏠',
  '🧭',
] as const

/** Emoji picker in a click-away popover; `null` clears the icon. */
export function IconPicker(props: { value: string | null; onPick: (v: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="Choose an icon"
          className="w-9 h-9 rounded-lg border flex items-center justify-center text-lg leading-none"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          {props.value || '＋'}
        </button>
        {props.value && (
          <button
            type="button"
            className="text-xs underline"
            style={{ color: 'var(--danger)' }}
            onClick={() => props.onPick(null)}
          >
            remove
          </button>
        )}
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          Shown in the sidebar &amp; published nav
        </span>
      </div>
      {open && (
        <div
          className="absolute z-40 mt-1 rounded-lg border p-2 grid gap-0.5 shadow-lg"
          style={{
            gridTemplateColumns: 'repeat(8, 1fr)',
            width: 264,
            background: 'var(--panel)',
            borderColor: 'var(--border)',
          }}
        >
          {PAGE_ICONS.map((e) => (
            <button
              key={e}
              type="button"
              className="w-7 h-7 rounded text-lg leading-none hover:bg-black/5 dark:hover:bg-white/10"
              style={{ outline: props.value === e ? '2px solid var(--accent)' : undefined }}
              onClick={() => {
                props.onPick(e)
                setOpen(false)
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, onSubmit }
}
