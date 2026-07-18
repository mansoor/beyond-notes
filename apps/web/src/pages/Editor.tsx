import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import type { DocumentView, PageMeta } from '@bn/schema'
import { useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'

export function EditorPage() {
  const { pageId } = useParams({ from: '/app/p/$pageId' })
  const q = trpc.pages.get.useQuery({ pageId })

  if (q.isLoading) {
    return (
      <div className="p-10 text-sm" style={{ color: 'var(--text-3)' }}>
        Loading page…
      </div>
    )
  }
  if (q.error || !q.data) {
    return (
      <div className="p-10 text-sm" style={{ color: 'var(--danger)' }}>
        {q.error?.message ?? 'Page not found.'}
      </div>
    )
  }
  // key remounts the editor when the page (or a reloaded document) changes
  return <DocEditor key={`${pageId}:${q.data.doc.updatedAt}`} page={q.data.page} doc={q.data.doc} />
}

type SaveState = 'saved' | 'saving' | 'conflict' | 'error'

function DocEditor(props: { page: PageMeta; doc: DocumentView }) {
  const utils = trpc.useUtils()
  const save = trpc.pages.saveDoc.useMutation()
  const rename = trpc.pages.rename.useMutation()

  const [title, setTitle] = useState(props.page.title)
  const [state, setState] = useState<SaveState>('saved')
  const baseRef = useRef(props.doc.updatedAt)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const parsed = (() => {
    try {
      const blocks = JSON.parse(props.doc.content)
      return Array.isArray(blocks) && blocks.length > 0 ? blocks : undefined
    } catch {
      return undefined
    }
  })()

  const editor = useCreateBlockNote({ initialContent: parsed })

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
          pageId: props.page.id,
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

  const commitTitle = async () => {
    const next = title.trim() || 'Untitled'
    setTitle(next)
    if (next !== props.page.title) {
      await rename.mutateAsync({ pageId: props.page.id, title: next })
      await utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
    }
  }

  const dark = document.documentElement.classList.contains('dark')

  return (
    <div className="max-w-3xl mx-auto px-10 py-8">
      <div className="flex items-center gap-3 mb-2">
        <input
          className="flex-1 bg-transparent text-3xl font-bold outline-none"
          value={title}
          placeholder="Untitled"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <SaveBadge state={state} />
      </div>
      {state === 'conflict' && (
        <div
          className="rounded-lg border px-3 py-2 mb-3 text-sm flex items-center justify-between"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          This page changed in another window. Reload to pick up the latest version.
          <button
            type="button"
            className="underline"
            onClick={() => utils.pages.get.invalidate({ pageId: props.page.id })}
          >
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

function SaveBadge(props: { state: SaveState }) {
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
