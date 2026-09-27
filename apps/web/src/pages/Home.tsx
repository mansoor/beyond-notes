import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ErrorNote } from '../components'
import { todayKey } from '../editor'
import { trpc } from '../trpc'

const DISMISSED_KEY = 'bn-onboarding-dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * First run: nothing in the sidebar yet. Offer a starter notebook that shows
 * how things work, or point at the importers; "Start empty" hides this for good
 * on this device.
 */
function GetStarted() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const starter = trpc.onboarding.starter.useMutation()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [error, setError] = useState<string | null>(null)
  if (dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // private mode: it just shows again next time
    }
    setDismissed(true)
  }

  const create = async () => {
    setError(null)
    try {
      const result = await starter.mutateAsync()
      await Promise.all([utils.spaces.list.invalidate(), utils.pages.tree.invalidate()])
      if (result?.firstPageId) {
        navigate({ to: '/p/$pageId', params: { pageId: result.firstPageId } })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the starter notebook.')
    }
  }

  return (
    <section
      className="rounded-xl border p-5 mb-8"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      <h2 className="font-semibold mb-1">Get started</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
        Your notes will live in the sidebar. Start with a short notebook that shows how things work,
        bring your notes over from another app, or start with a blank slate.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={create}
          disabled={starter.isPending}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--accent)' }}
        >
          {starter.isPending ? 'Setting it up…' : 'Add a “Getting started” notebook'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          Start empty
        </button>
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Coming from Notion, Obsidian or Evernote? Choose <b>+ New space</b> in the sidebar and tick
        “Import content into it”.
      </p>
      <ErrorNote message={error} />
    </section>
  )
}

export function HomePage() {
  const spaces = trpc.spaces.list.useQuery()
  const empty = spaces.data !== undefined && spaces.data.length === 0

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-10 py-10">
      <h1 className="text-2xl font-bold mb-1">Beyond Notes</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        Pick a page in the sidebar, or jump to a surface:
      </p>
      {empty ? <GetStarted /> : null}
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
