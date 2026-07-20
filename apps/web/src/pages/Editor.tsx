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
    <div className="max-w-5xl mx-auto px-10 py-8">
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
        <PageSettingsButton page={props.page} />
      </div>
      <DocumentEditor
        pageId={props.page.id}
        doc={props.doc}
        onStateChange={setState}
        onReload={() => utils.pages.get.invalidate({ pageId: props.page.id })}
      />
      {props.page.pageType === 'gallery' && <GalleryManager page={props.page} />}
    </div>
  )
}

/**
 * The one home for per-page settings — the gear next to the save badge.
 * Shows only what applies to this page type; future options land here too.
 */
function PageSettingsButton(props: { page: PageMeta }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title="Page settings"
        onClick={() => setOpen(true)}
        className="rounded-md border px-2 py-1 text-sm"
        style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
      >
        ⚙
      </button>
      {open && <PageSettingsModal page={props.page} onClose={() => setOpen(false)} />}
    </>
  )
}

function PageSettingsModal(props: { page: PageMeta; onClose: () => void }) {
  const utils = trpc.useUtils()
  const update = trpc.pages.updateOptions.useMutation({
    onSuccess: () => utils.pages.get.invalidate({ pageId: props.page.id }),
  })
  const [uploading, setUploading] = useState(false)
  const page = props.page
  const isGallery = page.pageType === 'gallery'
  const stripLayout = page.galleryLayout === 'carousel' || page.galleryLayout === 'filmstrip'

  const uploadCover = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) return
      const json = (await res.json()) as { id: string }
      await update.mutateAsync({ pageId: page.id, coverAttachmentId: json.id })
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal title="Page settings" onClose={props.onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={page.shareEnabled}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ pageId: page.id, shareEnabled: e.target.checked })}
          />
          Social share buttons on the published page
        </label>

        {isGallery && (
          <>
            <label className="block">
              <span className="block font-medium mb-1">Gallery layout</span>
              <select
                className="w-full rounded-lg border px-3 py-2"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                value={page.galleryLayout}
                onChange={(e) =>
                  update.mutate({
                    pageId: page.id,
                    galleryLayout: e.target.value as PageMeta['galleryLayout'],
                  })
                }
              >
                {LAYOUTS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            {stripLayout && (
              <label className="flex items-center gap-2 flex-wrap">
                <input
                  type="checkbox"
                  checked={page.galleryAutoplaySecs !== null}
                  onChange={(e) =>
                    update.mutate({
                      pageId: page.id,
                      galleryAutoplaySecs: e.target.checked ? 5 : null,
                    })
                  }
                />
                Auto-rotate every
                <input
                  type="number"
                  min={2}
                  max={60}
                  className="w-16 rounded-lg border px-2 py-1"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  disabled={page.galleryAutoplaySecs === null}
                  value={page.galleryAutoplaySecs ?? 5}
                  onChange={(e) => {
                    const n = Math.min(60, Math.max(2, Number(e.target.value) || 5))
                    update.mutate({ pageId: page.id, galleryAutoplaySecs: n })
                  }}
                />
                seconds
              </label>
            )}
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              The cover image is picked on a photo in the gallery below (hover → Set cover).
            </p>
          </>
        )}

        {!isGallery && (
          <div>
            <span className="block font-medium mb-1">Listing image (shown in blog lists)</span>
            {page.coverAttachmentId ? (
              <span className="flex items-center gap-2">
                <img
                  src={`/api/files/${page.coverAttachmentId}/thumb`}
                  alt="listing"
                  className="w-14 h-10 object-cover rounded"
                />
                <button
                  type="button"
                  className="text-xs underline"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => update.mutate({ pageId: page.id, coverAttachmentId: null })}
                >
                  remove
                </button>
              </span>
            ) : (
              <label
                className="text-xs underline cursor-pointer"
                style={{ color: 'var(--text-2)' }}
              >
                {uploading ? 'uploading…' : '+ upload image'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => uploadCover(e.target.files)}
                />
              </label>
            )}
          </div>
        )}

        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          Content-affecting settings (layout, autoplay, images) apply to the public site on the next
          publish; the share toggle applies immediately.
        </p>
      </div>
    </Modal>
  )
}

const LAYOUTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'mosaic', label: 'Mosaic' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'filmstrip', label: 'Filmstrip' },
] as const

function GalleryManager(props: { page: PageMeta }) {
  const pageId = props.page.id
  const utils = trpc.useUtils()
  const items = trpc.gallery.list.useQuery({ pageId })
  const invalidate = () => utils.gallery.list.invalidate({ pageId })
  const add = trpc.gallery.add.useMutation({ onSuccess: invalidate })
  const remove = trpc.gallery.remove.useMutation({ onSuccess: invalidate })
  const caption = trpc.gallery.caption.useMutation({ onSuccess: invalidate })
  const options = trpc.pages.updateOptions.useMutation({
    onSuccess: () => utils.pages.get.invalidate({ pageId }),
  })
  const [busy, setBusy] = useState(false)

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: form })
        if (!res.ok) continue
        const json = (await res.json()) as { id: string }
        await add.mutateAsync({ pageId, attachmentId: json.id })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-xs uppercase tracking-wide font-semibold"
          style={{ color: 'var(--text-3)' }}
        >
          Gallery — {items.data?.length ?? 0} images
        </h3>
        <label
          className="rounded-md px-3 py-1 text-xs font-medium text-white cursor-pointer"
          style={{ background: 'var(--accent)', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Uploading…' : '+ Add images'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
      >
        {items.data?.map((item) => (
          <figure key={item.id} className="group relative">
            <img
              src={item.thumbUrl}
              alt={item.caption}
              className="w-full rounded-lg object-cover"
              style={{ aspectRatio: '1' }}
            />
            <button
              type="button"
              title="Remove from gallery"
              className="absolute top-1 right-1 hidden group-hover:block rounded px-1.5 text-xs text-white"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              onClick={() => remove.mutate({ pageId, itemId: item.id })}
            >
              ✕
            </button>
            {props.page.coverAttachmentId === item.attachmentId ? (
              <span
                className="absolute top-1 left-1 rounded px-1.5 text-[10px] font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                COVER
              </span>
            ) : (
              <button
                type="button"
                title="Use as the album cover"
                className="absolute top-1 left-1 hidden group-hover:block rounded px-1.5 text-[10px] text-white"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={() => options.mutate({ pageId, coverAttachmentId: item.attachmentId })}
              >
                Set cover
              </button>
            )}
            <input
              className="w-full mt-1 bg-transparent text-xs outline-none"
              style={{ color: 'var(--text-2)' }}
              placeholder="caption…"
              defaultValue={item.caption}
              onBlur={(e) => {
                if (e.target.value !== item.caption) {
                  caption.mutate({ pageId, itemId: item.id, caption: e.target.value })
                }
              }}
            />
          </figure>
        ))}
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Images are recompressed on upload and GPS metadata is stripped. Layout and cover apply on
        the next publish.
      </p>
    </section>
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
