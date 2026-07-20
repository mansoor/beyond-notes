import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { trpc } from '../trpc'

const WINDOWS = [
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
] as const

/** The maintainer's worklist: published pages that may have drifted out of date. */
export function StalePage() {
  const [days, setDays] = useState<number>(180)
  const stale = trpc.pages.stale.useQuery({ days })
  const navigate = useNavigate()

  return (
    <div className="max-w-5xl mx-auto px-10 py-8">
      <h1 className="text-2xl font-bold mb-1">Needs a look</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
        Pages nobody has edited in a while. Published ones are marked — those are what readers are
        seeing, so they are worth checking first.
      </p>

      <div className="flex items-center gap-2 mb-5 text-sm">
        <span style={{ color: 'var(--text-3)' }}>Untouched for</span>
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            onClick={() => setDays(w.days)}
            className="rounded-full border px-3 py-0.5 text-xs"
            style={{
              borderColor: 'var(--border)',
              background: days === w.days ? 'var(--accent-soft)' : undefined,
              color: days === w.days ? 'var(--accent)' : 'var(--text-2)',
            }}
          >
            {w.label}
          </button>
        ))}
      </div>

      {stale.data?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Nothing has gone stale. Everything has been touched in that window.
        </p>
      )}

      {stale.data?.map((p) => (
        <button
          key={p.id}
          type="button"
          className="flex items-center gap-3 border-b py-3 w-full text-left"
          style={{ borderColor: 'var(--border)' }}
          onClick={() => navigate({ to: '/p/$pageId', params: { pageId: p.id } })}
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{p.title}</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {p.spaceName} · last edited {new Date(p.updatedAt).toLocaleDateString()}
            </div>
          </div>
          {p.isLive && (
            <span
              className="text-[11px] font-semibold rounded-full px-2 py-0.5"
              style={{
                color: 'var(--live)',
                background: 'color-mix(in srgb, var(--live) 12%, transparent)',
              }}
            >
              live
            </span>
          )}
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
            {p.ageDays} days
          </span>
        </button>
      ))}
    </div>
  )
}
