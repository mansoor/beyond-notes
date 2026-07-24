import type { MemoView } from '@bn/schema'
import { useEffect, useRef, useState } from 'react'
import { ErrorNote, Modal, SubmitButton, useSubmit } from '../components'
import { trpc } from '../trpc'

export function InboxPage() {
  const utils = trpc.useUtils()
  const memos = trpc.memos.list.useQuery()
  const capture = trpc.memos.capture.useMutation({
    onSuccess: () => utils.memos.list.invalidate(),
  })
  const captureLink = trpc.memos.captureLink.useMutation()
  // PWA share target lands here as /inbox?title=&text=&url= — prefill capture
  const [text, setText] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    // a shared link is fetched below and replaces this; the non-link parts are
    // shown immediately so the box is never blank while we fetch
    return [params.get('title'), params.get('text')]
      .filter((v) => v && !/^https?:\/\//i.test(v))
      .join('\n')
  })
  const [fetching, setFetching] = useState(false)

  // A shared link: fetch it (server-side) and prefill a tidy title + URL + body
  // for the user to review before saving. Runs once, on load.
  const started = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: run exactly once on load, guarded by the ref
  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(window.location.search)
    const shareText = params.get('text') ?? ''
    const url = params.get('url') || shareText.match(/https?:\/\/\S+/)?.[0] || ''
    if (!url) return
    setFetching(true)
    captureLink.mutate(
      { url },
      {
        onSettled: () => setFetching(false),
        onSuccess: (r) => {
          if (!r.ok) {
            setText((t) => [t, url].filter(Boolean).join('\n'))
            return
          }
          const block = [r.title, r.url]
          if (r.content) block.push('', r.content)
          setText((t) => [t.trim(), block.filter(Boolean).join('\n')].filter(Boolean).join('\n\n'))
        },
        onError: () => setText((t) => [t, url].filter(Boolean).join('\n')),
      },
    )
  }, [])

  const submit = async () => {
    const value = text.trim()
    if (!value) return
    await capture.mutateAsync({ content: value })
    setText('')
  }

  return (
    <div className="max-w-5xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-1">Inbox</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Capture first, organize later — or never.
      </p>

      <div
        className="rounded-xl border p-4 mb-8"
        style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
      >
        <textarea
          rows={text.length > 120 ? 8 : 2}
          className="w-full bg-transparent text-sm outline-none resize-y"
          placeholder="What's on your mind?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
          }}
        />
        <div className="flex items-center justify-end gap-3 mt-2">
          {fetching && (
            <span className="text-xs mr-auto" style={{ color: 'var(--text-3)' }}>
              Fetching link…
            </span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={capture.isPending || !text.trim()}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            Capture
          </button>
        </div>
      </div>

      {(memos.data ?? []).map((memo) => (
        <MemoItem key={memo.id} memo={memo} />
      ))}
      {memos.data?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Nothing captured yet.
        </p>
      )}
    </div>
  )
}

function MemoItem(props: { memo: MemoView }) {
  const utils = trpc.useUtils()
  const invalidate = () =>
    Promise.all([utils.memos.list.invalidate(), utils.tasks.agenda.invalidate()])
  const toJournal = trpc.memos.promoteToJournal.useMutation({ onSuccess: invalidate })
  const toTask = trpc.memos.promoteToTask.useMutation({ onSuccess: invalidate })
  const del = trpc.memos.delete.useMutation({ onSuccess: invalidate })
  const update = trpc.memos.update.useMutation({ onSuccess: invalidate })
  const [choosingSpace, setChoosingSpace] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.memo.content)

  const m = props.memo
  const when = new Date(m.createdAt)
  const busy = toJournal.isPending || toTask.isPending || del.isPending || update.isPending

  const saveEdit = async () => {
    const value = draft.trim()
    if (value && value !== m.content) await update.mutateAsync({ memoId: m.id, content: value })
    setEditing(false)
  }

  return (
    <div
      className="group border-b py-4"
      style={{ borderColor: 'var(--border)', opacity: m.promotedTo ? 0.55 : 1 }}
    >
      <div
        className="text-xs font-mono mb-1 flex items-center gap-2"
        style={{ color: 'var(--text-3)' }}
      >
        {when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        {m.promotedTo && <span>promoted → {m.promotedTo}</span>}
        {!m.promotedTo && !editing && (
          <button
            type="button"
            title="Edit"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => {
              setDraft(m.content)
              setEditing(true)
            }}
          >
            ✎
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea
            // biome-ignore lint/a11y/noAutofocus: an explicit edit action wants focus
            autoFocus
            rows={2}
            className="w-full rounded-lg border px-3 py-2 text-[15px] outline-none resize-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <div className="flex gap-2 mt-1.5">
            <ActionButton label="Save" disabled={busy} onClick={saveEdit} />
            <ActionButton label="Cancel" onClick={() => setEditing(false)} />
          </div>
        </div>
      ) : (
        <p className="text-[15px] whitespace-pre-wrap">{m.content}</p>
      )}
      {!m.promotedTo && !editing && (
        <div className="flex gap-2 mt-2">
          <ActionButton label="→ Note" disabled={busy} onClick={() => setChoosingSpace(true)} />
          <ActionButton
            label="→ Journal"
            disabled={busy}
            onClick={() => toJournal.mutate({ memoId: m.id })}
          />
          <ActionButton
            label="✓ Make task"
            disabled={busy}
            onClick={() => toTask.mutate({ memoId: m.id })}
          />
          <ActionButton
            label="Delete"
            danger
            disabled={busy}
            onClick={() => del.mutate({ memoId: m.id })}
          />
        </div>
      )}
      {choosingSpace && (
        <PromoteToNoteModal memoId={m.id} onClose={() => setChoosingSpace(false)} />
      )}
    </div>
  )
}

function ActionButton(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
      style={{
        borderColor: 'var(--border)',
        color: props.danger ? 'var(--danger)' : 'var(--text-2)',
        background: 'var(--panel)',
      }}
    >
      {props.label}
    </button>
  )
}

function PromoteToNoteModal(props: { memoId: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const spaces = trpc.spaces.list.useQuery()
  const promote = trpc.memos.promoteToNote.useMutation()
  const [spaceId, setSpaceId] = useState('')
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!spaceId) throw new Error('Pick a space')
    await promote.mutateAsync({ memoId: props.memoId, spaceId })
    await utils.memos.list.invalidate()
    await utils.pages.tree.invalidate({ spaceId })
    props.onClose()
  })

  return (
    <Modal title="Promote to note" onClose={props.onClose} dirty={spaceId !== ''}>
      <form onSubmit={onSubmit}>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Space</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
          >
            <option value="">— choose —</option>
            {spaces.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.personal ? ' (personal)' : ''}
              </option>
            ))}
          </select>
        </label>
        <ErrorNote message={error} />
        <SubmitButton label="Create note" busy={busy} />
      </form>
    </Modal>
  )
}
