/**
 * The interactive concept graph rendered as themed SVG. No canvas, no chart
 * library — one space's graph is small enough that plain SVG nodes are crisp,
 * stylable with our CSS variables, and easy to make accessible.
 *
 * Legibility is the hard part for a dense space, so three things fight the
 * hairball: the layout spaces nodes generously, the view fits the whole graph on
 * load (and a Reset button re-fits), and labels are shown by importance at a
 * level-of-detail that opens up as you zoom in — few words when zoomed out, more
 * as you move closer, and always the one under the pointer and its neighbours.
 */

import { useNavigate } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { type Point, forceLayout } from './forceLayout'

export type GraphNode = {
  id: string
  label: string
  kind: 'page' | 'concept' | 'tag'
  weight: number
  pageId?: string
  icon?: string | null
}
export type GraphEdge = {
  source: string
  target: string
  weight: number
  type: 'concept' | 'tag' | 'link' | 'semantic' | 'relation'
  /** the verb, on 'relation' edges only */
  label?: string
}

const CANVAS = 1000
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const EDGE_STYLE: Record<
  GraphEdge['type'],
  { stroke: string; base: number; dash?: string; opacity: number }
> = {
  link: { stroke: 'var(--accent)', base: 1.6, opacity: 0.75 },
  relation: { stroke: 'var(--text-2)', base: 1.2, opacity: 0.85 },
  semantic: { stroke: 'var(--live)', base: 1.3, dash: '1 4', opacity: 0.7 },
  tag: { stroke: 'var(--text-3)', base: 1, dash: '4 3', opacity: 0.8 },
  concept: { stroke: 'var(--border)', base: 1, opacity: 0.8 },
}

type View = { x: number; y: number; scale: number }

