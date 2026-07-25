/**
 * The interactive concept graph rendered as themed SVG. No canvas, no chart
 * library — one space's graph is small enough that plain SVG nodes are crisp,
 * stylable with our CSS variables, and easy to make accessible.
 *
 * Layout is computed once (see forceLayout) and then held in state so a node can
 * be dragged without re-solving the whole graph. Background drag pans, wheel
 * zooms, clicking a page opens it, hovering anything dims everything unrelated.
 */

import { useNavigate } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { type Point, forceLayout } from './forceLayout'

export type GraphNode = {
  id: string
  label: string
  kind: 'page' | 'concept'
  weight: number
  pageId?: string
  icon?: string | null
}
export type GraphEdge = { source: string; target: string; weight: number }

const CANVAS = 1000

export function ConceptGraph(props: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const { nodes, edges } = props
  const navigate = useNavigate()

  // Solve the layout when the graph data changes. React Query hands back the
  // same nodes/edges references until the data itself changes, so this recomputes
  // only on a real change — not every render.
  const initial = useMemo(
    () => forceLayout(nodes, edges, { width: CANVAS, height: CANVAS }),
    [nodes, edges],
  )

  const [positions, setPositions] = useState<Map<string, Point>>(initial)
  // re-seed dragged positions when a fresh layout arrives (new pages, edits)
  const seededFrom = useRef(initial)
  if (seededFrom.current !== initial) {
    seededFrom.current = initial
    setPositions(initial)
  }

  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [hover, setHover] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<
    | { kind: 'node'; id: string; startX: number; startY: number }
    | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
    | null
  >(null)
  // set true once a node drag actually moves, so the trailing click doesn't
  // navigate away when the user only meant to reposition
  const moved = useRef(false)

  // adjacency, so hovering a node can highlight its immediate neighbours
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const n of nodes) m.set(n.id, new Set())
    for (const e of edges) {
      m.get(e.source)?.add(e.target)
      m.get(e.target)?.add(e.source)
    }
    return m
  }, [nodes, edges])

  const isLit = (id: string) => {
    if (!hover) return true
    return id === hover || neighbours.get(hover)?.has(id) === true
  }
  const edgeLit = (e: GraphEdge) => !hover || e.source === hover || e.target === hover

  // convert a client point to canvas coordinates under the current view
  const toCanvas = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const px = ((clientX - rect.left) / rect.width) * CANVAS
    const py = ((clientY - rect.top) / rect.height) * CANVAS
    return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale }
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
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const c = toCanvas(e.clientX, e.clientY)
    setView((v) => {
      const scale = Math.max(0.2, Math.min(4, v.scale * factor))
      // keep the point under the cursor fixed while zooming
      return { scale, x: v.x + c.x * (v.scale - scale), y: v.y + c.y * (v.scale - scale) }
    })
  }

  const radius = (n: GraphNode) =>
    n.kind === 'page' ? 7 + Math.min(14, n.weight * 1.6) : 4 + Math.min(9, n.weight * 1.4)

  return (
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
          return (
            <line
              key={`${e.source}->${e.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--border)"
              strokeWidth={edgeLit(e) ? 1.2 : 0.5}
              opacity={edgeLit(e) ? 0.9 : 0.25}
            />
          )
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id)
          if (!p) return null
          const lit = isLit(n.id)
          const r = radius(n)
          const isPage = n.kind === 'page'
          const open = () => {
            if (isPage && n.pageId) navigate({ to: '/p/$pageId', params: { pageId: n.pageId } })
          }
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              opacity={lit ? 1 : 0.2}
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
              <circle
                r={r}
                fill={isPage ? 'var(--accent)' : 'var(--panel)'}
                stroke={isPage ? 'var(--accent)' : 'var(--text-3)'}
                strokeWidth={isPage ? 0 : 1}
              />
              <text
                x={0}
                y={r + 11}
                textAnchor="middle"
                fontSize={isPage ? 12 : 10}
                fontWeight={isPage ? 600 : 400}
                fill={isPage ? 'var(--text)' : 'var(--text-2)'}
                style={{ pointerEvents: 'none' }}
              >
                {n.icon ? `${n.icon} ` : ''}
                {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
