/**
 * The wiki importer's two-step dialog: choose a source, then review the proposed
 * structure before anything is written. Every row can be renamed, re-nested,
 * reordered or dropped — the plan the user approves is exactly what gets
 * created, which is why the preview call writes nothing.
 */

import type { ImportNodePlan, ImportPlanView, MergeMap, SpaceView } from '@bn/schema'
import { foldMergedNodes } from '@bn/schema'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useRef, useState } from 'react'
import { ErrorNote, Modal, SubmitButton, useSubmit } from './components'
import { trpc } from './trpc'

type Source = 'markdown' | 'github'

export function ImportModal(props: { space?: SpaceView; onClose: () => void }) {
  const [plan, setPlan] = useState<ImportPlanView | null>(null)
  return (
    <Modal
      title={props.space ? `Import into ${props.space.name}` : 'Import a wiki'}
      onClose={props.onClose}
      dirty={plan !== null}
      width="lg"
    >
      {plan ? (
        <ReviewStep
          plan={plan}
          space={props.space}
          onBack={() => setPlan(null)}
          onClose={props.onClose}
        />
      ) : (
        <SourceStep onPlan={setPlan} />
      )}
    </Modal>
  )
}

// ---- step 1: where the content comes from ----

function SourceStep(props: { onPlan: (plan: ImportPlanView) => void }) {
  const [source, setSource] = useState<Source>('github')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [includeDocs, setIncludeDocs] = useState(true)
  const [markdown, setMarkdown] = useState('')
  const [filename, setFilename] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const fromMarkdown = trpc.imports.previewMarkdown.useMutation()
  const fromGithub = trpc.imports.previewGithub.useMutation()

  const { busy, error, onSubmit } = useSubmit(async () => {
    const plan =
      source === 'github'
        ? await fromGithub.mutateAsync({ url, token, includeDocs })
        : await fromMarkdown.mutateAsync({ markdown, filename })
    props.onPlan(plan)
  })

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setMarkdown(await file.text())
    setFilename(file.name)
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="flex gap-1 mb-4">
        {(['github', 'markdown'] as Source[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{
              borderColor: source === s ? 'var(--accent)' : 'var(--border)',
              color: source === s ? 'var(--accent)' : 'var(--text-2)',
            }}
          >
            {s === 'github' ? 'GitHub repository' : 'Markdown file'}
          </button>
        ))}
      </div>

      {source === 'github' ? (
        <>
          <label className="block mb-3">
            <span className="block text-sm font-medium mb-1">Repository URL</span>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </label>
          <label className="flex items-center gap-2 mb-3 text-sm">
            <input
              type="checkbox"
              checked={includeDocs}
              onChange={(e) => setIncludeDocs(e.target.checked)}
            />
            Also read markdown under <code>docs/</code>
          </label>
          <details className="mb-4">
            <summary className="text-sm cursor-pointer" style={{ color: 'var(--text-2)' }}>
              Private repository?
            </summary>
            <label className="block mt-2">
              <span className="block text-sm font-medium mb-1">
                Access token (used for this request only, never stored)
              </span>
              <input
                type="password"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          </details>
        </>
      ) : (
        <>
          <div className="mb-3">
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              Choose a .md file…
            </button>
            {filename ? (
              <span className="ml-2 text-sm" style={{ color: 'var(--text-2)' }}>
                {filename}
              </span>
            ) : null}
          </div>
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">…or paste markdown</span>
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', minHeight: '9rem' }}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
            />
          </label>
        </>
      )}

      <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
        Nothing is created yet — the next step shows the pages this would make, for you to edit and
        approve.
      </p>
      <ErrorNote message={error} />
      <SubmitButton label={busy ? 'Reading…' : 'Scan and preview'} busy={busy} />
    </form>
  )
}

// ---- step 2: review, edit, approve ----

/**
 * A merge the user asked for: this row's content is appended to `target`
 * instead of becoming a page. `shifted`/`delta` record what the merge did to
 * the row's children so unmerging can put them back exactly.
 */
type Merge = { target: string; shifted: string[]; delta: number }