/** Centre and scale the layout so the whole graph fits the viewport with margin. */
function fitView(positions: Map<string, Point>): View {
  if (positions.size === 0) return { x: 0, y: 0, scale: 1 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  const scale = clamp((0.82 * CANVAS) / Math.max(w, h), 0.2, 2.5)
  const cxb = (minX + maxX) / 2
  const cyb = (minY + maxY) / 2
  return { x: CANVAS / 2 - cxb * scale, y: CANVAS / 2 - cyb * scale, scale }
}

export function ConceptGraph(props: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const { nodes, edges } = props
  const navigate = useNavigate()

  // Solve the layout when the graph data changes. React Query hands back the
  // same references until the data itself changes, so this recomputes only on a
  // real change — with plenty of spacing (iterations + spread) to fight overlap.
  const initial = useMemo(
    () =>
      forceLayout(nodes, edges, { width: CANVAS, height: CANVAS, iterations: 420, spread: 1.5 }),
    [nodes, edges],
  )

  const [positions, setPositions] = useState<Map<string, Point>>(initial)
  const [view, setView] = useState<View>(() => fitView(initial))
  // when a fresh layout arrives, re-seed positions and re-fit the view
  const seededFrom = useRef(initial)
  if (seededFrom.current !== initial) {
    seededFrom.current = initial
    setPositions(initial)
    setView(fitView(initial))
  }

  const [hover, setHover] = useState<string | null>(null)
  // a pinned concept/tag stays highlighted after you click it, and lists its
  // pages — hovering something else only lights it up transiently
  const [selected, setSelected] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    concept: true,
    tag: true,
    link: true,
    semantic: true,
    relation: true,
  })
  const [labelDensity, setLabelDensity] = useState(1)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<
    | { kind: 'node'; id: string; startX: number; startY: number }
    | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
    | null
  >(null)
  const moved = useRef(false)

  const visibleEdges = useMemo(() => edges.filter((e) => filters[e.type]), [edges, filters])
  // which edge types this space actually has — only those get a filter toggle
  const present = useMemo(() => new Set(edges.map((e) => e.type)), [edges])

  // adjacency over the *visible* edges, so hiding an edge type also stops it
  // highlighting or listing neighbours
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const n of nodes) m.set(n.id, new Set())
    for (const e of visibleEdges) {
      m.get(e.source)?.add(e.target)
      m.get(e.target)?.add(e.source)
    }
    return m
  }, [nodes, visibleEdges])

  // the node driving the highlight: a live hover wins over the pinned selection
  const focus = hover ?? selected

  // nodes ranked by importance — labels reveal from the top of this list, and
  // how many depends on zoom (more room → more words) and the density slider
  const ranked = useMemo(
    () =>
      [...nodes]
        .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
        .map((n) => n.id),
    [nodes],
  )
  const labelBudget = clamp(Math.round(10 * view.scale * labelDensity), 6, nodes.length)
  const labelled = useMemo(() => new Set(ranked.slice(0, labelBudget)), [ranked, labelBudget])

  const isLit = (id: string) => {
    if (!focus) return true
    return id === focus || neighbours.get(focus)?.has(id) === true
  }
  const edgeLit = (e: GraphEdge) => !focus || e.source === focus || e.target === focus
  const showLabel = (id: string) =>
    id === focus || neighbours.get(focus ?? '')?.has(id) === true || labelled.has(id)

  // the pinned concept/tag and the pages hanging off it, for the detail card
  const selectedNode = selected ? (nodes.find((n) => n.id === selected) ?? null) : null
  const selectedPages =
    selectedNode && selectedNode.kind !== 'page'
      ? nodes.filter((n) => n.kind === 'page' && neighbours.get(selectedNode.id)?.has(n.id))
      : []

  const toCanvas = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const px = ((clientX - rect.left) / rect.width) * CANVAS
    const py = ((clientY - rect.top) / rect.height) * CANVAS
    return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale }
  }

  // zoom keeping a given canvas-viewport point fixed (defaults to the centre)
  const zoomBy = (factor: number, at: Point = { x: CANVAS / 2, y: CANVAS / 2 }) => {
    setView((v) => {
      const scale = clamp(v.scale * factor, 0.2, 4)
      const cx = (at.x - v.x) / v.scale
      const cy = (at.y - v.y) / v.scale
      return { scale, x: at.x - cx * scale, y: at.y - cy * scale }
    })
  }

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    moved.current = false
    drag.current = { kind: 'node', id, startX: e.clientX, startY: e.clientY }
  }
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    moved.current = false
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, ox: view.x, oy: view.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) moved.current = true
      setView((v) => ({ ...v, x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) }))
      return
    }
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) moved.current = true
    const p = toCanvas(e.clientX, e.clientY)
    setPositions((prev) => {
      const next = new Map(prev)
      next.set(d.id, p)
      return next
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (e: React.WheelEvent) => {
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, toCanvas(e.clientX, e.clientY))
  }

  const radius = (n: GraphNode) =>
    n.kind === 'page' ? 7 + Math.min(14, n.weight * 1.6) : 4 + Math.min(9, n.weight * 1.4)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const ctrlBtn =
    'w-7 h-7 rounded border text-sm leading-none flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5'

  return (
    <div className="relative w-full h-full">
      {/* Background onClick clears the pinned selection (nodes stop propagation);
          keyboard users clear via the ✕ in the selection card. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: background affordance; card ✕ is the keyboard path */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS} ${CANVAS}`}
        className="w-full h-full touch-none select-none"
        style={{ cursor: drag.current?.kind === 'pan' ? 'grabbing' : 'grab' }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onClick={() => {
          if (!moved.current) setSelected(null)
        }}
        role="img"
        aria-label="Concept graph of this space"
      >
        <defs>
          {/* arrowhead for directed relation edges; fixed size, not stroke-scaled */}
          <marker
            id="bn-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-2)" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {visibleEdges.map((e) => {
            const a = positions.get(e.source)
            const b = positions.get(e.target)
            if (!a || !b) return null
            const lit = edgeLit(e)
            // links (accent), relations (directed, labeled), semantic (green
            // dots), tags dash, concepts quiet
            const style = EDGE_STYLE[e.type]
            const isRel = e.type === 'relation'
            // relation edges are directed — trim to the target node's boundary
            // so the arrowhead sits at the edge, not buried under the circle
            let bx = b.x
            let by = b.y
            if (isRel) {
              const tgt = nodeById.get(e.target)
              const trim = (tgt ? radius(tgt) : 6) + 4
              const dx = b.x - a.x
              const dy = b.y - a.y
              const len = Math.hypot(dx, dy) || 1
              bx = b.x - (dx / len) * trim
              by = b.y - (dy / len) * trim
            }
            return (
              <g key={`${e.type}:${e.source}->${e.target}:${e.label ?? ''}`}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={bx}
                  y2={by}
                  stroke={style.stroke}
                  strokeWidth={lit ? style.base : style.base * 0.45}
                  strokeDasharray={style.dash}
                  opacity={lit ? style.opacity : 0.16}
                  markerEnd={isRel ? 'url(#bn-arrow)' : undefined}
                />
                {isRel && lit && e.label && (
                  <text
                    x={(a.x + bx) / 2}
                    y={(a.y + by) / 2 - 2}
                    textAnchor="middle"
                    fontSize={9}
                    fill="var(--text-2)"
                    style={{ pointerEvents: 'none', paintOrder: 'stroke' }}
                    stroke="var(--bg)"
                    strokeWidth={3}
                  >
                    {e.label}
                  </text>
                )}
              </g>
            )
          })}
          {nodes.map((n) => {
            const p = positions.get(n.id)
            if (!p) return null
            const lit = isLit(n.id)
            const r = radius(n)
            const isPage = n.kind === 'page'
            const isTag = n.kind === 'tag'
            const fill = isPage ? 'var(--accent)' : isTag ? 'var(--accent-soft)' : 'var(--panel)'
            const stroke = isPage ? 'var(--accent)' : isTag ? 'var(--accent)' : 'var(--text-3)'
            const labelFill = isPage ? 'var(--text)' : isTag ? 'var(--accent)' : 'var(--text-2)'
            const open = () => {
              if (isPage && n.pageId) navigate({ to: '/p/$pageId', params: { pageId: n.pageId } })
            }
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                opacity={lit ? 1 : 0.15}
                style={{ cursor: isPage ? 'pointer' : 'grab' }}
                role={isPage ? 'button' : undefined}
                tabIndex={isPage ? 0 : undefined}
                aria-label={isPage ? `Open ${n.label}` : undefined}
                onPointerDown={(ev) => onNodePointerDown(ev, n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                onKeyDown={(ev) => {
                  if (isPage && (ev.key === 'Enter' || ev.key === ' ')) {
                    ev.preventDefault()
                    open()
                  }
                }}
                onClick={(ev) => {
                  ev.stopPropagation()
                  if (moved.current) {
                    moved.current = false
                    return
                  }
                  // a page opens; a concept/tag pins (click again to unpin)
                  if (isPage) open()
                  else setSelected((s) => (s === n.id ? null : n.id))
                }}
              >
                {selected === n.id && (
                  <circle
                    r={r + 4}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    opacity={0.7}
                  />
                )}
                <circle r={r} fill={fill} stroke={stroke} strokeWidth={isPage ? 0 : 1} />
                {showLabel(n.id) && (
                  <text
                    x={0}
                    y={r + 11}
                    textAnchor="middle"
                    fontSize={isPage ? 12 : 10}
                    fontWeight={isPage ? 600 : 400}
                    fill={labelFill}
                    style={{ pointerEvents: 'none', paintOrder: 'stroke' }}
                    stroke="var(--bg)"
                    strokeWidth={3}
                  >
                    {n.icon ? `${n.icon} ` : ''}
                    {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          type="button"
          className={ctrlBtn}
          title="Zoom in"
          onClick={() => zoomBy(1.3)}
          style={{
            background: 'var(--panel)',
            borderColor: 'var(--border)',
            color: 'var(--text-2)',
          }}
        >
          ＋
        </button>
        <button
          type="button"
          className={ctrlBtn}
          title="Zoom out"
          onClick={() => zoomBy(1 / 1.3)}
          style={{
            background: 'var(--panel)',
            borderColor: 'var(--border)',
            color: 'var(--text-2)',
          }}
        >
          －
        </button>
        <button
          type="button"
          className={ctrlBtn}
          title="Fit to view"
          onClick={() => setView(fitView(positions))}
          style={{
            background: 'var(--panel)',
            borderColor: 'var(--border)',
            color: 'var(--text-2)',
          }}
        >
          ⊡
        </button>
      </div>

      <div className="absolute top-3 left-3 flex flex-col gap-2 w-[210px]">
        {selectedNode && (
          <div
            className="rounded-lg border p-2 text-xs shadow-sm"
            style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-medium truncate" style={{ color: 'var(--text)' }}>
                {selectedNode.label}
              </span>
              <button
                type="button"
                title="Clear selection"
                onClick={() => setSelected(null)}
                style={{ color: 'var(--text-3)' }}
              >
                ✕
              </button>
            </div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--text-3)' }}>
              {selectedPages.length} {selectedPages.length === 1 ? 'page' : 'pages'}
            </div>
            <div className="flex flex-col max-h-44 overflow-y-auto">
              {selectedPages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="text-left py-0.5 truncate hover:underline"
                  style={{ color: 'var(--text-2)' }}
                  onClick={() =>
                    p.pageId && navigate({ to: '/p/$pageId', params: { pageId: p.pageId } })
                  }
                >
                  {p.icon ? `${p.icon} ` : ''}
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className="rounded-lg border p-2 text-xs flex flex-col gap-1.5"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          {(
            [
              ['link', 'Links'],
              ['relation', 'Actions'],
              ['semantic', 'Similar'],
              ['tag', 'Tags'],
              ['concept', 'Concepts'],
            ] as const
          )
            .filter(([key]) => present.has(key))
            .map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-1.5 cursor-pointer"
                style={{ color: 'var(--text-2)' }}
              >
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          <label
            className="flex items-center gap-2 mt-0.5 pt-1.5 border-t"
            style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}
            title="Label density"
          >
            <span>Labels</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.1}
              value={labelDensity}
              onChange={(e) => setLabelDensity(Number(e.target.value))}
              className="flex-1"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
