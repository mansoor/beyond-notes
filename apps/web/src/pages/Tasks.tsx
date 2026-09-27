import type { ReminderFreq, ReminderView, TaskView } from '@bn/schema'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ErrorNote, Modal, SubmitButton, TimeField, fmtTime12, useSubmit } from '../components'
import { todayKey } from '../editor'
import { trpc } from '../trpc'

// a due token: `@YYYY-MM-DD`, optionally carrying `THH:MM` — stripped whole for display
const DUE_TOKEN = /@(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2})?\b/

// Emoji a reminder can wear instead of the bell — the occasions people
// actually set recurring reminders for.
const REMINDER_ICONS = [
  '🔔',
  '🎂',
  '💍',
  '🎓',
  '🏆',
  '🎉',
  '💊',
  '💳',
  '🩺',
  '🚗',
  '✈️',
  '🌱',
] as const

export function TasksPage() {
  const agenda = trpc.tasks.agenda.useQuery()
  const utils = trpc.useUtils()
  const quickAdd = trpc.tasks.quickAdd.useMutation({
    onSuccess: () => utils.tasks.agenda.invalidate(),
  })
  const [text, setText] = useState('')
  const [quickDue, setQuickDue] = useState('')

  const today = todayKey()
  const all = agenda.data ?? []
  const open = all.filter((t) => !t.checked)
  const groups = [
    { label: 'Overdue', tasks: open.filter((t) => t.due !== null && t.due < today), danger: true },
    { label: 'Today', tasks: open.filter((t) => t.due === today) },
    { label: 'Upcoming', tasks: open.filter((t) => t.due !== null && t.due > today) },
    { label: 'No date', tasks: open.filter((t) => t.due === null) },
    { label: 'Done', tasks: all.filter((t) => t.checked).slice(0, 20), dim: true },
  ]

  const submit = async () => {
    const value = text.trim()
    if (!value) return
    // strip any date the user typed by hand; the picker is the source of truth
    const base = value.replace(DUE_TOKEN, '').trim()
    await quickAdd.mutateAsync({ text: quickDue ? `${base} @${quickDue}` : base })
    setText('')
    setQuickDue('')
  }

  return (
    <div className="max-w-5xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-1">Tasks</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Every checkbox block, everywhere — one agenda. Checking here checks the block in its page.
      </p>

      <div
        className="flex items-center gap-2 rounded-xl border p-3 mb-8 flex-wrap"
        style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
      >
        <input
          className="flex-1 min-w-[180px] bg-transparent text-sm outline-none"
          placeholder="Quick task — lands in your Tasks inbox"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input
          type="date"
          title="Due date (optional)"
          className="rounded-lg border px-2 py-1 text-xs"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          value={quickDue}
          onChange={(e) => setQuickDue(e.target.value)}
        />
        <button
          type="button"
          onClick={submit}
          disabled={quickAdd.isPending || !text.trim()}
          className="rounded-lg px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          Add
        </button>
      </div>

      {groups.map(
        (g) =>
          g.tasks.length > 0 && (
            <section key={g.label} className="mb-7" style={{ opacity: g.dim ? 0.6 : 1 }}>
              <h3
                className="text-sm font-semibold mb-1"
                style={{ color: g.danger ? 'var(--danger)' : 'var(--text)' }}
              >
                {g.label}{' '}
                <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{g.tasks.length}</span>
              </h3>
              {g.tasks.map((t) => (
                <TaskRowItem key={t.id} task={t} />
              ))}
            </section>
          ),
      )}
      {all.length === 0 && agenda.isFetched && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          No tasks yet. Add one above, or type a checkbox block in any page.
        </p>
      )}

      <RemindersSection />
    </div>
  )
}

export function freqLabel(r: { freq: ReminderFreq | null; interval: number }): string {
  if (!r.freq) return 'one-time'
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq]
  return r.interval === 1 ? `⟳ every ${unit}` : `⟳ every ${r.interval} ${unit}s`
}

function RemindersSection() {
  const utils = trpc.useUtils()
  const list = trpc.reminders.list.useQuery()
  const invalidate = () => utils.reminders.list.invalidate()
  const complete = trpc.reminders.complete.useMutation({ onSuccess: invalidate })
  const del = trpc.reminders.delete.useMutation({ onSuccess: invalidate })
  const [creating, setCreating] = useState(false)
  const today = todayKey()

  const active = (list.data ?? []).filter((r) => !r.completed)

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold">
          Reminders <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{active.length}</span>
        </h3>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md border px-3 py-1 text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          ＋ New reminder
        </button>
      </div>
      <p className="text-xs mb-2" style={{ color: 'var(--text-3)' }}>
        Lightweight scheduled tasks — recurring ones re-arm when you check them off. Due and
        heads-up reminders appear on Today.
      </p>
      {active.map((r) => (
        <ReminderRow key={r.id} reminder={r} />
      ))}
      {active.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          No reminders yet.
        </p>
      )}
      {creating && <ReminderModal onClose={() => setCreating(false)} />}
    </section>
  )
}

