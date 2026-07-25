/**
 * The per-space concept graph — built entirely from the notes' own words, no AI.
 *
 * Each page becomes a node; each salient noun it shares with another page becomes
 * a concept node between them. Two pages are "related" when they light up the
 * same concept — so a graph edge is never asserted, only observed from the text.
 * See `concepts.ts` for how the nouns are pulled out.
 *
 * This module is a pure transform: it takes already-loaded page text and returns
 * a graph. Access control, trashing and content loading all happen in the router
 * before this is called, which keeps the interesting logic free of the database.
 */

import { type Concept, extractConcepts } from './concepts'

export type GraphNode = {
  /** stable id: the page id for pages, `concept:<term>` for concepts */
  id: string
  label: string
  kind: 'page' | 'concept'
  /** pages: how many concepts it touches; concepts: how many pages mention it */
  weight: number
  /** present on page nodes, so the client can link straight to the editor */
  pageId?: string
  icon?: string | null
}

export type GraphEdge = { source: string; target: string; weight: number }

export type SpaceGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  pageCount: number
  conceptCount: number
  /** pages that share no concept with any other — shown, but adrift */
  isolatedCount: number
}

export type GraphPage = { id: string; title: string; icon: string | null; text: string }

export type GraphOptions = {
  /** concepts contributed per page before ranking (keeps long pages in check) */
  perPage?: number
  /** a concept must appear in at least this many pages to be connective tissue */
  minPages?: number
  /** hard cap on concept nodes, most-shared first, so the view never hairballs */
  maxConcepts?: number
}

const CONCEPT_PREFIX = 'concept:'

/**
 * Fold a list of pages into a concept graph. Deterministic: same input, same
 * output, so the rendered layout is stable across reloads.
 */
export function buildSpaceGraph(pages: GraphPage[], opts: GraphOptions = {}): SpaceGraph {
  const perPage = opts.perPage ?? 12
  const minPages = opts.minPages ?? 2
  const maxConcepts = opts.maxConcepts ?? 60

  // term -> the pages that mention it, and the summed in-page frequency
  const byTerm = new Map<string, { pages: Set<string>; weight: number }>()
  const pageConcepts = new Map<string, Concept[]>()

  for (const page of pages) {
    const concepts = extractConcepts(page.text, perPage)
    pageConcepts.set(page.id, concepts)
    for (const c of concepts) {
      const entry = byTerm.get(c.term) ?? { pages: new Set<string>(), weight: 0 }
      entry.pages.add(page.id)
      entry.weight += c.weight
      byTerm.set(c.term, entry)
    }
  }

  // keep only concepts that actually connect pages, richest first, capped
  const keptTerms = new Set(
    [...byTerm.entries()]
      .filter(([, e]) => e.pages.size >= minPages)
      .sort(
        (a, b) => b[1].pages.size - a[1].pages.size || b[1].weight - a[1].weight ||
          a[0].localeCompare(b[0]),
      )
      .slice(0, maxConcepts)
      .map(([term]) => term),
  )

  const edges: GraphEdge[] = []
  const pageDegree = new Map<string, number>()
  for (const page of pages) {
    for (const c of pageConcepts.get(page.id) ?? []) {
      if (!keptTerms.has(c.term)) continue
      edges.push({ source: page.id, target: `${CONCEPT_PREFIX}${c.term}`, weight: c.weight })
      pageDegree.set(page.id, (pageDegree.get(page.id) ?? 0) + 1)
    }
  }

  const pageNodes: GraphNode[] = pages.map((p) => ({
    id: p.id,
    pageId: p.id,
    label: p.title.trim() || 'Untitled',
    kind: 'page',
    weight: pageDegree.get(p.id) ?? 0,
    icon: p.icon,
  }))

  const conceptNodes: GraphNode[] = [...keptTerms].map((term) => ({
    id: `${CONCEPT_PREFIX}${term}`,
    label: term,
    kind: 'concept',
    weight: byTerm.get(term)?.pages.size ?? 0,
  }))

  return {
    nodes: [...pageNodes, ...conceptNodes],
    edges,
    pageCount: pages.length,
    conceptCount: conceptNodes.length,
    isolatedCount: pageNodes.filter((n) => n.weight === 0).length,
  }
}
