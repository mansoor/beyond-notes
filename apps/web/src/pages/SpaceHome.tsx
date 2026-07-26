import type { SpaceView } from '@bn/schema'
import { useNavigate, useParams } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { RightDrawer } from '../components'
import { ConceptGraph } from '../graph/ConceptGraph'
import { SpaceActionsPanel } from '../spaces'
import { trpc } from '../trpc'

/**
 * A space's landing page: its concept graph in the content area, a quick menu of
 * the space's pages and top concepts in the right rail. Reached by single-
 * clicking a space name in the sidebar.
 *
 * When the space has no pages it falls back to the old empty state (the same
 * "add a page" prompt that used to live here), so deleting the last page still
 * lands somewhere sensible.
 */
export function SpaceHomePage() {
  const { spaceId } = useParams({ from: '/app/space/$spaceId' })
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const spaces = trpc.spaces.list.useQuery()
  const tree = trpc.pages.tree.useQuery({ spaceId })
  const graph = trpc.spaces.graph.useQuery({ spaceId })
  const create = trpc.pages.create.useMutation()

  const [railOpen, setRailOpen] = useState(false)
  const space = (spaces.data ?? []).find((s) => s.id === spaceId)
  const pages = tree.data ?? []

  const addPage = async () => {
    const page = await create.mutateAsync({ spaceId, parentId: null, title: '' })
    await utils.pages.tree.invalidate({ spaceId })
    navigate({ to: '/p/$pageId', params: { pageId: page.id } })
  }

  // ---- empty space: the old fallback ----
  if (tree.isSuccess && pages.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-10 py-16">
        <h1 className="text-xl font-semibold mb-1">{space?.name ?? 'Empty'}</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
          empty —{' '}
          <button
            type="button"
            className="underline"
            onClick={addPage}
            disabled={create.isPending}
            style={{ color: 'var(--accent)' }}
          >
            add a page
          </button>
        </p>
        {create.error && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {create.error.message}
          </p>
        )}
      </div>
    )
  }

  const g = graph.data
  const concepts = (g?.nodes ?? [])
    .filter((n) => n.kind === 'concept')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 16)
  const hasEdges = (g?.edges.length ?? 0) > 0
  const rail = space ? (
    <RailContent space={space} concepts={concepts} g={g} hasEdges={hasEdges} />
  ) : null

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-screen">
      <header className="px-6 pt-6 pb-3 flex items-center gap-3 shrink-0">
        <h1 className="text-lg font-semibold truncate">{space?.name ?? 'Space'}</h1>
        {g && (
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {[
              `${g.pageCount} ${g.pageCount === 1 ? 'page' : 'pages'}`,
              g.linkCount > 0 && `${g.linkCount} links`,
              g.semanticCount > 0 && `${g.semanticCount} similar`,
              g.tagCount > 0 && `${g.tagCount} tags`,
              `${g.conceptCount} concepts`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {/* rail is a fixed right column on lg; below that it opens as a drawer */}
        <button
          type="button"
          title="Space menu"
          aria-label="Space menu"
          onClick={() => setRailOpen(true)}
          className="lg:hidden ml-auto w-9 h-9 flex items-center justify-center rounded-md border shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          <span className="msym" style={{ fontSize: 20 }}>
            right_panel_open
          </span>
        </button>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 relative">
          {graph.isLoading && (
            <div
              className="absolute inset-0 flex items-center justify-center text-sm"
              style={{ color: 'var(--text-3)' }}
            >
              Reading the notes…
            </div>
          )}
          {g && !hasEdges && (
            <div
              className="absolute inset-0 flex items-center justify-center text-center px-8"
              style={{ color: 'var(--text-3)' }}
            >
              <p className="max-w-sm text-sm">
                Nothing connects these pages yet. Link them with [[…]], share a #tag, or let them
                grow to repeat the same words — connections show up here.
              </p>
            </div>
          )}
          {g && hasEdges && <ConceptGraph nodes={g.nodes} edges={g.edges} />}
        </div>

        <aside
          className="w-72 shrink-0 border-l overflow-y-auto px-5 py-8 hidden lg:block"
          style={{ borderColor: 'var(--border)' }}
        >
          {rail}
        </aside>
      </div>

      {railOpen && (
        <RightDrawer title={space?.name ?? 'Space'} onClose={() => setRailOpen(false)}>
          {rail}
        </RightDrawer>
      )}
    </div>
  )
}

/** The right-rail contents, shared by the desktop column and the mobile drawer. */
function RailContent(props: {
  space: SpaceView
  concepts: Array<{ id: string; label: string; weight: number }>
  g: { tagCount: number; conceptCount: number; linkCount: number; semanticCount: number } | undefined
  hasEdges: boolean
}) {
  const { space, concepts, g, hasEdges } = props
  return (
    <>
      <SpaceActionsPanel space={space} />
      {concepts.length > 0 && (
        <div className="mt-6">
          <h2 className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
            Top concepts
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {concepts.map((c) => (
              <span
                key={c.id}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                title={`in ${c.weight} pages`}
              >
                {c.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {g && hasEdges && <GraphLegend g={g} />}
    </>
  )
}

/** What the dots and lines mean — only the pieces this space actually has. */
function GraphLegend(props: {
  g: { tagCount: number; conceptCount: number; linkCount: number; semanticCount: number }
}) {
  const { g } = props
  const dot = (fill: string, stroke: string) => (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" role="presentation">
      <circle cx="7" cy="7" r="5" fill={fill} stroke={stroke} strokeWidth="1.5" />
    </svg>
  )
  const line = (stroke: string, dash?: string) => (
    <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true" role="presentation">
      <line x1="1" y1="4" x2="17" y2="4" stroke={stroke} strokeWidth="1.6" strokeDasharray={dash} />
    </svg>
  )
  const rows: Array<[ReactNode, string] | false> = [
    [dot('var(--accent)', 'var(--accent)'), 'Page'],
    g.tagCount > 0 && [dot('var(--accent-soft)', 'var(--accent)'), 'Tag'],
    g.conceptCount > 0 && [dot('var(--panel)', 'var(--text-3)'), 'Concept'],
    g.linkCount > 0 && [line('var(--accent)'), 'Links to'],
    g.semanticCount > 0 && [line('var(--live)', '1 4'), 'Similar meaning'],
    g.tagCount > 0 && [line('var(--text-3)', '4 3'), 'Shares a tag'],
    g.conceptCount > 0 && [line('var(--border)'), 'Shares a concept'],
  ]
  return (
    <div className="mt-6">
      <h2 className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
        Legend
      </h2>
      <div className="flex flex-col gap-1.5">
        {rows.filter((r): r is [ReactNode, string] => r !== false).map(([mark, label]) => (
          <div key={label} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
            <span className="w-[18px] flex justify-center">{mark}</span>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