function ReminderRow(props: { reminder: ReminderView }) {
  const utils = trpc.useUtils()
  const invalidate = () => utils.reminders.list.invalidate()
  const complete = trpc.reminders.complete.useMutation({ onSuccess: invalidate })
  const del = trpc.reminders.delete.useMutation({ onSuccess: invalidate })
  const [editing, setEditing] = useState(false)
  const r = props.reminder
  const today = todayKey()

  return (
    <div
      className="group flex items-center gap-2 py-1.5 border-b text-sm"
      style={{ borderColor: 'var(--border)' }}
    >
      <button
        type="button"
        title={r.freq ? 'Done — re-arms to the next occurrence' : 'Done'}
        disabled={complete.isPending}
        onClick={() => complete.mutate({ id: r.id })}
        className="text-sm"
      >
        {r.icon || '🔔'}
      </button>
      <span>{r.title}</span>
      <span
        className="text-[11px] rounded px-1.5 whitespace-nowrap"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {freqLabel(r)}
        {r.headsUpDays ? ` · ${r.headsUpDays}d before` : ''}
      </span>
      <span
        className="ml-auto text-xs whitespace-nowrap"
        style={{ color: r.dueDate < today ? 'var(--danger)' : 'var(--text-3)' }}
      >
        {r.dueDate === today ? 'today' : r.dueDate}
        {r.dueTime ? ` ${r.dueTime}` : ''}
      </span>
      <button
        type="button"
        title="Edit reminder"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs"
        style={{ color: 'var(--text-3)' }}
        onClick={() => setEditing(true)}
      >
        ✎
      </button>
      <button
        type="button"
        className="text-xs"
        style={{ color: 'var(--danger)' }}
        disabled={del.isPending}
        title="Delete reminder"
        onClick={() => del.mutate({ id: r.id })}
      >
        ✕
      </button>
      {editing && <ReminderModal reminder={r} onClose={() => setEditing(false)} />}
    </div>
  )
}

