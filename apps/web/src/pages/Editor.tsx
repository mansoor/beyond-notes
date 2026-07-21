import type { PageMeta, PublishingView, SpaceCategory } from '@bn/schema'
import { pageTypesByCategory } from '@bn/schema'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconPicker, Modal, TimeField } from '../components'
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
  // the live document, seeded from the load and updated in place on each save
  // (never via a refetch — see DocumentEditor.onSaved)
  const [content, setContent] = useState(props.doc.content)

  const commitTitle = async () => {
    const next = title.trim() || 'Untitled'
    setTitle(next)
    if (next !== props.page.title) {
      await rename.mutateAsync({ pageId: props.page.id, title: next })
      await utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
    }
  }

  // same skeleton as the Today page: content centered in the remaining
  // space, rail as a full-height right column behind a vertical separator
  return (
    <div className="flex min-h-screen">
      <div className="flex-1 min-w-0 max-w-5xl mx-auto px-10 py-8">
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
          <ContextDrawerButton page={props.page} publishing={props.publishing} />
        </div>
        <TemplatePicker page={props.page} doc={props.doc} />
        <DocumentEditor
          pageId={props.page.id}
          doc={props.doc}
          onSaved={setContent}
          onStateChange={(s) => {
            setState(s)
            // a save may have changed inline #tags or @-links — refresh the rail
            if (s === 'saved') {
              utils.tags.forPage.invalidate({ pageId: props.page.id })
              utils.pages.backlinks.invalidate()
            }
          }}
          onReload={() => utils.pages.get.invalidate({ pageId: props.page.id })}
        />
        <MermaidPreview content={content} />
        {props.page.pageType === 'gallery' && <GalleryManager page={props.page} />}
      </div>
      <aside
        className="w-72 shrink-0 border-l px-5 py-8 hidden lg:block"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="sticky top-8">
          <ContextPanel page={props.page} publishing={props.publishing} />
        </div>
      </aside>
    </div>
  )
}

/** On narrow windows the rail folds into a drawer behind this button. */
function ContextDrawerButton(props: { page: PageMeta; publishing: PublishingView }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="lg:hidden">
      <button
        type="button"
        title="Page context"
        onClick={() => setOpen(true)}
        className="rounded-md border px-2 py-1 text-sm"
        style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
      >
        ⚙
      </button>
      {open && (
        <Modal title="Page context" onClose={() => setOpen(false)}>
          <ContextPanel page={props.page} publishing={props.publishing} bare />
        </Modal>
      )}
    </span>
  )
}

/**
 * The context rail — the WordPress-post model: status, type, tags, and
 * per-type options always visible, saved as they change. Every future
 * per-page setting (SEO description, schedule, backlinks) lands here.
 */
function ContextPanel(props: { page: PageMeta; publishing: PublishingView; bare?: boolean }) {
  const spaces = trpc.spaces.list.useQuery()
  const space = spaces.data?.find((s) => s.id === props.page.spaceId)
  const category: SpaceCategory = space?.category ?? 'notebook'
  const isSite = category === 'site'
  const isGallery = props.page.pageType === 'gallery'

  return (
    <div className="flex flex-col gap-4">
      <ContextCard bare={props.bare} title="Status">
        <StatusSection page={props.page} publishing={props.publishing} />
      </ContextCard>
      {pageTypesByCategory[category].length > 1 && (
        <ContextCard bare={props.bare} title="Page type">
          <TypeSection page={props.page} category={category} />
        </ContextCard>
      )}
      <ContextCard bare={props.bare} title="Icon">
        <IconSection page={props.page} />
      </ContextCard>
      <ContextCard bare={props.bare} title="Tags">
        <TagsSection pageId={props.page.id} />
      </ContextCard>
      <BacklinksCard pageId={props.page.id} bare={props.bare} />
      {(isSite || isGallery) && (
        <ContextCard bare={props.bare} title={isGallery ? 'Gallery' : 'Sharing & listing'}>
          <OptionsSection page={props.page} isSite={isSite} />
          <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
            Layout, autoplay, and images apply on the next publish; the share toggle applies
            immediately.
          </p>
        </ContextCard>
      )}
      {isSite && (
        <ContextCard bare={props.bare} title="Search & social">
          <SeoSection page={props.page} />
        </ContextCard>
      )}
      {space?.publicEnabled && (
        <ContextCard bare={props.bare} title="Share a draft">
          <PreviewSection pageId={props.page.id} />
        </ContextCard>
      )}
    </div>
  )
}

