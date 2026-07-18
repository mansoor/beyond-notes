import type { PageMeta, PublishingView } from '@bn/schema'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { Modal } from '../components'
import { DocumentEditor, SaveBadge, type SaveState } from '../editor'
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
  return (
    <PageView
      key={`${pageId}:${q.data.doc.updatedAt}`}
      page={q.data.page}
      doc={q.data.doc}
      publishing={q.data.publishing}
    />
  )
}

function PageView(props: {
  page: PageMeta
  doc: Parameters<typeof DocumentEditor>[0]['doc']
  publishing: PublishingView
}) {
  const utils = trpc.useUtils()
  const rename = trpc.pages.rename.useMutation()
  const [title, setTitle] = useState(props.page.title)
  const [state, setState] = useState<SaveState>('saved')

  const commitTitle = async () => {
    const next = title.trim() || 'Untitled'
    setTitle(next)
    if (next !== props.page.title) {
      await rename.mutateAsync({ pageId: props.page.id, title: next })
      await utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-10 py-8">
      <PublishBar page={props.page} publishing={props.publishing} />
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
      <DocumentEditor
        pageId={props.page.id}
        doc={props.doc}
        onStateChange={setState}
        onReload={() => utils.pages.get.invalidate({ pageId: props.page.id })}
      />
    </div>
  )
}

function Pill(props: { color: string; bg: string; label: string }) {
  return (
    <span
      className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap"
      style={{ color: props.color, background: props.bg }}
    >
      {props.label}
    </span>
  )
}

function PublishBar(props: { page: PageMeta; publishing: PublishingView }) {
  const utils = trpc.useUtils()
  const publish = trpc.publish.publish.useMutation({
    onSuccess: () => utils.pages.get.invalidate({ pageId: props.page.id }),
  })
  const [history, setHistory] = useState(false)
  const p = props.publishing

  const liveUrl =
    p.live && p.spaceEnabled && p.host && p.slugPath ? `/s/${p.host}${p.slugPath}` : null

  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-2 mb-5 text-sm flex-wrap"
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      {p.live ? (
        <Pill
          color="var(--live)"
          bg="color-mix(in srgb, var(--live) 12%, transparent)"
          label={`Live · v${p.live.version}`}
        />
      ) : (
        <Pill color="var(--text-3)" bg="var(--accent-soft)" label="Draft — not published" />
      )}
      {p.pending && p.live && (
        <Pill
          color="var(--danger)"
          bg="color-mix(in srgb, var(--danger) 10%, transparent)"
          label="Working copy has unpublished edits"
        />
      )}
      {!p.spaceEnabled && p.live && (
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          site not enabled — configure publishing on the space
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline"
            style={{ color: 'var(--text-2)' }}
          >
            View live ↗
          </a>
        )}
        <button
          type="button"
          className="text-xs underline"
          style={{ color: 'var(--text-2)' }}
          onClick={() => setHistory(true)}
        >
          History
        </button>
        <button
          type="button"
          disabled={publish.isPending}
          onClick={() => publish.mutate({ pageId: props.page.id })}
          className="rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {p.live ? `Publish v${p.live.version + 1}` : 'Publish'}
        </button>
      </span>
      {history && <HistoryModal page={props.page} onClose={() => setHistory(false)} />}
    </div>
  )
}

function HistoryModal(props: { page: PageMeta; onClose: () => void }) {
  const utils = trpc.useUtils()
  const versions = trpc.publish.versions.useQuery({ pageId: props.page.id })
  const invalidate = () => {
    utils.pages.get.invalidate({ pageId: props.page.id })
    utils.publish.versions.invalidate({ pageId: props.page.id })
  }
  const republish = trpc.publish.republish.useMutation({ onSuccess: invalidate })
  const retire = trpc.publish.retire.useMutation({ onSuccess: invalidate })
  const anyLive = versions.data?.some((v) => v.isLive) ?? false

  return (
    <Modal title="Versions" onClose={props.onClose}>
      {versions.data?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          Never published.
        </p>
      )}
      <ul className="text-sm mb-4">
        {versions.data?.map((v) => (
          <li
            key={v.id}
            className="flex items-center gap-2 py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <span
              className="font-mono text-xs rounded px-1.5"
              style={{ background: 'var(--accent-soft)' }}
            >
              v{v.version}
            </span>
            <span className="truncate flex-1">{v.title}</span>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {new Date(v.createdAt).toLocaleDateString()}
            </span>
            {v.isLive ? (
              <span className="text-xs font-semibold" style={{ color: 'var(--live)' }}>
                live
              </span>
            ) : (
              <button
                type="button"
                className="text-xs underline"
                style={{ color: 'var(--accent)' }}
                disabled={republish.isPending}
                onClick={() => republish.mutate({ pageId: props.page.id, versionId: v.id })}
              >
                restore
              </button>
            )}
          </li>
        ))}
      </ul>
      {anyLive && (
        <button
          type="button"
          className="text-xs underline"
          style={{ color: 'var(--danger)' }}
          disabled={retire.isPending}
          onClick={() => retire.mutate({ pageId: props.page.id })}
        >
          Retire page (remove from the site; history is kept)
        </button>
      )}
    </Modal>
  )
}
