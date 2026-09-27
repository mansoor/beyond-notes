/**
 * The concept graph's optional semantic layer — the one part of the graph that
 * is AI, and deliberately opt-in (GRAPH_EMBEDDINGS).
 *
 * A small sentence-embedding model (all-MiniLM-L6-v2 via transformers.js) runs
 * in-process — no cloud, no API, no Python. It turns each page into a vector, and
 * two pages whose vectors point the same way are "about the same thing" even when
 * they share no word, link or tag — the gap classical NLP can't cross.
 *
 * The heavy library is imported lazily, so a server with the feature off never
 * loads onnxruntime or the model. The pure maths (cosine, pair selection) lives
 * here too and is what the tests exercise — the model itself is only touched on a
 * box that has opted in.
 */

import type { Config } from './config'

/** Cosine similarity of two vectors. Inputs are unit-normalised, so this is a dot. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += (a[i] as number) * (b[i] as number)
  return dot
}

export type SimilarPair = { a: string; b: string; score: number }

/**
 * From per-id vectors, the semantic edges: for each id keep its `perNode` nearest
 * others scoring at least `threshold`, then dedup so a pair appears once. The
 * result is undirected and deterministic (ties broken by id).
 */
export function topSimilarPairs(
  vectors: Map<string, number[]>,
  opts: { threshold: number; perNode: number },
): SimilarPair[] {
  const ids = [...vectors.keys()]
  const chosen = new Map<string, number>() // "a\tb" (a<b) -> score
  for (const a of ids) {
    const va = vectors.get(a) as number[]
    const scored: Array<{ b: string; score: number }> = []
    for (const b of ids) {
      if (b === a) continue
      const score = cosine(va, vectors.get(b) as number[])
      if (score >= opts.threshold) scored.push({ b, score })
    }
    scored.sort((x, y) => y.score - x.score || x.b.localeCompare(y.b))
    for (const { b, score } of scored.slice(0, opts.perNode)) {
      const key = a < b ? `${a}\t${b}` : `${b}\t${a}`
      const prev = chosen.get(key)
      if (prev === undefined || score > prev) chosen.set(key, score)
    }
  }
  return [...chosen.entries()]
    .map(([key, score]) => {
      const [a, b] = key.split('\t')
      return { a: a as string, b: b as string, score }
    })
    .sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
}

export type Embedder = {
  enabled: boolean
  /** Embed each text to a unit vector. Rejects if the model can't be loaded. */
  embed(texts: string[]): Promise<number[][]>
}

type EmbedConfig = Pick<Config, 'GRAPH_EMBEDDINGS' | 'GRAPH_EMBED_MODEL' | 'GRAPH_EMBED_CACHE_DIR'>

/**
 * Build the embedder for this process. When the feature is off it's an inert
 * stub whose embed() rejects — callers check `enabled` first, so it never runs.
 * When on, the model and runtime load lazily on the first real embed and are
 * reused for the life of the process; a small cache skips re-embedding unchanged
 * page text between graph loads.
 */
export function createEmbedder(config: EmbedConfig): Embedder {
  if (!config.GRAPH_EMBEDDINGS) {
    return {
      enabled: false,
      embed: () => Promise.reject(new Error('embeddings are disabled')),
    }
  }

  // the transformers.js pipeline, narrowed to the one call shape we use
  type Extractor = (
    text: string,
    opts: { pooling: 'mean'; normalize: boolean },
  ) => Promise<{ data: Float32Array }>
  let extractor: Promise<Extractor> | null = null
  const load = () => {
    if (!extractor) {
      extractor = (async () => {
        const tf = await import('@xenova/transformers')
        // keep everything local: cache the model under our data dir, and once
        // it's there don't reach out to the Hub again
        tf.env.cacheDir = config.GRAPH_EMBED_CACHE_DIR
        tf.env.localModelPath = config.GRAPH_EMBED_CACHE_DIR
        const pipe = await tf.pipeline('feature-extraction', config.GRAPH_EMBED_MODEL, {
          quantized: true,
        })
        return pipe as unknown as Extractor
      })()
    }
    return extractor
  }

  const cache = new Map<string, number[]>()
  const CACHE_MAX = 5000

  return {
    enabled: true,
    async embed(texts) {
      const run = await load()
      const out: number[][] = []
      for (const text of texts) {
        const key = text
        const hit = cache.get(key)
        if (hit) {
          out.push(hit)
          continue
        }
        const res = await run(text, { pooling: 'mean', normalize: true })
        const vec = Array.from(res.data as Float32Array)
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
        cache.set(key, vec)
        out.push(vec)
      }
      return out
    },
  }
}
