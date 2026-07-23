/**
 * The lock screen: setting a password lock, and entering the password to open
 * one. Both dialogs say plainly what a lock is and is not — it keeps a notebook
 * off the screen of a borrowed laptop, it does not encrypt anything.
 */

import type { LockPolicyView, LockStateView } from '@bn/schema'
import { useState } from 'react'
import { ErrorNote, Modal, SubmitButton, useSubmit } from './components'
import { trpc } from './trpc'

export type LockTargetKind = 'space' | 'page'

/** The lock covering this thing, if this session knows about one. */
export function useLockState(target: LockTargetKind, id: string | null): LockStateView | null {
  // Poll so an idle lock that fires while the app sits open is noticed within
  // ~30s — the server reads this without sliding the idle window (isOpenPeek),
  // so the poll itself cannot keep a lock alive. staleTime under the interval
  // keeps navigations cheap between polls.
  const locks = trpc.locks.list.useQuery(undefined, {
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  if (!id) return null
  return (locks.data ?? []).find((l) => l.target === target && l.id === id) ?? null
}

const POLICY_LABEL: Record<LockPolicyView, string> = {
  session: 'Once per sign-in',
  idle: 'Again after a period of not using it',
}

/** Presets people actually reach for; the field takes anything else. */
const MINUTE_PRESETS = [5, 15, 30, 60, 120, 480]

function minutesLabel(m: number): string {
  if (m < 60) return `${m} minutes`
  const h = m / 60
  if (h === 1) return '1 hour'
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`
}

export function LockModal(props: {
  target: LockTargetKind
  id: string
  name: string
  current: LockStateView | null
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const set = trpc.locks.set.useMutation()
  const [policy, setPolicy] = useState<LockPolicyView>(props.current?.policy ?? 'session')
  const [minutes, setMinutes] = useState<number>(props.current?.idleMinutes ?? 30)
  const [password, setPassword] = useState('')
  const locking = !props.current

  const { busy, error, onSubmit } = useSubmit(async () => {
    await set.mutateAsync({
      target: props.target,
      id: props.id,
      policy: locking ? policy : null,
      idleMinutes: locking && policy === 'idle' ? minutes : null,
      password,
    })
    await utils.locks.list.invalidate()
    await utils.pages.get.invalidate()
    props.onClose()
  })

  return (
    <Modal
      title={locking ? `Lock “${props.name}”` : `Remove the lock on “${props.name}”`}
      onClose={props.onClose}
      dirty={password !== ''}
    >
      <form onSubmit={onSubmit}>
        {locking ? (
          <>
            <label className="block mb-3">
              <span className="block text-sm font-medium mb-1">Ask for the password</span>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                value={policy}
                onChange={(e) => setPolicy(e.target.value as LockPolicyView)}
              >
                {(['session', 'idle'] as LockPolicyView[]).map((p) => (
                  <option key={p} value={p}>
                    {POLICY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            {policy === 'idle' ? (
              <label className="block mb-3">
                <span className="block text-sm font-medium mb-1">After how long?</span>
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  {MINUTE_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMinutes(m)}
                      className="px-2 py-1 rounded-lg text-xs border"
                      style={{
                        borderColor: minutes === m ? 'var(--accent)' : 'var(--border)',
                        color: minutes === m ? 'var(--accent)' : 'var(--text-2)',
                      }}
                    >
                      {minutesLabel(m)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    className="w-24 rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                  <span className="text-sm" style={{ color: 'var(--text-2)' }}>
                    minutes
                  </span>
                </div>
              </label>
            ) : null}
            <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
              {policy === 'session'
                ? 'You enter your password once after signing in, and it stays open until you sign out.'
                : `It closes again after ${minutesLabel(minutes)} without opening it. Reading it keeps it open.`}
            </p>
            <p
              className="text-xs mb-4 rounded-lg border p-2"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            >
              <b>What this does:</b> hides it in the app behind your account password — for the
              laptop left open on the kitchen table. <b>What it does not do:</b> encrypt. Anyone
              holding the database file, a backup or a full export can still read it.
            </p>
          </>
        ) : (
          <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
            This removes the lock for good. It will open without a password from now on.
          </p>
        )}

        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Your account password</span>
          <input
            type="password"
            autoComplete="current-password"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <ErrorNote message={error} />
        <SubmitButton
          label={locking ? 'Lock it' : 'Remove the lock'}
          busy={busy || password === ''}
        />
      </form>
    </Modal>
  )
}

/** Asked when you open something locked. Grants this session only. */
export function UnlockModal(props: {
  target: LockTargetKind
  id: string
  name: string
  policy: LockPolicyView
  onClose: () => void
  onOpened: () => void
}) {
  const utils = trpc.useUtils()
  const unlock = trpc.locks.unlock.useMutation()
  const [password, setPassword] = useState('')

  const { busy, error, onSubmit } = useSubmit(async () => {
    await unlock.mutateAsync({ target: props.target, id: props.id, password })
    await utils.locks.list.invalidate()
    await utils.pages.get.invalidate()
    props.onOpened()
  })

  return (
    <Modal title={`🔒 ${props.name}`} onClose={props.onClose} dirty={password !== ''}>
      <form onSubmit={onSubmit}>
        <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
          {props.policy === 'session'
            ? 'Locked. It stays open until you sign out.'
            : 'Locked. It stays open while you are using it, and closes after 30 idle minutes.'}
        </p>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Your account password</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorNote message={error} />
        <SubmitButton label="Open" busy={busy || password === ''} />
      </form>
    </Modal>
  )
}
