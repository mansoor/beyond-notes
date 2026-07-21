import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { fmtTime12, prefersReducedMotion, useDayRollover } from '../components'
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
import { DueReminderRow, TaskRowItem, freqLabel } from './Tasks'

export function JournalPage() {
  const { date } = useParams({ from: '/app/day/$date' })
  const navigate = useNavigate()
  // midnight, while you are looking at it: the day folds into the calendar and
  // the new one drops out of it. Purely for the pleasure of it — the useful
  // half is that the page stops showing yesterday.
  const [roll, setRoll] = useState<'idle' | 'out' | 'in'>('idle')
  useDayRollover((nextDay) => {
    if (date === nextDay) return // not viewing the day that just ended
    const go = () => navigate({ to: '/day/$date', params: { date: nextDay } })
    if (prefersReducedMotion()) {
      go()
      return
    }
    setRoll('out')
    window.setTimeout(() => {
      go()
      setRoll('in')
      window.setTimeout(() => setRoll('idle'), 520)
    }, 420)
  })
  const notes = trpc.journal.notes.useQuery({ date })
  const agenda = trpc.tasks.agenda.useQuery()
  const memos = trpc.memos.list.useQuery()
  const reminders = trpc.reminders.list.useQuery()
  const [state, setState] = useState<SaveState>('saved')
  const utils = trpc.useUtils()
  const createNote = trpc.journal.createNote.useMutation({
    onSuccess: () => utils.journal.notes.invalidate({ date }),
  })
  const deleteNote = trpc.journal.deleteNote.useMutation({
    onSuccess: () =>
      Promise.all([utils.journal.notes.invalidate({ date }), utils.tasks.agenda.invalidate()]),
  })
  const [addingNote, setAddingNote] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')

  const addNote = async () => {
    const title = noteTitle.trim()
    if (!title) return
    await createNote.mutateAsync({ date, title })
    setNoteTitle('')
    setAddingNote(false)
  }

  const today = todayKey()
  const dueTasks = (agenda.data ?? []).filter((t) => !t.checked && t.due !== null && t.due <= date)
  const dueReminders = (reminders.data ?? []).filter((r) => !r.completed && r.dueDate <= date)
  const capturedThisDay = (memos.data ?? []).filter(
    (m) => toDateKey(new Date(m.createdAt)) === date,
  )

  // "Coming up" is real-world upcoming (relative to today, not the viewed
  // day): tasks due within the next 7 days plus every future reminder, one
  // list sorted by date. Overdue/today items live in the column, not here.
  const horizon = shiftDateKey(today, 7)
  type ComingUp =
    | { kind: 'reminder'; key: string; icon: string; title: string; date: string; hint: string }
    | {
        kind: 'task'
        key: string
        icon: string
        title: string
        date: string
        time: string | null
        hint: string
        pageId: string
        pageTitle: string
        isJournal: boolean
      }
  const comingUp: ComingUp[] = [
    ...(reminders.data ?? [])
      .filter((r) => !r.completed && r.dueDate > today)
      .map(
        (r): ComingUp => ({
          kind: 'reminder',
          key: `r:${r.id}`,
          icon: r.icon || '🔔',
          title: r.title,
          date: r.dueDate,
          hint: freqLabel(r),
        }),
      ),
    ...(agenda.data ?? [])
      .filter((t) => !t.checked && t.due !== null && t.due > today && (t.due as string) <= horizon)
      .map(
        (t): ComingUp => ({
          kind: 'task',
          key: `t:${t.id}`,
          icon: '☐',
          title: t.text.replace(/@\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?\b/, '').trim() || t.text,
          date: t.due as string,
          time: t.dueTime,
          hint: t.pageTitle,
          pageId: t.pageId,
          pageTitle: t.pageTitle,
          isJournal: t.isJournal,
        }),
      ),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12)

  return (
    <div className="flex min-h-screen relative">
      {/* outside the shrinking wrapper, or it would shrink along with it */}
      {roll !== 'idle' ? (
        <div className="day-roll-calendar" aria-hidden="true">
          📅
        </div>
      ) : null}
      <div
        className={`flex-1 min-w-0 max-w-5xl mx-auto px-10 py-8 ${
          roll === 'out' ? 'day-roll-out' : roll === 'in' ? 'day-roll-in' : ''
        }`}
      >
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

        {notes.data ? (
          notes.data.map((note) => (
            <section key={note.page.id} className={note.main ? '' : 'mt-8'}>
              {!note.main && (
                <div
                  className="flex items-center gap-2 border-t pt-5 mb-1"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <h2 className="text-lg font-semibold flex-1">{note.page.title}</h2>
                  <button
                    type="button"
                    className="text-xs underline"
                    style={{ color: 'var(--danger)' }}
                    title="Delete this note"
                    onClick={() => deleteNote.mutate({ pageId: note.page.id })}
                  >
                    delete
                  </button>
                </div>
              )}
              <DocumentEditor
                key={`${note.page.id}:${note.doc.updatedAt}`}
                pageId={note.page.id}
                doc={note.doc}
                onStateChange={setState}
                onReload={() => utils.journal.notes.invalidate({ date })}
              />
            </section>
          ))
        ) : (
          <div className="text-sm py-4" style={{ color: 'var(--text-3)' }}>
            {notes.error ? notes.error.message : 'Loading…'}
          </div>
        )}

        {addingNote ? (
          <div className="flex items-center gap-2 mt-6">
            <input
              autoFocus
              className="rounded-lg border px-3 py-1.5 text-sm flex-1 max-w-72"
              style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
              placeholder="Note topic (Work, Hobby, ...)"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addNote()
                if (e.key === 'Escape') setAddingNote(false)
              }}
            />
            <button
              type="button"
              onClick={addNote}
              disabled={createNote.isPending || !noteTitle.trim()}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              Add
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingNote(true)}
            className="mt-6 text-sm underline"
            style={{ color: 'var(--text-3)' }}
          >
            + Add a note for another topic
          </button>
        )}

        {(dueTasks.length > 0 || dueReminders.length > 0) && (
          <section className="mt-8">
            <h3
              className="text-xs uppercase tracking-wide font-semibold mb-2"
              style={{ color: 'var(--text-3)' }}
            >
              {date === today ? 'Due today & overdue' : 'Due by this day'}
            </h3>
            {dueReminders.map((r) => (
              <DueReminderRow key={r.id} reminder={r} />
            ))}
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
        {comingUp.length > 0 && (
          <div
            className="rounded-xl border p-4 mt-4 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
          >
            <h4
              className="text-xs uppercase tracking-wide font-semibold mb-2"
              style={{ color: 'var(--text-3)' }}
            >
              Coming up
            </h4>
            {comingUp.map((item) => {
              const timeSuffix = item.kind === 'task' && item.time ? ` ${fmtTime12(item.time)}` : ''
              const dateLabel = (item.date === today ? 'today' : item.date.slice(5)) + timeSuffix
              const body = (
                <>
                  <span className="truncate">
                    {item.icon} {item.title}
                  </span>
                  <span
                    className="text-xs whitespace-nowrap"
                    style={{ color: 'var(--text-3)' }}
                    title={item.hint}
                  >
                    {dateLabel}
                  </span>
                </>
              )
              if (item.kind === 'task') {
                const isDayPage = item.isJournal && /^\d{4}-\d{2}-\d{2}$/.test(item.pageTitle)
                // quick-added tasks share one "Tasks inbox" page; sending you to
                // the raw page dumps every checkbox at once — the agenda is the
                // real home for them. Journal-day tasks open their day; note
                // tasks open their note.
                const go = () => {
                  if (item.pageTitle === 'Tasks inbox') navigate({ to: '/tasks' })
                  else if (isDayPage)
                    navigate({ to: '/day/$date', params: { date: item.pageTitle } })
                  else navigate({ to: '/p/$pageId', params: { pageId: item.pageId } })
                }
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="flex w-full justify-between gap-2 py-1 text-left"
                    onClick={go}
                  >
                    {body}
                  </button>
                )
              }
              return (
                <div key={item.key} className="flex justify-between gap-2 py-1">
                  {body}
                </div>
              )
            })}
          </div>
        )}
        <RecentlyEdited />
      </aside>
    </div>
  )
}

/** Continue where you left off — the freshest pages across all spaces. */
function RecentlyEdited() {
  const recent = trpc.pages.recent.useQuery()
  const navigate = useNavigate()
  if (!recent.data || recent.data.length === 0) return null
  return (
    <div
      className="rounded-xl border p-4 mt-4 text-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      <h4
        className="text-xs uppercase tracking-wide font-semibold mb-2"
        style={{ color: 'var(--text-3)' }}
      >
        Recently edited
      </h4>
      {recent.data.map((p) => (
        <button
          key={p.id}
          type="button"
          className="block w-full text-left py-1"
          onClick={() => navigate({ to: '/p/$pageId', params: { pageId: p.id } })}
        >
          <span className="block truncate">{p.title}</span>
          <span className="block text-xs truncate" style={{ color: 'var(--text-3)' }}>
            {p.spaceName}
          </span>
        </button>
      ))}
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
