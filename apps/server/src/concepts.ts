/**
 * Concept extraction for the per-space knowledge graph — deliberately AI-free.
 *
 * It is pure classical NLP: `compromise` tags each word's part of speech with a
 * lexicon and grammar rules (no model, no download, no network), we keep the
 * nouns, normalise them to a shared surface form, and count them. Two pages that
 * both talk about "backups" end up sharing that concept node — which is the
 * whole point. Meaning-by-wording (paraphrase, synonyms) is explicitly out of
 * scope here; that needs embeddings, and this build has none.
 *
 * Determinism matters: the same text must always yield the same concepts so the
 * graph is stable between reloads. Nothing here touches Date/Math.random.
 */

import nlp from 'compromise'

/**
 * Words that are grammatically nouns but carry no topical signal — they would
 * connect unrelated pages ("note", "thing") or are just noise heads left inside
 * a noun phrase ("tool", "support"). Tuned against real note text; extend freely.
 */
const STOPWORDS = new Set([
  // pronoun-ish / deictic
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'thing',
  'things',
  'stuff',
  'one',
  'ones',
  'someone',
  'something',
  'anything',
  'everything',
  'nothing',
  // generic containers people write about writing
  'note',
  'notes',
  'page',
  'pages',
  'list',
  'lists',
  'item',
  'items',
  'thing',
  'idea',
  'ideas',
  'topic',
  'topics',
  'section',
  'part',
  'parts',
  'way',
  'ways',
  'lot',
  'lots',
  'bit',
  'kind',
  'sort',
  'type',
  'example',
  'examples',
  // bleached time/measure nouns
  'time',
  'times',
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'year',
  'today',
  'tomorrow',
  'yesterday',
  'number',
  'amount',
  'level',
  // low-content heads that survive noun-phrase splitting
  'tool',
  'tools',
  'support',
  'use',
  'user',
  'users',
  'name',
  'names',
  'value',
  'values',
  'case',
  'cases',
  'point',
  'points',
  'place',
  'places',
  'work',
  'need',
  'needs',
  'set',
  'sets',
])

/**
 * A small, deterministic English singulariser — enough to fold "backups" and
 * "backup" together without a lexicon. It is intentionally conservative: it
 * would rather leave a word plural than mangle it.
 */
export function singular(word: string): string {
  const w = word
  if (w.length <= 3) return w
  if (w.endsWith('ss')) return w // "process", "class"
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y` // "queries" → "query"
  if (/(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2) // "boxes" → "box"
  if (w.endsWith('s') && !w.endsWith('us') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export type Concept = { term: string; weight: number }

/** Normalise one term to its concept surface form, or null if it's not one. */
function normalise(text: string, tags: string[]): string | null {
  if (tags.includes('Pronoun')) return null
  if (!tags.includes('Noun') && !tags.includes('ProperNoun')) return null
  // Proper nouns (Docker, Kubernetes, AWS) are names, not plurals — folding
  // their trailing "s" mangles them ("Kubernetes" → "kubernete").
  const bare = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const cleaned = tags.includes('ProperNoun') ? bare : singular(bare)
  if (cleaned.length < 3 || /^\d+$/.test(cleaned) || STOPWORDS.has(cleaned)) return null
  return cleaned
}

/**
 * Pull the salient concepts out of one page's plain text, most frequent first.
 *
 * Emits single nouns and adjacent noun compounds ("managed database", "docker
 * volume") — the compound only earns a graph node if it recurs across pages, so
 * one-off phrases cost nothing. `limit` caps how many a single page contributes
 * so a long page can't drown the graph. Weight is raw in-page frequency; the
 * graph service reweights it with TF-IDF across the whole space.
 */
export function extractConcepts(text: string, limit = 14): Concept[] {
  if (!text.trim()) return []

  const terms = nlp(text).terms().json() as Array<{
    text: string
    terms?: Array<{ tags?: string[] }>
  }>

  const counts = new Map<string, number>()
  const add = (term: string) => counts.set(term, (counts.get(term) ?? 0) + 1)

  // `prev` is the previous term's concept form, but only when that term sat
  // directly before this one with no non-noun (verb, punctuation) between —
  // that adjacency is what makes "managed database" a compound and not two
  // unrelated nouns that merely co-occur in a sentence.
  let prev: string | null = null
  for (const t of terms) {
    const cleaned = normalise(t.text, t.terms?.[0]?.tags ?? [])
    if (!cleaned) {
      prev = null
      continue
    }
    add(cleaned)
    if (prev) add(`${prev} ${cleaned}`)
    prev = cleaned
  }

  return [...counts.entries()]
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
    .slice(0, limit)
}