function ReminderModal(props: { reminder?: ReminderView; onClose: () => void }) {
  const utils = trpc.useUtils()
  const create = trpc.reminders.create.useMutation()
  const update = trpc.reminders.update.useMutation()
  const existing = props.reminder
  const [title, setTitle] = useState(existing?.title ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '🔔')
  const [initialDueDate] = useState(existing?.dueDate ?? todayKey())
  const [dueDate, setDueDate] = useState(initialDueDate)
  const [dueTime, setDueTime] = useState(existing?.dueTime ?? '')
  const [freq, setFreq] = useState<'' | ReminderFreq>(existing?.freq ?? '')
  const [interval, setInterval] = useState(String(existing?.interval ?? 1))
  const [headsUp, setHeadsUp] = useState(existing?.headsUpDays ? String(existing.headsUpDays) : '')
  const { busy, error, onSubmit } = useSubmit(async () => {
    const payload = {
      title,
      icon: icon === '🔔' ? null : icon,
      dueDate,
      dueTime: dueTime || null,
      freq: freq || null,
      interval: Math.max(1, Number(interval) || 1),
      headsUpDays: headsUp ? Number(headsUp) : null,
    }
    if (existing) await update.mutateAsync({ id: existing.id, ...payload })
    else await create.mutateAsync(payload)
    await utils.reminders.list.invalidate()
    props.onClose()
  })

  const selectStyle = { background: 'var(--bg)', borderColor: 'var(--border)' }
  const dirty = existing
    ? true
    : title.trim() !== '' ||
      dueDate !== initialDueDate ||
      dueTime !== '' ||
      freq !== '' ||
      interval !== '1' ||
      headsUp !== '' ||
      icon !== '🔔'

  return (
    <Modal
      title={existing ? 'Edit reminder' : 'New reminder'}
      onClose={props.onClose}
      dirty={dirty}
    >
      <form onSubmit={onSubmit}>
        <div className="flex gap-3 mb-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Icon</span>
            <select
              className="h-11 rounded-lg border px-2 text-lg"
              style={selectStyle}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
            >
              {REMINDER_ICONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1">
            <span className="block text-sm font-medium mb-1">What</span>
            <input
              autoFocus
              className="h-11 w-full rounded-lg border px-3 text-base outline-none focus:ring-2"
              style={selectStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">Due date</span>
            <input
              type="date"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={selectStyle}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <div className="block mb-4">
            <span className="block text-sm font-medium mb-1">Time (optional)</span>
            <TimeField
              value={dueTime || null}
              onChange={(v) => setDueTime(v ?? '')}
              clearable
              defaultOnOpen="09:00"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">Repeat</span>
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={selectStyle}
              value={freq}
              onChange={(e) => setFreq(e.target.value as '' | ReminderFreq)}
            >
              <option value="">one-time</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </label>
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">Every N</span>
            <input
              type="number"
              min={1}
              disabled={!freq}
              className="w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
              style={selectStyle}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
          </label>
        </div>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Heads-up before</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={selectStyle}
            value={headsUp}
            onChange={(e) => setHeadsUp(e.target.value)}
          >
            <option value="">none — notify on the day</option>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
            <option value="14">2 weeks</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
          </select>
        </label>
        <ErrorNote message={error} />
        <SubmitButton label={existing ? 'Save reminder' : 'Create reminder'} busy={busy} />
      </form>
    </Modal>
  )
}

export function DueReminderRow(props: { reminder: ReminderView }) {
  const utils = trpc.useUtils()
  const complete = trpc.reminders.complete.useMutation({
    onSuccess: () => utils.reminders.list.invalidate(),
  })
  const r = props.reminder
  return (
    <div
      className="flex items-center gap-2 py-1.5 border-b text-sm"
      style={{ borderColor: 'var(--border)' }}
    >
      <input
        type="checkbox"
        checked={false}
        disabled={complete.isPending}
        onChange={() => complete.mutate({ id: r.id })}
        style={{ accentColor: 'var(--accent)' }}
      />
      <span>
        {r.icon || '🔔'} {r.title}
      </span>
      <span
        className="text-[11px] rounded px-1.5"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {freqLabel(r)}
      </span>
      {r.dueTime && (
        <span className="ml-auto text-xs" style={{ color: 'var(--text-3)' }}>
          {r.dueTime}
        </span>
      )}
    </div>
  )
}

export function TaskRowItem(props: { task: TaskView }) {
  const utils = trpc.useUtils()
  const invalidate = () => utils.tasks.agenda.invalidate()
  const toggle = trpc.tasks.toggle.useMutation({ onSuccess: invalidate })
  const edit = trpc.tasks.edit.useMutation({ onSuccess: invalidate })
  const t = props.task
  const displayText = t.text.replace(DUE_TOKEN, '').trim() || t.text
  const today = todayKey()

  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState(displayText)
  const [draftDue, setDraftDue] = useState(t.due ?? '')
  const [draftTime, setDraftTime] = useState(t.dueTime ?? '')

  const source = t.isJournal
    ? t.pageTitle === 'Tasks inbox'
      ? 'Tasks inbox'
      : `Journal · ${t.pageTitle}`
    : `${t.spaceName} / ${t.pageTitle}`
  const isDayPage = t.isJournal && /^\d{4}-\d{2}-\d{2}$/.test(t.pageTitle)

  const openEdit = () => {
    setDraftText(displayText)
    setDraftDue(t.due ?? '')
    setDraftTime(t.dueTime ?? '')
    setEditing(true)
  }

  const save = async () => {
    const value = draftText.trim()
    if (!value) return
    await edit.mutateAsync({
      taskId: t.id,
      text: value,
      due: draftDue || null,
      // a time is only meaningful with a date
      dueTime: draftDue && draftTime ? draftTime : null,
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <div
        className="rounded-lg border p-3 my-1.5 flex flex-col gap-2.5 text-sm"
        style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
      >
        <input
          autoFocus
          className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="rounded-lg border px-2 py-1 text-xs"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={draftDue}
            onChange={(e) => setDraftDue(e.target.value)}
          />
          {draftDue && (
            <>
              <TimeField
                value={draftTime || null}
                onChange={(v) => setDraftTime(v ?? '')}
                clearable
                defaultOnOpen="23:59"
              />
              <button
                type="button"
                title="Clear due date"
                className="text-xs"
                style={{ color: 'var(--text-3)' }}
                onClick={() => {
                  setDraftDue('')
                  setDraftTime('')
                }}
              >
                clear date
              </button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={edit.isPending || !draftText.trim()}
            className="rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs"
            style={{ color: 'var(--text-3)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="group flex items-center gap-2 py-1.5 border-b text-sm"
      style={{ borderColor: 'var(--border)' }}
    >
      <input
        type="checkbox"
        checked={t.checked}
        disabled={toggle.isPending}
        onChange={(e) => toggle.mutate({ taskId: t.id, checked: e.target.checked })}
        style={{ accentColor: 'var(--accent)' }}
      />
      <span style={{ textDecoration: t.checked ? 'line-through' : undefined }}>{displayText}</span>
      <button
        type="button"
        title="Edit task"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs"
        style={{ color: 'var(--text-3)' }}
        onClick={openEdit}
      >
        ✎
      </button>
      <span
        className="text-[11px] rounded px-1.5 whitespace-nowrap"
        style={{ background: 'var(--accent-soft)', color: 'var(--text-3)' }}
      >
        {isDayPage ? (
          <Link to="/day/$date" params={{ date: t.pageTitle }}>
            {source}
          </Link>
        ) : t.isJournal ? (
          source
        ) : (
          <Link to="/p/$pageId" params={{ pageId: t.pageId }}>
            {source}
          </Link>
        )}
      </span>
      <button
        type="button"
        className={`ml-auto text-xs whitespace-nowrap ${t.due ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
        title="Edit due date & time"
        style={{ color: !t.checked && t.due && t.due < today ? 'var(--danger)' : 'var(--text-3)' }}
        onClick={openEdit}
      >
        {t.due ? (t.due === today ? 'today' : t.due) : '+ date'}
        {t.due && t.dueTime ? ` · ${fmtTime12(t.dueTime)}` : ''}
      </button>
    </div>
  )
}