/** Per-page emoji, shown in the app sidebar and the published wiki/site nav. */
function IconSection(props: { page: PageMeta }) {
  const utils = trpc.useUtils()
  const update = trpc.pages.updateOptions.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.pages.get.invalidate({ pageId: props.page.id }),
        utils.pages.tree.invalidate({ spaceId: props.page.spaceId }),
      ]),
  })
  return (
    <IconPicker
      value={props.page.icon}
      onPick={(icon) => update.mutate({ pageId: props.page.id, icon })}
    />
  )
}

/** The og/meta description used when the page is shared or indexed. */
function SeoSection(props: { page: PageMeta }) {
  const utils = trpc.useUtils()
  const update = trpc.pages.updateOptions.useMutation({
    onSuccess: () => utils.pages.get.invalidate({ pageId: props.page.id }),
  })
  const [text, setText] = useState(props.page.metaDescription ?? '')
  const dirty = text !== (props.page.metaDescription ?? '')
  return (
    <div>
      <textarea
        className="w-full rounded-lg border px-3 py-2 text-xs"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        rows={3}
        maxLength={300}
        placeholder="Description for search results and link previews…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (dirty) update.mutate({ pageId: props.page.id, metaDescription: text.trim() || null })
        }}
      />
      <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
        {text.length}/300 · falls back to the opening text. Applies on the next publish.
      </p>
    </div>
  )
}

/**
 * Tokened links to the working copy — the way to show an unpublished page to
 * someone without putting it on the site.
 */
