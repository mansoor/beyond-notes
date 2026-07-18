import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import {
  DocumentEditor,
  SaveBadge,
  type SaveState,
  parseDateKey,
  prettyDate,
  shiftDateKey,
  toDateKey,
  todayKey,
} from '../editor'
import { trpc } from '../trpc'
import { TaskRowItem } from './Tasks'

export function JournalPage() {
  const { date } = useParams({ from: '/app/day/$date' })
  const navigate = useNavigate()
  const day = trpc.journal.day.useQuery({ date })
  const agenda = trpc.tasks.agenda.useQuery()
  const memos = trpc.memos.list.useQuery()
  const [state, setState] = useState<SaveState>('saved')
  const utils = trpc.useUtils()

  const today = todayKey()
  const dueTasks = (agenda.data ?? []).filter((t) => !t.checked && t.due !== null && t.due <= date)
  const capturedThisDay = (memos.data ?? []).filter(
    (m) => toDateKey(new Date(m.createdAt)) === date,
  )

  return (
    <div className="flex">
      <div className="flex-1 min-w-0 max-w-3xl mx-auto px-10 py-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold flex-1">{prettyDate(date)}</h1>
          <SaveBadge state={state} />
        </div>
        <div className="flex items-center gap-2 mb-4 text-sm" style={{ color: 'var(--text-2)' }}>
          <button
            type="button"
            onClick={() => navigate({ to: '/day/$date', params: { date: shiftDateKey(date, -1) } })}
          >
            ← previous
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => navigate({ to: '/day/$date', params: { date: today } })}
          >
            today
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => navigate({ to: '/day/$date', params: { date: shiftDateKey(date, 1) } })}
          >
            next →
          </button>
        </div>

        {day.data ? (
          <DocumentEditor
            key={`${day.data.page.id}:${day.data.doc.updatedAt}`}
            pageId={day.data.page.id}
            doc={day.data.doc}
            onStateChange={setState}
            onReload={() => utils.journal.day.invalidate({ date })}
          />
        ) : (
          <div className="text-sm py-4" style={{ color: 'var(--text-3)' }}>
            {day.error ? day.error.message : 'Loading…'}
          </div>
        )}

        {dueTasks.length > 0 && (
          <section className="mt-8">
            <h3
              className="text-xs uppercase tracking-wide font-semibold mb-2"
              style={{ color: 'var(--text-3)' }}
            >
              {date === today ? 'Due today & overdue' : 'Due by this day'}
            </h3>
            {dueTasks.map((t) => (
              <TaskRowItem key={t.id} task={t} />
            ))}
          </section>
        )}

        {capturedThisDay.length > 0 && (
          <section className="mt-8">
            <h3
              className="text-xs uppercase tracking-wide font-semibold mb-2"
              style={{ color: 'var(--text-3)' }}
            >
              Captured this day
            </h3>
            {capturedThisDay.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border px-3 py-2 my-2 text-sm"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--panel)',
                  opacity: m.promotedTo ? 0.55 : 1,
                }}
              >
                <span className="font-mono text-xs mr-2" style={{ color: 'var(--text-3)' }}>
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {m.content}
                {m.promotedTo && (
                  <span className="ml-2 text-xs" style={{ color: 'var(--text-3)' }}>
                    → {m.promotedTo}
                  </span>
                )}
              </div>
            ))}
            <Link to="/inbox" className="text-xs underline" style={{ color: 'var(--text-3)' }}>
              open inbox
            </Link>
          </section>
        )}
      </div>

      <aside
        className="w-72 shrink-0 border-l px-5 py-8 hidden lg:block"
        style={{ borderColor: 'var(--border)' }}
      >
        <Calendar
          selected={date}
          onPick={(d) => navigate({ to: '/day/$date', params: { date: d } })}
        />
      </aside>
    </div>
  )
}

function Calendar(props: { selected: string; onPick: (date: string) => void }) {
  const [month, setMonth] = useState(props.selected.slice(0, 7)) // YYYY-MM
  const days = trpc.journal.days.useQuery({ month })
  const dots = new Set(days.data ?? [])

  const [y, m] = month.split('-').map(Number)
  const year = y ?? 2026
  const monthIdx = (m ?? 1) - 1
  const first = new Date(year, monthIdx, 1)
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday-first offset
  const today = todayKey()

  const shiftMonth = (delta: number) => {
    const d = new Date(year, monthIdx + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      <div className="flex items-center justify-between text-sm font-semibold mb-2">
        <button type="button" onClick={() => shiftMonth(-1)} style={{ color: 'var(--text-3)' }}>
          ‹
        </button>
        {label}
        <button type="button" onClick={() => shiftMonth(1)} style={{ color: 'var(--text-3)' }}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {['M', 'T', 'W', 'T2', 'F', 'S', 'S2'].map((d) => (
          <div key={d} className="font-semibold py-1" style={{ color: 'var(--text-3)' }}>
            {d.replace('2', '')}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${String(i)}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const dateKey = `${month}-${String(i + 1).padStart(2, '0')}`
          const isSelected = dateKey === props.selected
          const isToday = dateKey === today
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => props.onPick(dateKey)}
              className="relative rounded py-1"
              style={{
                background: isSelected ? 'var(--accent)' : undefined,
                color: isSelected ? '#fff' : isToday ? 'var(--accent)' : 'var(--text-2)',
                fontWeight: isToday || isSelected ? 650 : 400,
              }}
            >
              {i + 1}
              {dots.has(dateKey) && !isSelected && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 bottom-0 w-1 h-1 rounded-full"
                  style={{ background: 'var(--accent)', opacity: 0.6 }}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
