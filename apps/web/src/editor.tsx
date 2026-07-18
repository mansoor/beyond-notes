import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import type { DocumentView } from '@bn/schema'
import { useEffect, useRef, useState } from 'react'
import { trpc } from './trpc'

export type SaveState = 'saved' | 'saving' | 'conflict' | 'error'

export async function uploadFile(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  const json = (await res.json()) as { url: string }
  return json.url
}

/**
 * BlockNote + debounced autosave behind the optimistic lock. Mount with a key
 * that includes doc.updatedAt so a reload replaces the editor instance.
 */
export function DocumentEditor(props: {
  pageId: string
  doc: DocumentView
  onReload: () => void
  onStateChange?: (s: SaveState) => void
}) {
  const save = trpc.pages.saveDoc.useMutation()
  const [state, setStateRaw] = useState<SaveState>('saved')
  const baseRef = useRef(props.doc.updatedAt)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setState = (s: SaveState) => {
    setStateRaw(s)
    props.onStateChange?.(s)
  }

  const parsed = (() => {
    try {
      const blocks = JSON.parse(props.doc.content)
      return Array.isArray(blocks) && blocks.length > 0 ? blocks : undefined
    } catch {
      return undefined
    }
  })()

  const editor = useCreateBlockNote({ initialContent: parsed, uploadFile })

  // clear any pending save only on unmount — an empty deps array is load-bearing
  // (without it, every render clears the debounce timer and saves never fire)
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const scheduleSave = () => {
    if (state === 'conflict') return
    setState('saving')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await save.mutateAsync({
          pageId: props.pageId,
          content: JSON.stringify(editor.document),
          baseUpdatedAt: baseRef.current,
        })
        baseRef.current = res.updatedAt
        setState('saved')
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        setState(message.includes('another window') ? 'conflict' : 'error')
      }
    }, 800)
  }

  const dark = document.documentElement.classList.contains('dark')

  return (
    <div>
      {state === 'conflict' && (
        <div
          className="rounded-lg border px-3 py-2 mb-3 text-sm flex items-center justify-between"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          This page changed in another window. Reload to pick up the latest version.
          <button type="button" className="underline" onClick={props.onReload}>
            Reload
          </button>
        </div>
      )}
      <div className="-mx-[54px]">
        <BlockNoteView editor={editor} onChange={scheduleSave} theme={dark ? 'dark' : 'light'} />
      </div>
    </div>
  )
}

export function SaveBadge(props: { state: SaveState }) {
  const map: Record<SaveState, { label: string; color: string }> = {
    saved: { label: 'Saved', color: 'var(--live)' },
    saving: { label: 'Saving…', color: 'var(--text-3)' },
    conflict: { label: 'Conflict', color: 'var(--danger)' },
    error: { label: 'Save failed — retrying on next edit', color: 'var(--danger)' },
  }
  const m = map[props.state]
  return (
    <span className="text-xs whitespace-nowrap" style={{ color: m.color }}>
      {m.label}
    </span>
  )
}

// ---- local-date helpers shared by the daily surfaces ----

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKey(): string {
  return toDateKey(new Date())
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function shiftDateKey(key: string, days: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

export function prettyDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
