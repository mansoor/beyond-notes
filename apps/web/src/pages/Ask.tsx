import type { AiSource } from '@bn/schema'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AiText, streamAi, useAi } from '../ai'
import { trpc } from '../trpc'

type Turn = {
  question: string
  answer: string
  sources: AiSource[]
  state: 'working' | 'done' | 'error'
  error: string | null
}

const EXAMPLES = [
  'What did I decide about the garden this spring?',
  'Summarise my notes on the house move',
  'When did I last write about the car?',
]

/**
 * Ask your notes: questions answered from what you may read, with the notes
 * each answer drew on. The conversation lives in this page only.
 */
export function AskPage() {
  const ai = useAi()
  const status = trpc.ai.status.useQuery()
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const stop = useRef<AbortController | null>(null)
  const end = useRef<HTMLDivElement | null>(null)
  const working = turns.at(-1)?.state === 'working'

  useEffect(() => () => stop.current?.abort(), [])
  // follow the answer as it grows
  useEffect(() => {
    if (turns.length > 0) end.current?.scrollIntoView({ block: 'end' })
  }, [turns])

  const ask = async (question: string) => {
    const q = question.trim()
    if (q.length < 2 || working) return
    const history = turns
      .filter((t) => t.state === 'done' && t.answer)
      .slice(-3)
      .map((t) => ({ question: t.question, answer: t.answer }))
    const index = turns.length
    const patch = (p: Partial<Turn>) =>
      setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, ...p } : t)))
    setTurns((prev) => [
      ...prev,
      { question: q, answer: '', sources: [], state: 'working', error: null },
    ])
    setDraft('')
    const ctrl = new AbortController()
    stop.current = ctrl
    try {
      await streamAi(
        '/api/ai/ask',
        { question: q, history },
        {
          onSources: (sources) => patch({ sources }),
          onText: (text) =>
            setTurns((prev) =>
              prev.map((t, i) => (i === index ? { ...t, answer: t.answer + text } : t)),
            ),
        },
        ctrl.signal,
      )
      patch({ state: 'done' })
    } catch (err) {
      if (ctrl.signal.aborted) patch({ state: 'done' })
      else patch({ state: 'error', error: (err as Error).message })
    }
  }

  if (status.isLoading) return null
  if (!ai.enabled) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-10 py-6 lg:py-8">
        <h1 className="text-2xl font-bold mb-2">Ask your notes</h1>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          AI isn't set up here. An admin can switch it on in Settings → AI, with a model server such
          as Ollama running on your own machine.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-10 py-6 lg:py-8 flex flex-col min-h-[calc(100dvh-3.5rem)] md:min-h-screen">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold flex-1">Ask your notes</h1>
        {turns.length > 0 && !working ? (
          <button
            type="button"
            className="text-sm underline"
            style={{ color: 'var(--text-3)' }}
            onClick={() => setTurns([])}
          >
            New conversation
          </button>
        ) : null}
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>
        Answers come from the notes you can open, on this server's own AI. Locked pages are never
        used.{ai.semantic ? '' : ' Notes are found by their words.'}
      </p>

      <div className="flex-1">
        {turns.length === 0 ? (
          <div className="flex flex-col gap-2 mb-6">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => void ask(e)}
                className="text-left text-sm rounded-lg border px-3 py-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}
        {turns.map((t, i) => (
          <div key={`${i}:${t.question}`} className="mb-8">
            <p className="font-semibold mb-2">{t.question}</p>
            {t.answer ? (
              <AiText text={t.answer} sources={t.sources} />
            ) : t.state === 'working' ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                {t.sources.length > 0
                  ? `Reading ${t.sources.length} note${t.sources.length === 1 ? '' : 's'}…`
                  : 'Looking through your notes…'}
              </p>
            ) : null}
            {t.error ? (
              <p className="text-sm mt-2" style={{ color: 'var(--danger)' }}>
                {t.error}
              </p>
            ) : null}
            {t.sources.length > 0 && t.state !== 'working' ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.sources.map((s) => (
                  <Link
                    key={s.n}
                    to="/p/$pageId"
                    params={{ pageId: s.pageId }}
                    className="text-xs rounded-md border px-2 py-1 max-w-full truncate"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
                  >
                    <span style={{ color: 'var(--accent)' }}>{s.n}</span> {s.title}
                    <span style={{ color: 'var(--text-3)' }}> · {s.context}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 pt-3 pb-4" style={{ background: 'var(--bg)' }}>
        <div className="flex gap-2 items-end">
          <textarea
            rows={2}
            aria-label="Your question"
            placeholder={turns.length ? 'Ask a follow-up…' : 'Ask anything about your notes…'}
            className="flex-1 rounded-lg border px-3 py-2 text-[15px] outline-none resize-none focus:ring-2"
            style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask(draft)
              }
            }}
          />
          {working ? (
            <button
              type="button"
              onClick={() => stop.current?.abort()}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              disabled={draft.trim().length < 2}
              onClick={() => void ask(draft)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              Ask
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
