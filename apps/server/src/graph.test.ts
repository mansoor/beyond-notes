import { describe, expect, it } from 'vitest'
import { buildSpaceGraph } from './graph'

const page = (id: string, title: string, text: string) => ({ id, title, icon: null, text })

describe('buildSpaceGraph', () => {
  it('connects two pages through a concept they share', () => {
    const g = buildSpaceGraph([
      page('a', 'Backup guide', 'Docker volume backups run nightly with restic.'),
      page('b', 'Restore notes', 'Restoring a Docker volume from a backup.'),
    ])
    // "docker" and "backup" appear in both → concept nodes bridging a and b
    const conceptLabels = g.nodes.filter((n) => n.kind === 'concept').map((n) => n.label)
    expect(conceptLabels).toContain('docker')
    expect(conceptLabels).toContain('backup')

    const edgeTargets = g.edges.filter((e) => e.source === 'a').map((e) => e.target)
    expect(edgeTargets).toContain('concept:docker')
    // b also edges into concept:docker → the two pages are transitively linked
    expect(g.edges.some((e) => e.source === 'b' && e.target === 'concept:docker')).toBe(true)
  })

  it('drops concepts that only one page mentions (no bridge, no node)', () => {
    const g = buildSpaceGraph([
      page('a', 'A', 'Kubernetes clusters and ingress controllers.'),
      page('b', 'B', 'Baking sourdough bread at home.'),
    ])
    // nothing is shared, so there are no concept nodes and both pages are isolated
    expect(g.nodes.filter((n) => n.kind === 'concept')).toHaveLength(0)
    expect(g.isolatedCount).toBe(2)
  })

  it('counts a page node weight as how many concepts it touches', () => {
    const g = buildSpaceGraph([
      page('a', 'A', 'Docker backup. Docker backup.'),
      page('b', 'B', 'Docker backup restore.'),
    ])
    const a = g.nodes.find((n) => n.id === 'a')
    expect(a?.kind).toBe('page')
    expect(a?.weight).toBeGreaterThanOrEqual(2) // docker + backup
  })

  it('caps concept nodes to maxConcepts, most-shared first', () => {
    const pages = Array.from({ length: 6 }, (_, i) =>
      page(`p${i}`, `P${i}`, 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'),
    )
    const g = buildSpaceGraph(pages, { maxConcepts: 3 })
    expect(g.nodes.filter((n) => n.kind === 'concept').length).toBeLessThanOrEqual(3)
  })

  it('is deterministic', () => {
    const input = [
      page('a', 'A', 'Docker volume backups.'),
      page('b', 'B', 'Docker backup restore.'),
    ]
    expect(buildSpaceGraph(input)).toEqual(buildSpaceGraph(input))
  })

  it('handles an empty space', () => {
    const g = buildSpaceGraph([])
    expect(g).toEqual({ nodes: [], edges: [], pageCount: 0, conceptCount: 0, isolatedCount: 0 })
  })
})
