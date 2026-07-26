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
  type: 'concept' | 'tag' | 'link'
}

const CANVAS = 1000
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

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
    () => forceLayout(nodes, edges, { width: CANVAS, height: CANVAS, iterations: 420, spread: 1.5 }),
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
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<
    | { kind: 'node'; id: string; startX: number; startY: number }
    | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
    | null
  >(null)
  const moved = useRef(false)

  // adjacency, so hovering a node highlights (and labels) its neighbours
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const n of nodes) m.set(n.id, new Set())
    for (const e of edges) {
      m.get(e.source)?.add(e.target)
      m.get(e.target)?.add(e.source)
    }
    return m
  }, [nodes, edges])

  // nodes ranked by importance — labels reveal from the top of this list, and
  // how many depends on zoom (more room → more words)
  const ranked = useMemo(
    () => [...nodes].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label)).map((n) => n.id),
    [nodes],
  )
  const labelBudget = clamp(Math.round(10 * view.scale), 6, nodes.length)
  const labelled = useMemo(() => new Set(ranked.slice(0, labelBudget)), [ranked, labelBudget])

  const isLit = (id: string) => {
    if (!hover) return true
    return id === hover || neighbours.get(hover)?.has(id) === true
  }
  const edgeLit = (e: GraphEdge) => !hover || e.source === hover || e.target === hover
  const showLabel = (id: string) =>
    id === hover || neighbours.get(hover ?? '')?.has(id) === true || labelled.has(id)

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
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, ox: view.x, oy: view.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
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

  const ctrlBtn =
    'w-7 h-7 rounded border text-sm leading-none flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5'

  return (
    <div className="relative w-full h-full">
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
        role="img"
        aria-label="Concept graph of this space"
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {edges.map((e) => {
            const a = positions.get(e.source)
            const b = positions.get(e.target)
            if (!a || !b) return null
            const lit = edgeLit(e)
            // explicit links stand out (accent), tags dash, concepts stay quiet
            const stroke =
              e.type === 'link'
                ? 'var(--accent)'
                : e.type === 'tag'
                  ? 'var(--text-3)'
                  : 'var(--border)'
            const base = e.type === 'link' ? 1.6 : 1
            return (
              <line
                key={`${e.type}:${e.source}->${e.target}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={lit ? base : base * 0.45}
                strokeDasharray={e.type === 'tag' ? '4 3' : undefined}
                opacity={lit ? (e.type === 'link' ? 0.75 : 0.8) : 0.16}
              />
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
                  open()
                }}
              >
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
          style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          ＋
        </button>
        <button
          type="button"
          className={ctrlBtn}
          title="Zoom out"
          onClick={() => zoomBy(1 / 1.3)}
          style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          －
        </button>
        <button
          type="button"
          className={ctrlBtn}
          title="Fit to view"
          onClick={() => setView(fitView(positions))}
          style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          ⊡
        </button>
      </div>
    </div>
  )
}