function ReviewStep(props: {
  plan: ImportPlanView
  space?: SpaceView
  onBack: () => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const apply = trpc.imports.create.useMutation()
  const spaces = trpc.spaces.list.useQuery()

  const [nodes, setNodes] = useState<ImportNodePlan[]>(props.plan.nodes)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [merges, setMerges] = useState<Record<string, Merge>>({})
  const [name, setName] = useState(props.plan.suggestedName)
  const [publish, setPublish] = useState(false)
  const [archiveExisting, setArchiveExisting] = useState(false)
  const [withImages, setWithImages] = useState((props.plan.imageCount ?? 0) > 0)
  const [targetId, setTargetId] = useState<string>(props.space?.id ?? '')

  // what the target space already holds, so "archive first" can say how much
  const existing = trpc.pages.tree.useQuery({ spaceId: targetId }, { enabled: targetId !== '' })
  const existingCount = targetId === '' ? 0 : (existing.data?.length ?? 0)

  const titleOf = (key: string) => nodes.find((n) => n.key === key)?.title ?? 'a page'
  const isMerged = (key: string) => Boolean(merges[key])
  const included = nodes.filter((n) => !skipped.has(n.key) && !isMerged(n.key))

  const patch = (key: string, change: Partial<ImportNodePlan>) =>
    setNodes((list) => list.map((n) => (n.key === key ? { ...n, ...change } : n)))

  const move = (index: number, delta: number) =>
    setNodes((list) => {
      const next = [...list]
      const target = index + delta
      if (target < 0 || target >= next.length) return list
      const [row] = next.splice(index, 1)
      if (row) next.splice(target, 0, row)
      return next
    })

  /** The row a merge would fold into: the nearest live row above this one. */
  const mergeTargetAt = (index: number): ImportNodePlan | null => {
    for (let i = index - 1; i >= 0; i--) {
      const prev = nodes[i]
      if (prev && !skipped.has(prev.key) && !isMerged(prev.key)) return prev
    }
    return null
  }

  /** Rows nested under this one — they outlive the merge and re-parent to the target. */
  const descendantsOf = (index: number): ImportNodePlan[] => {
    const node = nodes[index]
    if (!node) return []
    const out: ImportNodePlan[] = []
    for (let i = index + 1; i < nodes.length; i++) {
      const next = nodes[i]
      if (!next || next.level <= node.level) break
      out.push(next)
    }
    return out
  }

  const mergeRow = (index: number) => {
    const node = nodes[index]
    const target = mergeTargetAt(index)
    if (!node || !target) return
    const delta = target.level - node.level
    const shifted = descendantsOf(index).map((d) => d.key)
    setNodes((list) =>
      list.map((n) =>
        shifted.includes(n.key) ? { ...n, level: Math.max(0, n.level + delta) } : n,
      ),
    )
    setMerges((m) => ({ ...m, [node.key]: { target: target.key, shifted, delta } }))
  }

  const unmergeRow = (key: string) => {
    const record = merges[key]
    if (!record) return
    setNodes((list) =>
      list.map((n) =>
        record.shifted.includes(n.key) ? { ...n, level: Math.max(0, n.level - record.delta) } : n,
      ),
    )
    setMerges((m) => {
      const next = { ...m }
      delete next[key]
      return next
    })
  }

  // a page can only ever be one level deeper than the row above it
  const maxLevelAt = (index: number) => {
    const target = mergeTargetAt(index)
    return target ? target.level + 1 : 0
  }

  const { busy, error, onSubmit } = useSubmit(async () => {
    // fold merges here, once: until now they were an intent the user could undo
    const mergeMap: MergeMap = {}
    for (const [key, record] of Object.entries(merges)) mergeMap[key] = record.target
    const folded = foldMergedNodes(
      nodes.filter((n) => !skipped.has(n.key)),
      mergeMap,
    )
    const result = await apply.mutateAsync({
      ...(targetId ? { spaceId: targetId } : { newSpaceName: name.trim() || 'Imported wiki' }),
      category: 'wiki',
      personal: false,
      publish,
      archiveExisting: targetId !== '' && archiveExisting,
      importImages: withImages,
      imageBase: props.plan.imageBase ?? null,
      nodes: folded.map((n) => ({ ...n, level: Math.min(n.level, 6) })),
    })
    await utils.spaces.list.invalidate()
    await utils.pages.tree.invalidate()
    props.onClose()
    if (result.firstPageId) navigate({ to: '/p/$pageId', params: { pageId: result.firstPageId } })
  })

  const mergedCount = Object.keys(merges).length

  return (
    <form onSubmit={onSubmit}>
      <p className="text-sm mb-1" style={{ color: 'var(--text-2)' }}>
        Read <b>{props.plan.sourceLabel}</b> — {included.length} page
        {included.length === 1 ? '' : 's'} to create
        {mergedCount > 0 ? `, ${mergedCount} merged in` : ''}.
      </p>
      {props.plan.warnings.map((w) => (
        <p key={w} className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
          {w}
        </p>
      ))}

      <div
        className="rounded-lg border my-3 overflow-y-auto"
        style={{ borderColor: 'var(--border)', maxHeight: '22rem' }}
      >
        {nodes.map((node, index) => {
          const merged = merges[node.key]
          const off = skipped.has(node.key)
          if (merged) {
            return (
              <div
                key={node.key}
                className="flex items-center gap-2 px-2 py-1.5 border-b last:border-b-0 text-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                <span style={{ width: '16px' }} />
                <span style={{ width: `${node.level * 16}px` }} />
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-3)' }}>
                  ↳ <s>{node.title}</s> — merged into <b>{titleOf(merged.target)}</b>
                </span>
                <RowBtn
                  label="undo"
                  title="Keep as its own page"
                  onClick={() => unmergeRow(node.key)}
                />
              </div>
            )
          }
          return (
            <div
              key={node.key}
              className="flex items-center gap-2 px-2 py-1.5 border-b last:border-b-0"
              style={{ borderColor: 'var(--border)', opacity: off ? 0.45 : 1 }}
            >
              <input
                type="checkbox"
                checked={!off}
                title="Include this page"
                onChange={(e) =>
                  setSkipped((set) => {
                    const next = new Set(set)
                    if (e.target.checked) next.delete(node.key)
                    else next.add(node.key)
                    return next
                  })
                }
              />
              <span style={{ width: `${node.level * 16}px` }} />
              <input
                className="flex-1 min-w-0 rounded border px-2 py-1 text-sm"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                value={node.title}
                onChange={(e) => patch(node.key, { title: e.target.value })}
              />
              <span
                className="text-[11px] truncate hidden sm:block"
                style={{ color: 'var(--text-3)', maxWidth: '12rem' }}
                title={node.excerpt}
              >
                {node.path ?? node.excerpt}
              </span>
              <RowBtn
                label={
                  <span className="msym" style={{ fontSize: 15, lineHeight: 1 }}>
                    merge
                  </span>
                }
                title={
                  mergeTargetAt(index)
                    ? `Merge into “${mergeTargetAt(index)?.title}” — its text is appended there instead of becoming a page`
                    : 'Nothing above to merge into'
                }
                disabled={!mergeTargetAt(index) || off}
                onClick={() => mergeRow(index)}
              />
              <RowBtn
                label="⇤"
                title="Outdent"
                disabled={node.level === 0}
                onClick={() => patch(node.key, { level: Math.max(0, node.level - 1) })}
              />
              <RowBtn
                label="⇥"
                title="Indent — nest under the page above"
                disabled={node.level >= maxLevelAt(index)}
                onClick={() => patch(node.key, { level: node.level + 1 })}
              />
              <RowBtn
                label="↑"
                title="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              />
              <RowBtn
                label="↓"
                title="Move down"
                disabled={index === nodes.length - 1}
                onClick={() => move(index, 1)}
              />
            </div>
          )
        })}
      </div>

      <label className="block mb-3">
        <span className="block text-sm font-medium mb-1">Destination</span>
        <select
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        >
          <option value="">Create a new wiki</option>
          {(spaces.data ?? [])
            .filter((s) => s.category === 'wiki' || s.category === 'notebook')
            .map((s) => (
              <option key={s.id} value={s.id}>
                Add to “{s.name}”
              </option>
            ))}
        </select>
      </label>

      {targetId === '' ? (
        <label className="block mb-3">
          <span className="block text-sm font-medium mb-1">New wiki name</span>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      ) : null}

      {existingCount > 0 ? (
        <>
          <label className="flex items-center gap-2 mb-1 text-sm">
            <input
              type="checkbox"
              checked={archiveExisting}
              onChange={(e) => setArchiveExisting(e.target.checked)}
            />
            Archive the {existingCount} page{existingCount === 1 ? '' : 's'} already in this space
          </label>
          <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
            {archiveExisting
              ? 'The old pages move to Archive — nothing is deleted, published versions are kept, and you can restore any of them.'
              : 'The imported pages are added alongside what is already there.'}
          </p>
        </>
      ) : null}

      {(props.plan.imageCount ?? 0) > 0 ? (
        <>
          <label className="flex items-center gap-2 mb-1 text-sm">
            <input
              type="checkbox"
              checked={withImages}
              onChange={(e) => setWithImages(e.target.checked)}
            />
            Bring the {props.plan.imageCount} image
            {props.plan.imageCount === 1 ? '' : 's'} too
          </label>
          <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
            {withImages
              ? 'Each one is downloaded and stored here like any other upload, so the pages keep working if the repository moves or goes private. This takes a moment.'
              : 'Image links are left pointing at the source. Relative paths in a README will not resolve.'}
          </p>
        </>
      ) : null}

      <label className="flex items-center gap-2 mb-1 text-sm">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        Publish every imported page
      </label>
      <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
        {publish
          ? 'Each page is published on arrival — it goes live as soon as the space itself is public.'
          : 'Pages arrive as drafts. Nothing is public until you publish it.'}
      </p>

      <ErrorNote message={error} />
      <div className="flex items-center gap-2">
        <SubmitButton
          label={
            busy
              ? 'Importing…'
              : `Import ${included.length} page${included.length === 1 ? '' : 's'}`
          }
          busy={busy || included.length === 0}
        />
        <button
          type="button"
          onClick={props.onBack}
          className="text-sm px-3 py-2"
          style={{ color: 'var(--text-2)' }}
        >
          Back
        </button>
      </div>
    </form>
  )
}

function RowBtn(props: {
  label: ReactNode
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="text-xs px-1.5 py-0.5 rounded"
      style={{ color: 'var(--text-3)', opacity: props.disabled ? 0.3 : 1 }}
    >
      {props.label}
    </button>
  )
}
