/**
 * The web side of AI (server: ai.ts): reading an answer as it streams in, and
 * showing it. Answers are Markdown-ish text from a model, so they're rendered
 * by a small React renderer (paragraphs, bullets, bold, citations) — never as
 * HTML.
 */
import type { AiSource } from '@bn/schema'
import { Link } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { trpc } from './trpc'

/** Is AI on here (and finding notes by meaning)? Cheap, cached. */
export function useAi() {
  const q = trpc.ai.status.useQuery(undefined, { staleTime: 5 * 60 * 1000 })
  return q.data ?? { enabled: false, semantic: false }
}

export type StreamHandlers = {
  onSources?: (sources: AiSource[]) => void
  onText: (text: string) => void
}

/**
 * POST to an AI endpoint and read its server-sent events until done.
 * Rejects with the server's own explanation when something goes wrong.
 */
export async function streamAi(
  url: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? 'The AI is not available right now.')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })
    for (let end = buf.indexOf('\n\n'); end >= 0; end = buf.indexOf('\n\n')) {
      const block = buf.slice(0, end)
      buf = buf.slice(end + 2)
      const event = block.match(/^event: (.*)$/m)?.[1]
      const raw = block.match(/^data: (.*)$/m)?.[1]
      if (!event || raw === undefined) continue
      const data = JSON.parse(raw)
      if (event === 'sources') handlers.onSources?.(data.sources)
      else if (event === 'text') handlers.onText(data.text)
      else if (event === 'error') throw new Error(data.message)
      else if (event === 'done') return
    }
  }
}

/** **bold**, `code` and [n] citations inside a line. */
function inline(text: string, cite: (n: number) => ReactNode, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[(\d{1,2})\]/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(<strong key={`${key}b${i}`}>{m[1]}</strong>)
    else if (m[2] !== undefined)
      out.push(
        <code
          key={`${key}c${i}`}
          className="rounded px-1 text-[0.9em]"
          style={{ background: 'var(--accent-soft)' }}
        >
          {m[2]}
        </code>,
      )
    else out.push(<span key={`${key}n${i}`}>{cite(Number(m[3]))}</span>)
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * A model's answer, rendered: paragraphs, bullet and numbered lists, headings
 * as bold lines, and [n] citations as links to the notes they name.
 */
export function AiText(props: { text: string; sources?: AiSource[] }) {
  const byN = new Map((props.sources ?? []).map((s) => [s.n, s]))
  const cite = (n: number): ReactNode => {
    const s = byN.get(n)
    if (!s) return `[${n}]`
    return (
      <Link
        to="/p/$pageId"
        params={{ pageId: s.pageId }}
        title={s.title}
        className="inline-block align-super text-[10px] font-semibold rounded px-1 mx-px no-underline"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {n}
      </Link>
    )
  }
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`
      blocks.push(
        <p key={k} className="mb-2 last:mb-0">
          {inline(para.join(' '), cite, k)}
        </p>,
      )
    }
    para = []
  }
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`
      const items = list.items.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of an answer have no identity but their place
        <li key={`${k}${i}`}>{inline(it, cite, `${k}${i}`)}</li>
      ))
      blocks.push(
        list.ordered ? (
          <ol key={k} className="list-decimal pl-5 mb-2 last:mb-0 space-y-0.5">
            {items}
          </ol>
        ) : (
          <ul key={k} className="list-disc pl-5 mb-2 last:mb-0 space-y-0.5">
            {items}
          </ul>
        ),
      )
    }
    list = null
  }
  for (const rawLine of props.text.split('\n')) {
    const line = rawLine.trim()
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (!line) {
      flushPara()
      flushList()
    } else if (bullet || numbered) {
      flushPara()
      const ordered = !bullet
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push(((bullet ?? numbered) as RegExpMatchArray)[1] as string)
    } else if (heading) {
      flushPara()
      flushList()
      const k = `h${blocks.length}`
      blocks.push(
        <p key={k} className="font-semibold mb-1">
          {inline(heading[1] as string, cite, k)}
        </p>,
      )
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return <div className="text-[15px] leading-relaxed">{blocks}</div>
}

/**
 * "Summarise this day / week" under a journal day: streams the summary, then
 * offers to keep it on the day's page.
 */
export function AiSummaryPanel(props: {
  date: string
  kind: 'day' | 'week'
  onClose: () => void
  onKept: () => void
}) {
  const [text, setText] = useState('')
  const [state, setState] = useState<'working' | 'done' | 'error'>('working')
  const [error, setError] = useState<string | null>(null)
  const [kept, setKept] = useState(false)
  const addToDay = trpc.ai.addToDay.useMutation()
  const stop = useRef<AbortController | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    stop.current = ctrl
    setText('')
    setState('working')
    setError(null)
    setKept(false)
    streamAi(
      '/api/ai/summary',
      { kind: props.kind, date: props.date, tzOffset: new Date().getTimezoneOffset() },
      { onText: (t) => setText((prev) => prev + t) },
      ctrl.signal,
    )
      .then(() => setState('done'))
      .catch((err: Error) => {
        if (ctrl.signal.aborted) return
        setError(err.message)
        setState('error')
      })
    return () => ctrl.abort()
  }, [props.date, props.kind])

  const heading = props.kind === 'day' ? 'Summary of the day' : 'Summary of the week'
  return (
    <section
      className="rounded-xl border p-4 mb-5"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold flex-1">✨ {heading}</h2>
        {state === 'working' ? (
          <button
            type="button"
            className="text-xs underline"
            style={{ color: 'var(--text-3)' }}
            onClick={() => {
              stop.current?.abort()
              setState('done')
            }}
          >
            stop
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Close the summary"
          className="text-sm px-1"
          style={{ color: 'var(--text-3)' }}
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>
      {text ? (
        <AiText text={text} />
      ) : state === 'working' ? (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Reading your notes…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm mt-2" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      {state === 'done' && text && !text.startsWith('Nothing was written down') ? (
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            disabled={kept || addToDay.isPending}
            onClick={async () => {
              await addToDay.mutateAsync({
                date: props.date,
                markdown: `### ${heading}\n\n${text}`,
              })
              setKept(true)
              props.onKept()
            }}
            className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-60"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-2)',
              background: 'var(--bg)',
            }}
          >
            {kept ? 'Added to this day' : 'Add to this day’s page'}
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(text)}
            className="rounded-md border px-2.5 py-1 text-xs"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-2)',
              background: 'var(--bg)',
            }}
          >
            Copy
          </button>
        </div>
      ) : null}
    </section>
  )
}