function PreviewSection(props: { pageId: string }) {
  const utils = trpc.useUtils()
  const previews = trpc.publish.previews.useQuery({ pageId: props.pageId })
  const invalidate = () => utils.publish.previews.invalidate({ pageId: props.pageId })
  const create = trpc.publish.createPreview.useMutation({ onSuccess: invalidate })
  const revoke = trpc.publish.revokePreview.useMutation({ onSuccess: invalidate })
  const [justMade, setJustMade] = useState<string | null>(null)

  return (
    <div className="text-sm">
      {justMade && (
        <div className="mb-2">
          <input
            readOnly
            className="w-full rounded-lg border px-2 py-1 text-xs"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={justMade}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            Copy it now — the link is only shown once.
          </p>
        </div>
      )}
      {previews.data?.map((p, i) => (
        <div key={p.id} className="flex items-center gap-2 py-0.5 text-xs">
          <span style={{ color: 'var(--text-2)' }}>
            Link {i + 1} · {new Date(p.createdAt).toLocaleDateString()}
          </span>
          <button
            type="button"
            className="ml-auto underline"
            style={{ color: 'var(--danger)' }}
            onClick={() => revoke.mutate({ pageId: props.pageId, previewId: p.id })}
          >
            revoke
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs underline mt-1"
        style={{ color: 'var(--text-2)' }}
        disabled={create.isPending}
        onClick={async () => {
          const res = await create.mutateAsync({ pageId: props.pageId })
          setJustMade(res.url)
        }}
      >
        + create preview link
      </button>
    </div>
  )
}

/**
 * Diagrams for `mermaid` code blocks. The editor shows the source; this
 * renders it underneath so you can see what you are writing. Uses the same
 * self-hosted library the published pages load, so what you see here is what
 * readers get.
 */
function MermaidPreview(props: { content: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  // stable per document text, so the render effect fires only when a diagram's
  // source actually changes — not on every keystroke elsewhere in the page
  const sources: string[] = useMemo(() => {
    try {
      const blocks = JSON.parse(props.content)
      if (!Array.isArray(blocks)) return []
      const out: string[] = []
      const walk = (list: unknown[]) => {
        for (const b of list as Array<Record<string, any>>) {
          if (
            b?.type === 'codeBlock' &&
            String(b?.props?.language ?? '').toLowerCase() === 'mermaid'
          ) {
            const text = (b.content ?? [])
              .map((c: { text?: string }) => (typeof c?.text === 'string' ? c.text : ''))
              .join('')
            if (text.trim()) out.push(text)
          }
          if (Array.isArray(b?.children)) walk(b.children)
        }
      }
      walk(blocks)
      return out
    } catch {
      return []
    }
  }, [props.content])

  useEffect(() => {
    const host = hostRef.current
    if (!host || sources.length === 0) return
    let cancelled = false
    const render = async () => {
      const w = window as unknown as { mermaid?: any }
      if (!w.mermaid) {
        await new Promise<void>((res, rej) => {
          const sc = document.createElement('script')
          sc.src = '/api/assets/mermaid.js'
          sc.onload = () => res()
          sc.onerror = () => rej(new Error('mermaid unavailable'))
          document.head.appendChild(sc)
        })
      }
      const dark = document.documentElement.classList.contains('dark')
      w.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
      })
      host.innerHTML = ''
      for (const [i, src] of sources.entries()) {
        const box = document.createElement('div')
        box.className = 'mermaid-box'
        try {
          const { svg } = await w.mermaid.render(`bn-d-${i}-${Date.now()}`, src)
          if (cancelled) return
          box.innerHTML = svg
        } catch (err) {
          // a half-typed diagram is normal — say so instead of blanking out
          box.textContent = err instanceof Error ? err.message : 'Diagram could not be drawn yet'
          box.setAttribute('data-bad', '1')
        }
        host.appendChild(box)
      }
    }
    render().catch(() => setFailed(true))
    return () => {
      cancelled = true
    }
  }, [sources])

  if (sources.length === 0) return null
  return (
    <section className="mt-8">
      <h3
        className="text-xs uppercase tracking-wide font-semibold mb-3"
        style={{ color: 'var(--text-3)' }}
      >
        Diagrams — {sources.length}
      </h3>
      {failed ? (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          Could not load the diagram library from this instance.
        </p>
      ) : (
        <div ref={hostRef} className="mermaidhost flex flex-col gap-4" />
      )}
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Rendered from your <code>mermaid</code> code blocks; readers see the same drawing.
      </p>
    </section>
  )
}

/** "Linked from" — pages whose text @-mentions this one. Hidden when empty. */
function BacklinksCard(props: { pageId: string; bare?: boolean }) {
  const backlinks = trpc.pages.backlinks.useQuery({ pageId: props.pageId })
  const navigate = useNavigate()
  if (!backlinks.data || backlinks.data.length === 0) return null
  return (
    <ContextCard bare={props.bare} title="Linked from">
      <div className="flex flex-col text-sm">
        {backlinks.data.map((b) => (
          <button
            key={b.id}
            type="button"
            className="text-left py-0.5"
            onClick={() => navigate({ to: '/p/$pageId', params: { pageId: b.id } })}
          >
            <span className="block truncate" style={{ color: 'var(--accent)' }}>
              {b.title}
            </span>
            <span className="block truncate text-xs" style={{ color: 'var(--text-3)' }}>
              {b.spaceName}
            </span>
          </button>
        ))}
      </div>
    </ContextCard>
  )
}

/**
 * An empty page offers the saved templates as starting points. Applying one
 * is an ordinary save, so the optimistic lock still guards it.
 */
function TemplatePicker(props: { page: PageMeta; doc: { content: string; updatedAt: string } }) {
  const utils = trpc.useUtils()
  const templates = trpc.templates.list.useQuery()
  const save = trpc.pages.saveDoc.useMutation({
    onSuccess: () => utils.pages.get.invalidate({ pageId: props.page.id }),
  })
  const isEmpty = (() => {
    try {
      const blocks = JSON.parse(props.doc.content)
      return !Array.isArray(blocks) || blocks.length === 0
    } catch {
      return false
    }
  })()
  if (!isEmpty || !templates.data || templates.data.length === 0) return null

  const apply = async (id: string) => {
    const { content } = await utils.client.templates.content.query({ id })
    await save.mutateAsync({
      pageId: props.page.id,
      content,
      baseUpdatedAt: props.doc.updatedAt,
    })
  }

  return (
    <div
      className="flex items-center gap-2 flex-wrap mb-3 text-xs"
      style={{ color: 'var(--text-3)' }}
    >
      Start from a template:
      {templates.data.map((tpl) => (
        <button
          key={tpl.id}
          type="button"
          disabled={save.isPending}
          onClick={() => apply(tpl.id)}
          className="rounded-full border px-2.5 py-0.5"
          style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
        >
          {tpl.name}
        </button>
      ))}
    </div>
  )
}

function ContextCard(props: { title: string; bare?: boolean; children: React.ReactNode }) {
  return (
    <section
      className={props.bare ? 'mb-1' : 'rounded-xl border p-4'}
      style={props.bare ? undefined : { borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      <h3
        className="text-[11px] uppercase tracking-wide font-semibold mb-2.5"
        style={{ color: 'var(--text-3)' }}
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  )
}

function StatusSection(props: { page: PageMeta; publishing: PublishingView }) {
  const utils = trpc.useUtils()
  const publish = trpc.publish.publish.useMutation({
    onSuccess: () => utils.pages.get.invalidate({ pageId: props.page.id }),
  })
  const pins = trpc.pins.list.useQuery()
  const togglePin = trpc.pins.toggle.useMutation({ onSuccess: () => utils.pins.list.invalidate() })
  const pinned = pins.data?.some((p) => p.pageId === props.page.id) ?? false
  const [history, setHistory] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState<string | null>('09:00')
  const invalidatePage = () => utils.pages.get.invalidate({ pageId: props.page.id })
  const schedule = trpc.publish.schedule.useMutation({ onSuccess: invalidatePage })
  const cancelSchedule = trpc.publish.cancelSchedule.useMutation({ onSuccess: invalidatePage })
  const p = props.publishing

  const liveUrl =
    p.live && p.spaceEnabled && p.host && p.slugPath ? `/s/${p.host}${p.slugPath}` : null

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        {p.live ? (
          <Pill
            color="var(--live)"
            bg="color-mix(in srgb, var(--live) 12%, transparent)"
            label={`Live · v${p.live.version}`}
          />
        ) : (
          <Pill color="var(--text-3)" bg="var(--accent-soft)" label="Draft" />
        )}
        <button
          type="button"
          title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
          className="ml-auto text-base leading-none"
          style={{ color: pinned ? 'var(--accent)' : 'var(--text-3)' }}
          disabled={togglePin.isPending}
          onClick={() => togglePin.mutate({ pageId: props.page.id })}
        >
          {pinned ? '★' : '☆'}
        </button>
      </div>
      {p.pending && p.live && (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          Working copy has unpublished edits
        </span>
      )}
      {!p.spaceEnabled && p.live && (
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          Site not enabled — configure publishing on the space
        </span>
      )}
      {p.scheduledAt && (
        <span className="text-xs" style={{ color: 'var(--accent)' }}>
          Publishes{' '}
          {new Date(p.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          {' · '}
          <button
            type="button"
            className="underline"
            style={{ color: 'var(--danger)' }}
            onClick={() => cancelSchedule.mutate({ pageId: props.page.id })}
          >
            cancel
          </button>
        </span>
      )}
      <button
        type="button"
        disabled={publish.isPending}
        onClick={() => publish.mutate({ pageId: props.page.id })}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {p.live ? `Publish v${p.live.version + 1}` : 'Publish'}
      </button>
      {scheduling ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              className="rounded-lg border px-2 py-1 text-xs"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              value={schedDate}
              onChange={(e) => setSchedDate(e.target.value)}
            />
            <TimeField value={schedTime} onChange={setSchedTime} defaultOnOpen="09:00" />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!schedDate || schedule.isPending}
              onClick={() => {
                // both are local wall time; Date() reads the combined string as local
                const at = new Date(`${schedDate}T${schedTime ?? '09:00'}`)
                schedule.mutate({ pageId: props.page.id, at: at.toISOString() })
                setScheduling(false)
              }}
              className="rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              Schedule
            </button>
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--text-3)' }}
              onClick={() => setScheduling(false)}
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="text-xs underline self-start"
          style={{ color: 'var(--text-2)' }}
          onClick={() => setScheduling(true)}
        >
          {p.scheduledAt ? 'Reschedule…' : 'Schedule publish…'}
        </button>
      )}
      {schedule.error && (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          {schedule.error.message}
        </span>
      )}
      <div className="flex items-center gap-3">
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
      </div>
      {history && <HistoryModal page={props.page} onClose={() => setHistory(false)} />}
    </div>
  )
}

function TypeSection(props: { page: PageMeta; category: SpaceCategory }) {
  const utils = trpc.useUtils()
  const setType = trpc.pages.setType.useMutation({
    onSuccess: () => {
      utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
      utils.pages.get.invalidate({ pageId: props.page.id })
    },
  })
  const TYPE_LABEL = { doc: 'Page', blog: 'Blog', gallery: 'Gallery' } as const
  return (
    <select
      className="w-full rounded-lg border px-3 py-1.5 text-sm"
      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      value={props.page.pageType}
      disabled={setType.isPending}
      onChange={(e) =>
        setType.mutate({
          pageId: props.page.id,
          pageType: e.target.value as PageMeta['pageType'],
        })
      }
    >
      {pageTypesByCategory[props.category].map((t) => (
        <option key={t} value={t}>
          {TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  )
}

function TagsSection(props: { pageId: string }) {
  const utils = trpc.useUtils()
  const tags = trpc.tags.forPage.useQuery({ pageId: props.pageId })
  const invalidate = () => {
    utils.tags.forPage.invalidate({ pageId: props.pageId })
    utils.tags.all.invalidate()
  }
  const add = trpc.tags.add.useMutation({ onSuccess: invalidate })
  const remove = trpc.tags.remove.useMutation({ onSuccess: invalidate })
  const [draft, setDraft] = useState('')

  const submit = () => {
    const tag = draft.trim().replace(/^#/, '').toLowerCase()
    if (!tag) return
    add.mutate({ pageId: props.pageId, tag })
    setDraft('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.data?.map((t) => (
          <span
            key={t.tag}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              opacity: t.source === 'inline' ? 0.75 : 1,
            }}
            title={t.source === 'inline' ? 'From #tag in the text — edit the text to remove' : ''}
          >
            {t.source === 'inline' ? '#' : ''}
            {t.tag}
            {t.source === 'manual' && (
              <button
                type="button"
                className="leading-none"
                title="Remove tag"
                onClick={() => remove.mutate({ pageId: props.pageId, tag: t.tag })}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {tags.data?.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            No tags yet
          </span>
        )}
      </div>
      <input
        className="w-full rounded-lg border px-3 py-1.5 text-xs"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        placeholder="Add tag ⏎"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />
      {add.error && (
        <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>
          {add.error.message.includes('letters') ? add.error.message : 'Invalid tag'}
        </p>
      )}
    </div>
  )
}

function OptionsSection(props: { page: PageMeta; isSite: boolean }) {
  const utils = trpc.useUtils()
  const update = trpc.pages.updateOptions.useMutation({
    onSuccess: () => utils.pages.get.invalidate({ pageId: props.page.id }),
  })
  const [uploading, setUploading] = useState(false)
  const page = props.page
  const isGallery = page.pageType === 'gallery'
  const stripLayout = page.galleryLayout === 'carousel' || page.galleryLayout === 'filmstrip'
  const isSite = props.isSite

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
    <div className="flex flex-col gap-4 text-sm">
      {isSite && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={page.shareEnabled}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ pageId: page.id, shareEnabled: e.target.checked })}
          />
          Social share buttons on the published page
        </label>
      )}

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

      {!isGallery && isSite && (
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
            <label className="text-xs underline cursor-pointer" style={{ color: 'var(--text-2)' }}>
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
    </div>
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

// word-level LCS diff for the History dialog; capped so huge snapshots stay cheap
const DIFF_CAP = 20_000
type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string }

function wordDiff(oldText: string, newText: string): DiffPart[] {
  const a = oldText.slice(0, DIFF_CAP).split(/(\s+)/).filter(Boolean)
  const b = newText.slice(0, DIFF_CAP).split(/(\s+)/).filter(Boolean)
  const m = a.length
  const n = b.length
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, lcs[i]?.[j + 1] ?? 0)
    }
  }
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push('same', a[i] as string)
      i++
      j++
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      push('removed', a[i] as string)
      i++
    } else {
      push('added', b[j] as string)
      j++
    }
  }
  while (i < m) push('removed', a[i++] as string)
  while (j < n) push('added', b[j++] as string)
  return parts
}

