import type { CSSProperties, FormEvent, ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MATERIAL_ICONS } from './material-icons'

/**
 * Fixed-position placement for a dropdown anchored to a trigger. `position:
 * fixed` escapes the sidebar's `overflow` clipping, and the menu flips above the
 * trigger when there isn't room below — so it always stays on screen.
 */
export function useMenuAnchor(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  width = 160,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
    const below = window.innerHeight - r.bottom
    setStyle(
      below < 280
        ? { position: 'fixed', bottom: window.innerHeight - r.top + 4, left, width }
        : { position: 'fixed', top: r.bottom + 4, left, width },
    )
  }, [open, ref, width])
  return style
}

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
// Scroll-snap columns (12h hour, minute, AM/PM); the row in the centre band is
// the value. Scrolling settles onto a row and reports it up. The value stays a
// 24h 'HH:MM' string — only the display is 12-hour.

const ROW = 25
const VISIBLE = 5 // odd, so exactly one row is centred
const PAD = ((VISIBLE - 1) / 2) * ROW
const HOURS12 = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const PERIODS = ['AM', 'PM']

function parse12(value: string) {
  const [hh = '00', mm = '00'] = value.split(':')
  const h24 = Number(hh) || 0
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return {
    hourIdx: Math.max(0, HOURS12.indexOf(String(h12))),
    minIdx: Math.min(59, Math.max(0, Number(mm) || 0)),
    periodIdx: h24 < 12 ? 0 : 1,
  }
}

function to24(hourIdx: number, minIdx: number, periodIdx: number): string {
  const h12 = Number(HOURS12[hourIdx] ?? '12')
  const h24 = (h12 % 12) + (periodIdx === 1 ? 12 : 0)
  return `${String(h24).padStart(2, '0')}:${MINUTES[minIdx] ?? '00'}`
}

/** '23:59' → '11:59 PM' for compact display next to the picker. */
export function fmtTime12(value: string): string {
  const { hourIdx, minIdx, periodIdx } = parse12(value)
  return `${HOURS12[hourIdx]}:${MINUTES[minIdx]} ${PERIODS[periodIdx]}`
}

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
      style={{
        height: VISIBLE * ROW,
        width: 26,
        scrollSnapType: 'y mandatory',
        scrollbarWidth: 'none',
      }}
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
            fontWeight: i === props.index ? 600 : 400,
            fontSize: i === props.index ? 12 : 11,
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
  const { hourIdx, minIdx, periodIdx } = parse12(props.value)
  return (
    <div className="relative flex justify-center select-none">
      {/* the highlighted centre band the chosen row sits in */}
      <div
        className="pointer-events-none absolute left-0 right-0 rounded-lg"
        style={{ top: PAD, height: ROW, background: 'var(--accent-soft)' }}
      />
      <WheelColumn
        values={HOURS12}
        index={hourIdx}
        ariaLabel="Hour"
        onIndex={(i) => props.onChange(to24(i, minIdx, periodIdx))}
      />
      <span
        className="flex items-center font-semibold"
        style={{ height: VISIBLE * ROW, fontSize: 12, color: 'var(--text-3)' }}
      >
        :
      </span>
      <WheelColumn
        values={MINUTES}
        index={minIdx}
        ariaLabel="Minute"
        onIndex={(i) => props.onChange(to24(hourIdx, i, periodIdx))}
      />
      <span style={{ width: 5 }} />
      <WheelColumn
        values={PERIODS}
        index={periodIdx}
        ariaLabel="AM or PM"
        onIndex={(i) => props.onChange(to24(hourIdx, minIdx, i))}
      />
    </div>
  )
}

/**
 * A compact time control that behaves like a native date field: it shows the
 * chosen time as text, and clicking opens the wheel as an overlay popover that
 * closes on click-away. `null` means "no time"; `clearable` shows an ✕ to unset.
 */
export function TimeField(props: {
  value: string | null
  onChange: (v: string | null) => void
  clearable?: boolean
  placeholder?: string
  /** the time a fresh field lands on when first opened */
  defaultOnOpen?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={rootRef} className="relative inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (props.value == null) props.onChange(props.defaultOnOpen ?? '09:00')
          setOpen((o) => !o)
        }}
        className="rounded-lg border px-2 py-1 text-xs"
        style={{
          background: 'var(--bg)',
          borderColor: 'var(--border)',
          color: props.value != null ? 'var(--accent)' : 'var(--text-3)',
        }}
      >
        🕑 {props.value != null ? fmtTime12(props.value) : (props.placeholder ?? 'add time')}
      </button>
      {props.clearable && props.value != null && (
        <button
          type="button"
          title="Clear time"
          className="text-xs"
          style={{ color: 'var(--text-3)' }}
          onClick={() => {
            props.onChange(null)
            setOpen(false)
          }}
        >
          ✕
        </button>
      )}
      {open && props.value != null && (
        <div
          className="absolute right-0 top-full z-40 mt-1 rounded-lg border px-1.5 py-1 shadow-lg"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          <TimeWheel value={props.value} onChange={(v) => props.onChange(v)} />
        </div>
      )}
    </span>
  )
}

// A page icon is stored as a Material Symbols ligature name (lowercase, digits,
// underscores). Legacy emoji values render as-is for backward compatibility.
const MATERIAL_NAME = /^[a-z0-9_]+$/

/** Render a page-icon value: a Material Symbols glyph, or a literal emoji. */
export function PageIcon(props: { icon: string; className?: string; style?: React.CSSProperties }) {
  if (MATERIAL_NAME.test(props.icon)) {
    return (
      <span className={`msym ${props.className ?? ''}`} style={props.style} aria-hidden>
        {props.icon}
      </span>
    )
  }
  return (
    <span className={props.className} style={props.style}>
      {props.icon}
    </span>
  )
}

/**
 * Icon picker: type to search the full Material Symbols set, click to choose.
 * The popover anchors to the right edge so it never spills off the rail.
 */
export function IconPicker(props: { value: string | null; onPick: (v: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = term ? MATERIAL_ICONS.filter((n) => n.includes(term)) : MATERIAL_ICONS
    return list.slice(0, 90)
  }, [q])

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="Choose an icon"
          className="w-9 h-9 rounded-lg border flex items-center justify-center text-xl leading-none"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          {props.value ? <PageIcon icon={props.value} /> : '＋'}
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
          className="absolute right-0 z-40 mt-1 rounded-lg border shadow-lg"
          style={{ width: 256, background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: opening the picker to type is the whole point
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search icons…"
            className="w-full rounded-t-lg border-b px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          />
          <div
            className="grid gap-0.5 p-2 overflow-y-auto"
            style={{ gridTemplateColumns: 'repeat(6, 1fr)', maxHeight: 208 }}
          >
            {results.map((name) => (
              <button
                key={name}
                type="button"
                title={name}
                className="h-8 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"
                style={{ outline: props.value === name ? '2px solid var(--accent)' : undefined }}
                onClick={() => {
                  props.onPick(name)
                  setOpen(false)
                }}
              >
                <PageIcon icon={name} style={{ fontSize: 20 }} />
              </button>
            ))}
            {results.length === 0 && (
              <p className="col-span-6 text-xs px-1 py-2" style={{ color: 'var(--text-3)' }}>
                No icons match “{q}”.
              </p>
            )}
          </div>
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
