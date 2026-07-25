import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ConceptGraph } from '../graph/ConceptGraph'
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

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-screen">
      <header className="px-6 py-3 border-b flex items-baseline gap-3 shrink-0">
        <h1 className="text-lg font-semibold truncate">{space?.name ?? 'Space'}</h1>
        {g && (
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {g.pageCount} {g.pageCount === 1 ? 'page' : 'pages'} · {g.conceptCount} shared concepts
          </span>
        )}
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
                No shared topics yet. As pages grow and start repeating the same words, they'll begin
                to connect here.
              </p>
            </div>
          )}
          {g && hasEdges && <ConceptGraph nodes={g.nodes} edges={g.edges} />}
        </div>

        <aside
          className="w-64 border-l overflow-y-auto p-4 hidden md:block shrink-0"
          style={{ background: 'var(--panel)' }}
        >
          <SpaceMenu spaceId={spaceId} />
          {concepts.length > 0 && (
            <div className="mt-6">
              <h2
                className="text-[11px] uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-3)' }}
              >
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
        </aside>
      </div>
    </div>
  )
}

/** The space's pages, in tree order, as quick links — the "space menu". */
function SpaceMenu(props: { spaceId: string }) {
  const tree = trpc.pages.tree.useQuery({ spaceId: props.spaceId })
  const byId = new Map((tree.data ?? []).map((p) => [p.id, p]))
  const depthOf = (p: { parentId: string | null }): number => {
    let d = 0
    let cur = p.parentId
    while (cur && byId.has(cur)) {
      d++
      cur = byId.get(cur)?.parentId ?? null
    }
    return d
  }

  return (
    <div>
      <h2 className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
        Pages
      </h2>
      <div className="flex flex-col">
        {(tree.data ?? []).map((p) => (
          <Link
            key={p.id}
            to="/p/$pageId"
            params={{ pageId: p.id }}
            className="text-sm py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 truncate"
            style={{ color: 'var(--text-2)', paddingLeft: `${depthOf(p) * 12}px` }}
          >
            {p.icon ? `${p.icon} ` : ''}
            {p.title.trim() || 'Untitled'}
          </Link>
        ))}
      </div>
    </div>
  )
}
