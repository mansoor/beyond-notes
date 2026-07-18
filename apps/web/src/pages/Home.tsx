import { Link } from '@tanstack/react-router'
import { todayKey } from '../editor'

export function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-10 py-10">
      <h1 className="text-2xl font-bold mb-1">Beyond Notes</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Pick a page in the sidebar, or jump to a surface:
      </p>
      <div className="flex gap-3 text-sm flex-wrap">
        <Link
          to="/day/$date"
          params={{ date: todayKey() }}
          className="rounded-lg border px-4 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        >
          📅 Today
        </Link>
        <Link
          to="/inbox"
          className="rounded-lg border px-4 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        >
          📥 Inbox
        </Link>
        <Link
          to="/tasks"
          className="rounded-lg border px-4 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        >
          ☑ Tasks
        </Link>
        <Link
          to="/settings"
          className="rounded-lg border px-4 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        >
          ⚙ Settings
        </Link>
      </div>
    </div>
  )
}
