import { describe, expect, it } from 'vitest'
import { type Embedder, cosine, createEmbedder, topSimilarPairs } from './embeddings'

describe('cosine', () => {
  it('is 1 for identical unit vectors and 0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1)
  })
})

describe('topSimilarPairs', () => {
  const v = (x: number, y: number) => [x, y]

  it('keeps only pairs above the threshold, undirected and deduped', () => {
    const vectors = new Map([
      ['a', v(1, 0)],
      ['b', v(0.99, 0.14)], // very close to a
      ['c', v(0, 1)], // orthogonal to a/b
    ])
    const pairs = topSimilarPairs(vectors, { threshold: 0.5, perNode: 4 })
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ a: 'a', b: 'b' })
    expect(pairs[0]?.score).toBeGreaterThan(0.5)
  })

  it('caps neighbours per node', () => {
    // four near-identical vectors → each sees 3 neighbours, but perNode=1
    const vectors = new Map([
      ['a', v(1, 0)],
      ['b', v(0.999, 0.045)],
      ['c', v(0.998, 0.063)],
      ['d', v(0.997, 0.077)],
    ])
    const pairs = topSimilarPairs(vectors, { threshold: 0.5, perNode: 1 })
    // each node contributes at most its single best edge; dedup keeps it small
    expect(pairs.length).toBeLessThanOrEqual(4)
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const vectors = new Map([
      ['a', v(1, 0)],
      ['b', v(0.9, 0.436)],
      ['c', v(0.8, 0.6)],
    ])
    const opts = { threshold: 0.5, perNode: 2 }
    expect(topSimilarPairs(vectors, opts)).toEqual(topSimilarPairs(vectors, opts))
  })
})

describe('createEmbedder (disabled)', () => {
  it('is inert and never loads the model when the flag is off', async () => {
    const e: Embedder = createEmbedder({
      GRAPH_EMBEDDINGS: false,
      GRAPH_EMBED_MODEL: 'Xenova/all-MiniLM-L6-v2',
      GRAPH_EMBED_CACHE_DIR: './data/models',
    })
    expect(e.enabled).toBe(false)
    await expect(e.embed(['anything'])).rejects.toThrow()
  })
})
