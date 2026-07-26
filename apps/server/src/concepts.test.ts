import { describe, expect, it } from 'vitest'
import { extractConcepts, extractTriples, singular } from './concepts'

describe('singular', () => {
  it('folds common plurals to a shared form', () => {
    expect(singular('backups')).toBe('backup')
    expect(singular('volumes')).toBe('volume')
    expect(singular('queries')).toBe('query')
    expect(singular('boxes')).toBe('box')
  })
  it('leaves tricky words alone rather than mangling them', () => {
    expect(singular('process')).toBe('process') // -ss
    expect(singular('status')).toBe('status') // -us
    expect(singular('css')).toBe('css') // too short + -ss
  })
  // Proper nouns like "Kubernetes" end in -s but are names, not plurals; the
  // singulariser would over-strip them, so extractConcepts never calls it on
  // proper nouns (asserted in the extractConcepts suite below).
})

describe('extractConcepts', () => {
  it('keeps salient nouns and folds their plurals together', () => {
    const text =
      'Docker volume backups are now supported. The free backup tool added support ' +
      'for backing up Docker volumes and Kubernetes clusters. I run backups nightly.'
    const terms = extractConcepts(text).map((c) => c.term)
    expect(terms).toContain('docker')
    expect(terms).toContain('backup')
    expect(terms).toContain('volume')
    expect(terms).toContain('kubernetes')
  })

  it('drops adjectives, conjunctions, pronouns and generic heads', () => {
    const text = 'The free backup tool and I need something. It is a good thing.'
    const terms = extractConcepts(text).map((c) => c.term)
    for (const noise of ['free', 'and', 'i', 'it', 'tool', 'support', 'thing', 'something']) {
      expect(terms).not.toContain(noise)
    }
  })

  it('counts frequency and ranks the most repeated concept first', () => {
    const concepts = extractConcepts('Backups backups backups. Docker once.')
    expect(concepts[0]?.term).toBe('backup')
    expect(concepts[0]?.weight).toBeGreaterThanOrEqual(3)
  })

  it('is deterministic and empty-safe', () => {
    expect(extractConcepts('')).toEqual([])
    expect(extractConcepts('   ')).toEqual([])
    const a = extractConcepts('Docker and Kubernetes and Docker.')
    const b = extractConcepts('Docker and Kubernetes and Docker.')
    expect(a).toEqual(b)
  })

  it('emits adjacent noun compounds as their own concept', () => {
    // "docker" and "volume" are both nouns sitting next to each other
    const terms = extractConcepts('Docker volume snapshots. Docker volume snapshots.').map(
      (c) => c.term,
    )
    expect(terms).toContain('docker volume')
    // and still the single nouns
    expect(terms).toContain('docker')
    expect(terms).toContain('volume')
  })

  it('does not bridge a compound across a non-noun', () => {
    // "backup" and "restore" are separated by a verb, so no "backup restore"
    const terms = extractConcepts('The backup will restore quickly.').map((c) => c.term)
    expect(terms).not.toContain('backup restore')
  })

  it('caps how many concepts one page contributes', () => {
    const many = Array.from({ length: 40 }, (_, i) => `concept${i} widget${i}`).join('. ')
    expect(extractConcepts(many, 12).length).toBeLessThanOrEqual(12)
  })
})

describe('extractTriples', () => {
  it('pulls subject-verb-object from a clean sentence', () => {
    const t = extractTriples('Rigger deploys stacks. Docker runs containers.')
    expect(t).toContainEqual({ subject: 'rigger', verb: 'deploys', object: 'stack' })
    expect(t).toContainEqual({ subject: 'docker', verb: 'runs', object: 'container' })
  })

  it('drops auxiliary/linking verbs (no "X is Y" noise)', () => {
    expect(extractTriples('Rigger is a tool.')).toEqual([])
    expect(extractTriples('The backup was ready.')).toEqual([])
  })

  it('does not bridge a triple across a sentence boundary', () => {
    // "backups" ends the first sentence; "docker" starts the next
    const t = extractTriples('The tool stores backups. Docker helps.')
    expect(t.every((x) => !(x.subject === 'backup' && x.object === 'docker'))).toBe(true)
  })

  it('is deterministic and empty-safe', () => {
    expect(extractTriples('')).toEqual([])
    const a = extractTriples('Rigger deploys stacks.')
    expect(extractTriples('Rigger deploys stacks.')).toEqual(a)
  })
})
