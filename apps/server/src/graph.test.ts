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
    expect(g).toEqual({
      nodes: [],
      edges: [],
      pageCount: 0,
      conceptCount: 0,
      tagCount: 0,
      linkCount: 0,
      semanticCount: 0,
      relationCount: 0,
      isolatedCount: 0,
    })
  })

  it('adds a labeled relation edge between two kept concepts', () => {
    // docker + container both appear in both pages -> kept concepts; the triple
    // (docker, runs, container) becomes a directed labeled edge between them
    const g = buildSpaceGraph(
      [
        page('a', 'A', 'Docker runs containers.'),
        page('b', 'B', 'A container needs Docker.'),
      ],
      {},
      { triples: [{ subject: 'docker', verb: 'runs', object: 'container' }] },
    )
    expect(g.relationCount).toBe(1)
    expect(g.edges).toContainEqual({
      source: 'concept:docker',
      target: 'concept:container',
      weight: 1,
      type: 'relation',
      label: 'runs',
    })
  })

  it('drops a relation whose endpoints are not both kept concepts', () => {
    const g = buildSpaceGraph(
      [page('a', 'A', 'Sourdough bread only.')],
      {},
      { triples: [{ subject: 'rigger', verb: 'deploys', object: 'stack' }] },
    )
    expect(g.relationCount).toBe(0)
  })

  it('adds a semantic edge from a similarity pair (no shared word needed)', () => {
    const g = buildSpaceGraph(
      [page('a', 'A', 'Sourdough bread.'), page('b', 'B', 'Kubernetes clusters.')],
      {},
      { similar: [{ a: 'a', b: 'b', score: 0.71 }] },
    )
    expect(g.semanticCount).toBe(1)
    expect(g.edges).toContainEqual({ source: 'a', target: 'b', weight: 0.71, type: 'semantic' })
    expect(g.isolatedCount).toBe(0)
  })

  it('adds a direct link edge from an explicit [[wiki link]]', () => {
    const g = buildSpaceGraph(
      [page('a', 'A', 'Sourdough bread.'), page('b', 'B', 'Kubernetes clusters.')],
      {},
      { links: [{ from: 'a', to: 'b' }] },
    )
    // no shared concept, but the link alone connects them
    expect(g.linkCount).toBe(1)
    expect(g.edges).toContainEqual({ source: 'a', target: 'b', weight: 1, type: 'link' })
    expect(g.isolatedCount).toBe(0)
  })

  it('makes a tag node for a #tag shared by two pages', () => {
    const g = buildSpaceGraph(
      [page('a', 'A', 'One.'), page('b', 'B', 'Two.'), page('c', 'C', 'Three.')],
      {},
      {
        tags: [
          { pageId: 'a', tag: 'recipe' },
          { pageId: 'b', tag: 'recipe' },
          { pageId: 'c', tag: 'solo' }, // only one page → not a connector
        ],
      },
    )
    expect(g.tagCount).toBe(1)
    expect(g.nodes.find((n) => n.id === 'tag:recipe')?.label).toBe('#recipe')
    expect(g.edges.filter((e) => e.type === 'tag')).toHaveLength(2)
    expect(g.nodes.some((n) => n.id === 'tag:solo')).toBe(false)
  })

  it('ignores links and tags that point outside the space', () => {
    const g = buildSpaceGraph(
      [page('a', 'A', 'Only page.')],
      {},
      { links: [{ from: 'a', to: 'ghost' }], tags: [{ pageId: 'ghost', tag: 'x' }] },
    )
    expect(g.linkCount).toBe(0)
    expect(g.tagCount).toBe(0)
  })
})
