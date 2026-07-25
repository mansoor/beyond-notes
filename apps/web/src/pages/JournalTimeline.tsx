import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { prettyDate } from '../editor'
import { trpc } from '../trpc'

/** Pull readable text out of a BlockNote document, one line per block. Tables
 *  (whose content is an object, not an inline array) are skipped — a journal is
 *  overwhelmingly paragraphs and timestamped lines. */
function blocksText(json: string): string {
  try {
    const blocks = JSON.parse(json) as unknown
    if (!Array.isArray(blocks)) return ''
    const lines: string[] = []
    const walk = (list: unknown[]) => {
      for (const b of list) {
        if (!b || typeof b !== 'object') continue
        const block = b as { content?: unknown; children?: unknown }
        if (Array.isArray(block.content)) {
          const text = (block.content as Array<{ text?: unknown }>)
            .map((i) => (typeof i?.text === 'string' ? i.text : ''))
            .join('')
          if (text.trim()) lines.push(text)
        }
        if (Array.isArray(block.children)) walk(block.children)
      }
    }
    walk(blocks)
    return lines.join('\n')
  } catch {
    return ''
  }
}

export function JournalTimelinePage() {
  const q = trpc.journal.timeline.useInfiniteQuery(
    { limit: 40 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  )
  const days = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-10 py-6 lg:py-8">
      <h1 className="text-2xl font-bold mb-1">Journal</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Every day you’ve written, newest first. Tap a day to read it.
      </p>

      {q.isLoading ? (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Loading…
        </p>
      ) : days.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          No journal entries yet. Anything you write on the Today page — or promote from the Inbox —
          shows up here.
        </p>
      ) : (
        <div className="flex flex-col">
          {days.map((d) => (
            <TimelineDay key={d.date} date={d.date} preview={d.preview} notes={d.notes} />
          ))}
        </div>
      )}

      {q.hasNextPage && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="rounded-lg border px-4 py-1.5 text-sm disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            {q.isFetchingNextPage ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  )
}

function TimelineDay(props: { date: string; preview: string; notes: number }) {
  const [open, setOpen] = useState(false)
  const notesQ = trpc.journal.notes.useQuery({ date: props.date }, { enabled: open })

  return (
    <div className="border-b py-3" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-baseline gap-3"
      >
        <span className="font-medium text-sm shrink-0" style={{ minWidth: 132 }}>
          {prettyDate(props.date)}
        </span>
        {open ? (
          props.notes > 1 && (
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {props.notes} notes
            </span>
          )
        ) : (
          <span className="text-sm truncate" style={{ color: 'var(--text-3)' }}>
            {props.preview || '—'}
          </span>
        )}
        <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--text-3)' }}>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="mt-2 pl-1">
          {notesQ.isLoading ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Loading…
            </p>
          ) : (
            <>
              {(notesQ.data ?? []).map((n) => {
                const text = blocksText(n.doc.content)
                return (
                  <div key={n.page.id} className="mb-3 last:mb-2">
                    {!n.main && (
                      <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
                        {n.page.title}
                      </div>
                    )}
                    {text ? (
                      <p
                        className="text-sm whitespace-pre-wrap"
                        style={{ color: 'var(--text-2)', lineHeight: 1.6 }}
                      >
                        {text}
                      </p>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                        (empty)
                      </p>
                    )}
                  </div>
                )
              })}
              <Link
                to="/day/$date"
                params={{ date: props.date }}
                className="text-xs underline"
                style={{ color: 'var(--accent)' }}
              >
                Open this day ↗
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
