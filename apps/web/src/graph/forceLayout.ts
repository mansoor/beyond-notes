/**
 * A tiny, dependency-free force-directed layout — we deliberately did NOT pull
 * in d3-force. It's a Fruchterman–Reingold spring/repulsion model run for a
 * fixed number of iterations, producing final node positions in one shot (no
 * animation loop). The graph is small (one space), so this is plenty.
 *
 * It is fully deterministic: initial positions come from a sunflower spiral
 * seeded by node index, never Math.random. Same graph in → same picture out, so
 * the layout doesn't reshuffle every time you open a space.
 */

export type SimNode = { id: string; weight: number }
export type SimEdge = { source: string; target: string }
export type Point = { x: number; y: number }

export type LayoutOptions = {
  width?: number
  height?: number
  iterations?: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Lay out a graph and return a map of node id → position within [0,width]×
 * [0,height]. Disconnected nodes still get a spot; they just drift to the edges.
 */
export function forceLayout(
  nodes: SimNode[],
  edges: SimEdge[],
  opts: LayoutOptions = {},
): Map<string, Point> {
  const width = opts.width ?? 1000
  const height = opts.height ?? 1000
  const iterations = opts.iterations ?? 300
  const n = nodes.length
  const pos = new Map<string, Point>()
  const disp = new Map<string, Point>()
  if (n === 0) return pos

  // deterministic seed: a sunflower spiral centred on the canvas
  const cx = width / 2
  const cy = height / 2
  const maxR = Math.min(width, height) / 2
  nodes.forEach((node, i) => {
    const r = maxR * Math.sqrt((i + 0.5) / n)
    const a = i * GOLDEN_ANGLE
    pos.set(node.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    disp.set(node.id, { x: 0, y: 0 })
  })

  const ids = nodes.map((node) => node.id)
  const has = new Set(ids)
  const valid = edges.filter((e) => has.has(e.source) && has.has(e.target))

  const area = width * height
  const k = 0.8 * Math.sqrt(area / n) // ideal edge length
  let temp = width / 10 // max displacement, cooled each pass

  for (let iter = 0; iter < iterations; iter++) {
    for (const id of ids) {
      const d = disp.get(id) as Point
      d.x = 0
      d.y = 0
    }

    // repulsion between every pair
    for (let i = 0; i < n; i++) {
      const a = ids[i] as string
      const pa = pos.get(a) as Point
      const da = disp.get(a) as Point
      for (let j = i + 1; j < n; j++) {
        const b = ids[j] as string
        const pb = pos.get(b) as Point
        const db = disp.get(b) as Point
        let ddx = pa.x - pb.x
        let ddy = pa.y - pb.y
        let dist = Math.hypot(ddx, ddy)
        if (dist < 0.01) {
          // coincident: nudge apart deterministically by index
          ddx = (i - j) * 0.01 + 0.01
          ddy = 0.01
          dist = Math.hypot(ddx, ddy)
        }
        const force = (k * k) / dist
        const ux = (ddx / dist) * force
        const uy = (ddy / dist) * force
        da.x += ux
        da.y += uy
        db.x -= ux
        db.y -= uy
      }
    }

    // attraction along edges
    for (const e of valid) {
      const pa = pos.get(e.source) as Point
      const pb = pos.get(e.target) as Point
      const da = disp.get(e.source) as Point
      const db = disp.get(e.target) as Point
      const ddx = pa.x - pb.x
      const ddy = pa.y - pb.y
      const dist = Math.hypot(ddx, ddy) || 0.01
      const force = (dist * dist) / k
      const ux = (ddx / dist) * force
      const uy = (ddy / dist) * force
      da.x -= ux
      da.y -= uy
      db.x += ux
      db.y += uy
    }

    // apply, capped by temperature, then clamp inside the canvas
    for (const id of ids) {
      const p = pos.get(id) as Point
      const d = disp.get(id) as Point
      const len = Math.hypot(d.x, d.y) || 0.01
      const step = Math.min(len, temp)
      p.x = Math.max(0, Math.min(width, p.x + (d.x / len) * step))
      p.y = Math.max(0, Math.min(height, p.y + (d.y / len) * step))
    }

    temp *= 0.96 // cool
  }

  return pos
}
