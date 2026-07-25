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

/**
 * Pull the salient concepts out of one page's plain text, most frequent first.
 *
 * `limit` caps how many a single page contributes — a long page shouldn't drown
 * the graph. Weight is raw in-page frequency; the graph service decides what to
 * do with it (edge thickness, node size).
 */
export function extractConcepts(text: string, limit = 12): Concept[] {
  if (!text.trim()) return []

  const terms = nlp(text).terms().json() as Array<{
    text: string
    terms?: Array<{ tags?: string[] }>
  }>

  const counts = new Map<string, number>()
  for (const t of terms) {
    const tags = t.terms?.[0]?.tags ?? []
    // keep true nouns; drop pronouns even when compromise also tags them Noun
    if (tags.includes('Pronoun')) continue
    if (!tags.includes('Noun') && !tags.includes('ProperNoun')) continue

    // Proper nouns (Docker, Kubernetes, AWS) are names, not plurals — folding
    // their trailing "s" mangles them ("Kubernetes" → "kubernete"). Only the
    // common-noun path gets singularised.
    const bare = t.text.toLowerCase().replace(/[^a-z0-9]/g, '')
    const cleaned = tags.includes('ProperNoun') ? bare : singular(bare)
    if (cleaned.length < 3) continue
    if (/^\d+$/.test(cleaned)) continue
    if (STOPWORDS.has(cleaned)) continue

    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
    .slice(0, limit)
}
