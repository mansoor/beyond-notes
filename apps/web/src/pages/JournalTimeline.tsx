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

type Day = { date: string; preview: string; notes: number }

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Fold state for the year/month sections, remembered in this browser. We store
 *  the collapsed keys (year "2026", month "2026-07"), so a brand-new section
 *  defaults to open. */
const COLLAPSE_KEY = 'bn-journal-collapsed'
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? (arr as string[]) : [])
  } catch {
    return new Set()
  }
}

/** Group days (newest-first) into year -> month -> days, preserving order. */
function groupByYearMonth(days: Day[]) {
  const byYear = new Map<string, Map<string, Day[]>>()
  for (const d of days) {
    const year = d.date.slice(0, 4)
    const monthKey = d.date.slice(0, 7) // YYYY-MM
    let months = byYear.get(year)
    if (!months) {
      months = new Map()
      byYear.set(year, months)
    }
    const list = months.get(monthKey)
    if (list) list.push(d)
    else months.set(monthKey, [d])
  }
  return byYear
}

export function JournalTimelinePage() {
  const q = trpc.journal.timeline.useInfiniteQuery(
    { limit: 40 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  )
  const days = q.data?.pages.flatMap((p) => p.items) ?? []
  const byYear = groupByYearMonth(days)

  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed())
  const save = (next: Set<string>) => {
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]))
    } catch {
      // private mode / full quota — folding still works this session
    }
  }
  const toggle = (key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    save(next)
  }
  const expandAll = () => save(new Set())
  // collapse to just the year rows (a collapsed year hides its months anyway)
  const collapseAll = () => save(new Set(byYear.keys()))

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
        <div className="flex flex-col gap-1">
          {[...byYear.entries()].map(([year, months]) => {
            const yearCount = [...months.values()].reduce((n, list) => n + list.length, 0)
            const yearOpen = !collapsed.has(year)
            return (
              <div key={year}>
                <div className="group flex items-center gap-2 border-b py-2" style={{ borderColor: 'var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => toggle(year)}
                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                  >
                    <span className="text-xs w-4 shrink-0" style={{ color: 'var(--text-3)' }}>
                      {yearOpen ? '▾' : '▸'}
                    </span>
                    <span className="text-lg font-semibold">{year}</span>
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {yearCount} {yearCount === 1 ? 'day' : 'days'}
                    </span>
                  </button>
                  {/* hover-revealed on desktop; always shown on touch (no hover) */}
                  <div className="flex items-center gap-1 shrink-0 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                    <button
                      type="button"
                      title="Expand all"
                      aria-label="Expand all"
                      onClick={expandAll}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <span className="msym" style={{ fontSize: 18 }}>
                        unfold_more
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Collapse all"
                      aria-label="Collapse all"
                      onClick={collapseAll}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <span className="msym" style={{ fontSize: 18 }}>
                        unfold_less
                      </span>
                    </button>
                  </div>
                </div>

                {yearOpen &&
                  [...months.entries()].map(([monthKey, list]) => {
                    const monthOpen = !collapsed.has(monthKey)
                    const monthName = MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey
                    return (
                      <div key={monthKey}>
                        <button
                          type="button"
                          onClick={() => toggle(monthKey)}
                          className="w-full flex items-center gap-2 text-left pl-4 py-1.5"
                        >
                          <span className="text-xs w-4 shrink-0" style={{ color: 'var(--text-3)' }}>
                            {monthOpen ? '▾' : '▸'}
                          </span>
                          <span className="text-sm font-medium">{monthName}</span>
                          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                            {list.length}
                          </span>
                        </button>
                        {monthOpen && (
                          <div className="pl-4">
                            {list.map((d) => (
                              <TimelineDay
                                key={d.date}
                                date={d.date}
                                preview={d.preview}
                                notes={d.notes}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })}
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
