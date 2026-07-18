import type { TaskView } from '@bn/schema'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { todayKey } from '../editor'
import { trpc } from '../trpc'

const DUE_TOKEN = /@(\d{4}-\d{2}-\d{2})\b/

export function TasksPage() {
  const agenda = trpc.tasks.agenda.useQuery()
  const utils = trpc.useUtils()
  const quickAdd = trpc.tasks.quickAdd.useMutation({
    onSuccess: () => utils.tasks.agenda.invalidate(),
  })
  const [text, setText] = useState('')

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
    await quickAdd.mutateAsync({ text: value })
    setText('')
  }

  return (
    <div className="max-w-3xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-1">Tasks</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Every checkbox block, everywhere — one agenda. Checking here checks the block in its page.
      </p>

      <div
        className="flex gap-2 rounded-xl border p-3 mb-8"
        style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
      >
        <input
          className="flex-1 bg-transparent text-sm outline-none"
          placeholder="Quick task — lands in your Tasks inbox; @2026-07-25 sets a due date"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
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
    </div>
  )
}

export function TaskRowItem(props: { task: TaskView }) {
  const utils = trpc.useUtils()
  const toggle = trpc.tasks.toggle.useMutation({
    onSuccess: () => utils.tasks.agenda.invalidate(),
  })
  const t = props.task
  const displayText = t.text.replace(DUE_TOKEN, '').trim() || t.text
  const today = todayKey()

  const source = t.isJournal
    ? t.pageTitle === 'Tasks inbox'
      ? 'Tasks inbox'
      : `Journal · ${t.pageTitle}`
    : `${t.spaceName} / ${t.pageTitle}`
  const isDayPage = t.isJournal && /^\d{4}-\d{2}-\d{2}$/.test(t.pageTitle)

  return (
    <div
      className="flex items-center gap-2 py-1.5 border-b text-sm"
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
      {t.due && (
        <span
          className="ml-auto text-xs whitespace-nowrap"
          style={{ color: !t.checked && t.due < today ? 'var(--danger)' : 'var(--text-3)' }}
        >
          {t.due === today ? 'today' : t.due}
        </span>
      )}
    </div>
  )
}