function DiffView(props: { oldText: string; newText: string }) {
  const parts = wordDiff(props.oldText, props.newText)
  if (parts.every((p) => p.kind === 'same')) {
    return (
      <p className="text-xs py-1" style={{ color: 'var(--text-3)' }}>
        No text changes (formatting or images only).
      </p>
    )
  }
  return (
    <div
      className="rounded-lg border p-2 my-1 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
    >
      {parts.map((p, idx) =>
        p.kind === 'same' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static render of a computed diff
          <span key={idx}>{p.text}</span>
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static render of a computed diff
            key={idx}
            style={
              p.kind === 'added'
                ? { background: 'color-mix(in srgb, var(--live) 22%, transparent)' }
                : {
                    background: 'color-mix(in srgb, var(--danger) 18%, transparent)',
                    textDecoration: 'line-through',
                  }
            }
          >
            {p.text}
          </span>
        ),
      )}
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
  const [diffFor, setDiffFor] = useState<string | null>(null)

  return (
    <Modal title="Versions" onClose={props.onClose} width="lg">
      {versions.data?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          Never published.
        </p>
      )}
      <ul className="text-sm mb-4">
        {versions.data?.map((v, idx) => {
          // versions arrive newest-first; the next entry is the previous version
          const prev = versions.data?.[idx + 1]
          return (
            <li
              key={v.id}
              className="py-2 border-b last:border-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
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
                <button
                  type="button"
                  className="text-xs underline"
                  style={{ color: 'var(--text-2)' }}
                  onClick={() => setDiffFor(diffFor === v.id ? null : v.id)}
                >
                  {diffFor === v.id ? 'hide changes' : 'changes'}
                </button>
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
              </div>
              {diffFor === v.id && (
                <DiffView oldText={prev?.textPlain ?? ''} newText={v.textPlain} />
              )}
            </li>
          )
        })}
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
