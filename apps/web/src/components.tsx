import type { FormEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

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

  return (
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
        className="w-full max-w-sm rounded-xl border p-6 relative m-0"
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
