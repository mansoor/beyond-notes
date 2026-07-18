import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'

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
