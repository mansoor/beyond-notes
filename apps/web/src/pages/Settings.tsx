import { useState } from 'react'
import { ErrorNote, Field, SubmitButton, useSubmit } from '../components'
import {
  type HideableKind,
  JOURNAL_NAV_TOKEN,
  KIND_LABEL,
  TAGS_NAV_TOKEN,
  TASKS_NAV_TOKEN,
  catToken,
  dbToken,
  spaceToken,
  useSidebarPrefs,
} from '../sidebarprefs'
import { trpc } from '../trpc'

const TABS = [
  'Account',
  'Appearance',
  'Security',
  'Notifications',
  'Integrations',
  'Users',
  'Storage',
] as const
type Tab = (typeof TABS)[number]
const ADMIN_TABS: Tab[] = ['Users', 'Storage']
const TAB_ICONS: Record<Tab, string> = {
  Account: '👤',
  Appearance: '👁',
  Security: '🔒',
  Notifications: '🔔',
  Integrations: '🔗',
  Users: '👥',
  Storage: '🗄',
}

export function SettingsPage() {
  const status = trpc.auth.status.useQuery()
  const isAdmin = status.data?.me?.role === 'admin'
  const [tab, setTab] = useState<Tab>('Account')
  const tabs = TABS.filter((t) => !ADMIN_TABS.includes(t) || isAdmin)

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-10 py-6 lg:py-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      {/* stacks on mobile — a dropdown picks the section (a wrapping tab row
          spilled onto more lines with each added section) while md+ keeps the
          fixed-width vertical rail */}
      <div className="flex flex-col md:flex-row gap-4 md:gap-8 items-stretch md:items-start">
        <select
          className="md:hidden w-full rounded-lg border px-3 py-2 text-sm"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          value={tab}
          onChange={(e) => setTab(e.target.value as Tab)}
        >
          {tabs.map((t) => (
            <option key={t} value={t}>
              {TAB_ICONS[t]} {t}
            </option>
          ))}
        </select>
        <nav className="hidden md:flex md:flex-col md:gap-0.5 md:w-44 md:shrink-0 md:sticky md:top-8">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="flex items-center gap-2 text-left px-3 py-2 text-sm rounded-lg"
              style={{
                color: tab === t ? 'var(--accent)' : 'var(--text-2)',
                background: tab === t ? 'var(--accent-soft)' : undefined,
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              <span className="text-xs">{TAB_ICONS[t]}</span>
              {t}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          {tab === 'Account' && <AccountTab />}
          {tab === 'Appearance' && <AppearanceTab />}
          {tab === 'Security' && <SecurityTab />}
          {tab === 'Notifications' && <NotificationsTab isAdmin={isAdmin} />}
          {tab === 'Integrations' && <IntegrationsTab />}
          {tab === 'Users' && isAdmin && <UsersTab />}
          {tab === 'Storage' && isAdmin && <StorageTab />}
        </div>
      </div>
    </div>
  )
}

/**
 * Sidebar visibility. Hiding is only about what takes up room: a hidden section
 * keeps its spaces, still accepts new ones, and creating something of a hidden
 * kind warns and offers to unhide rather than being refused.
 */
function AppearanceTab() {
  const prefs = useSidebarPrefs()
  const spaces = trpc.spaces.list.useQuery()
  const databases = trpc.databases.list.useQuery()

  const kinds: HideableKind[] = ['notebook', 'site', 'wiki', 'database']

  const itemsOf = (kind: HideableKind) =>
    kind === 'database'
      ? (databases.data ?? []).map((d) => ({ id: d.id, name: d.name, token: dbToken(d.id) }))
      : (spaces.data ?? [])
          .filter((sp) => sp.category === kind)
          .map((sp) => ({ id: sp.id, name: sp.name, token: spaceToken(sp.id) }))

  return (
    <>
      <ComingUpCard />
      <DeleteConfirmCard />
      <LinkCaptureCard />
      <Card title="Sidebar">
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          Hide sections you do not use, or single items inside them. Nothing is deleted or turned
          off — a hidden space still works, still takes new pages, and comes back the moment you
          untick it. Applies everywhere you sign in.
        </p>
        <div className="mb-4 flex flex-col gap-2">
          {(
            [
              { token: JOURNAL_NAV_TOKEN, label: 'Journal timeline', hint: 'the “Journal” link' },
              { token: TASKS_NAV_TOKEN, label: 'Tasks', hint: 'the “Tasks” link' },
              { token: TAGS_NAV_TOKEN, label: 'Tags', hint: 'the “Tags” link' },
            ] as const
          ).map((nav) => (
            <label key={nav.token} className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={!prefs.isHidden(nav.token)}
                disabled={prefs.saving}
                onChange={(e) => prefs.setHidden(nav.token, !e.target.checked)}
              />
              {nav.label}
              <span className="text-xs font-normal" style={{ color: 'var(--text-3)' }}>
                — {nav.hint} under Today
              </span>
            </label>
          ))}
        </div>
        {kinds.map((kind) => {
          const sectionHidden = prefs.isHidden(catToken(kind))
          const items = itemsOf(kind)
          return (
            <div key={kind} className="mb-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={!sectionHidden}
                  disabled={prefs.saving}
                  onChange={(e) => prefs.setHidden(catToken(kind), !e.target.checked)}
                />
                {KIND_LABEL[kind]}
                {sectionHidden ? (
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    hidden
                  </span>
                ) : null}
              </label>
              <div className="pl-6 mt-1 flex flex-col gap-0.5">
                {items.length === 0 ? (
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    none yet
                  </span>
                ) : (
                  items.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 text-sm"
                      style={{ opacity: sectionHidden ? 0.45 : 1 }}
                    >
                      <input
                        type="checkbox"
                        checked={!prefs.isHidden(item.token)}
                        disabled={prefs.saving || sectionHidden}
                        onChange={(e) => prefs.setHidden(item.token, !e.target.checked)}
                      />
                      <span style={{ color: 'var(--text-2)' }}>{item.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </Card>
    </>
  )
}

/**
 * How far ahead "Coming up" reaches on the Today page. It used to be seven
 * hard-coded days for tasks and no limit at all for reminders, which is how a
 * reminder for next spring ended up on today's page — and then one setting for
 * both, which made a useful task horizon a useless reminder one.
 */
function ComingUpCard() {
  const prefs = useSidebarPrefs()
  return (
    <Card title="Today page">
      <span className="block text-sm font-medium mb-2">“Coming up” looks ahead</span>
      <div className="flex flex-wrap gap-6">
        <HorizonField
          label="Tasks"
          hint="due dates on checklist items"
          value={prefs.taskDays}
          saving={prefs.saving}
          onCommit={(taskDays) => prefs.setHorizons({ taskDays })}
        />
        <HorizonField
          label="Reminders"
          hint="usually set further out"
          value={prefs.reminderDays}
          saving={prefs.saving}
          onCommit={(reminderDays) => prefs.setHorizons({ reminderDays })}
        />
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Anything further out than its own horizon stays off the Today page. A reminder with a
        heads-up window is the exception — it appears when its own window opens, however far away
        the date is, which is what that setting is for.
      </p>
    </Card>
  )
}

/**
 * Whether Delete asks first. Deleting is already reversible for 30 days, so
 * this is about the surprise rather than the loss — the guard is worth keeping
 * if you ever delete the page you are reading.
 */
function DeleteConfirmCard() {
  const prefs = useSidebarPrefs()
  return (
    <Card title="Deleting">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.confirmDelete}
          disabled={prefs.saving}
          onChange={(e) => prefs.setConfirmDelete(e.target.checked)}
        />
        <span>Ask “Are you sure?” before deleting a page</span>
      </label>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Deleted pages go to the Trash and can be restored for 30 days either way. Deleting a whole
        notebook, site, or wiki always asks — that one is not covered by this setting.
      </p>
    </Card>
  )
}

/**
 * How much of a shared link to pull into the Inbox. The app fetches the page
 * server-side and prefills the capture box for review either way.
 */
function LinkCaptureCard() {
  const prefs = useSidebarPrefs()
  return (
    <Card title="Shared links">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.linkCaptureFull}
          disabled={prefs.saving}
          onChange={(e) => prefs.setLinkCaptureFull(e.target.checked)}
        />
        <span>Capture the full article when a link is shared</span>
      </label>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        On, sharing a link pulls the whole readable article into the Inbox. Off, it grabs just the
        title and opening paragraph. Either way the text is prefilled for you to edit before saving.
      </p>
    </Card>
  )
}

function HorizonField(props: {
  label: string
  hint: string
  value: number
  saving: boolean
  onCommit: (days: number) => Promise<unknown>
}) {
  // local while typing, server value once committed — so a half-typed "1" on
  // the way to "14" is not saved and echoed back
  const [draft, setDraft] = useState<number | null>(null)
  const value = draft ?? props.value

  return (
    <label className="block">
      <span className="block text-sm mb-1">{props.label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={90}
          className="w-20 rounded-lg border px-3 py-2 text-sm"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          value={value}
          disabled={props.saving}
          onChange={(e) => setDraft(Number(e.target.value))}
          onBlur={async (e) => {
            const clamped = Math.min(Math.max(Math.round(Number(e.target.value)) || 1, 1), 90)
            setDraft(clamped)
            await props.onCommit(clamped)
            setDraft(null)
          }}
        />
        <span className="text-sm" style={{ color: 'var(--text-2)' }}>
          days
        </span>
      </div>
      <span className="block text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
        {props.hint}
      </span>
    </label>
  )
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border p-5 mb-5"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      <h2 className="font-semibold mb-3">{props.title}</h2>
      {props.children}
    </section>
  )
}

function AccountTab() {
  return <ProfileCard />
}

function ProfileCard() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const update = trpc.auth.updateProfile.useMutation()
  const me = status.data?.me
  const [name, setName] = useState(me?.name ?? '')
  const [email, setEmail] = useState(me?.email ?? '')
  const [loaded, setLoaded] = useState(Boolean(me))
  const [done, setDone] = useState(false)
  if (me && !loaded) {
    setName(me.name)
    setEmail(me.email)
    setLoaded(true)
  }
  const { busy, error, onSubmit } = useSubmit(async () => {
    await update.mutateAsync({ name, email })
    await utils.auth.status.invalidate()
    setDone(true)
  })
  const dirty = me ? name !== me.name || email !== me.email : false

  return (
    <Card title="Profile">
      <form onSubmit={onSubmit}>
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Email (used to sign in)" type="email" value={email} onChange={setEmail} />
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
          Role: {me?.role}
        </p>
        <ErrorNote message={error} />
        {done && !dirty && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Profile saved.
          </p>
        )}
        <SubmitButton label="Save profile" busy={busy} />
      </form>
    </Card>
  )
}

function ChangePasswordCard() {
  const change = trpc.auth.changePassword.useMutation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (next !== confirm) throw new Error('New passwords do not match.')
    await change.mutateAsync({ current, next })
    setCurrent('')
    setNext('')
    setConfirm('')
    setDone(true)
  })
  const mismatch = confirm !== '' && next !== confirm

  return (
    <Card title="Change password">
      <form onSubmit={onSubmit}>
        <Field label="Current password" type="password" value={current} onChange={setCurrent} />
        <Field
          label="New password (10+ characters)"
          type="password"
          value={next}
          onChange={setNext}
        />
        <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} />
        {mismatch && (
          <p className="text-sm mb-3" style={{ color: 'var(--danger)' }}>
            Passwords do not match yet.
          </p>
        )}
        <ErrorNote message={error} />
        {done && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Password changed.
          </p>
        )}
        <SubmitButton label="Change password" busy={busy} />
      </form>
    </Card>
  )
}

function SecurityTab() {
  const status = trpc.auth.status.useQuery()
  const isAdmin = status.data?.me?.role === 'admin'
  return (
    <>
      <ChangePasswordCard />
      <TwoFactorCard />
      <SessionsCard />
      {/* form spam protection is a security control, not a notification channel —
          it only lived on that tab because reCAPTCHA needed a home */}
      {isAdmin ? <RecaptchaCard /> : null}
    </>
  )
}

function TwoFactorCard() {
  const utils = trpc.useUtils()
  const start = trpc.auth.totpStart.useMutation()
  const confirm = trpc.auth.totpConfirm.useMutation()
  const disable = trpc.auth.totpDisable.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const [enrollment, setEnrollment] = useState<{ secret: string; url: string } | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)

  // 2FA state isn't in AuthStatus; derive lazily: totpStart fails when enabled
  const begin = async () => {
    setError(null)
    try {
      setEnrollment(await start.mutateAsync())
      setEnabled(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('already enabled')) setEnabled(true)
      else setError(message)
    }
  }

  const verify = async () => {
    setError(null)
    try {
      const res = await confirm.mutateAsync({ code })
      setRecovery(res.recoveryCodes)
      setEnrollment(null)
      setEnabled(true)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <Card title="Two-factor authentication (TOTP)">
      {recovery && (
        <div
          className="rounded-lg border p-3 mb-4 text-sm"
          style={{ borderColor: 'var(--live)', background: 'var(--bg)' }}
        >
          <p className="font-semibold mb-2" style={{ color: 'var(--live)' }}>
            2FA enabled. Save these recovery codes now — they are shown once:
          </p>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">
            {recovery.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}
      {enrollment ? (
        <div className="text-sm">
          <p className="mb-2" style={{ color: 'var(--text-2)' }}>
            Add this secret to your authenticator app (or paste the otpauth URL), then enter the
            6-digit code:
          </p>
          <p
            className="font-mono text-xs break-all rounded border p-2 mb-1"
            style={{ borderColor: 'var(--border)' }}
          >
            {enrollment.secret}
          </p>
          <p className="font-mono text-[10px] break-all mb-3" style={{ color: 'var(--text-3)' }}>
            {enrollment.url}
          </p>
          <div className="flex gap-2">
            <input
              className="rounded-lg border px-3 py-1.5 text-sm w-32"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="button"
              onClick={verify}
              disabled={confirm.isPending}
              className="rounded-lg px-3 py-1.5 text-sm text-white"
              style={{ background: 'var(--accent)' }}
            >
              Verify & enable
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={begin}
            disabled={start.isPending}
            className="rounded-lg px-3 py-1.5 text-sm text-white"
            style={{ background: 'var(--accent)' }}
          >
            {enabled === true ? '2FA is enabled' : 'Set up 2FA'}
          </button>
          {enabled === true && (
            <span className="flex items-center gap-2 text-sm">
              <input
                type="password"
                className="rounded-lg border px-3 py-1.5 text-sm w-40"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                placeholder="password to disable"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="underline text-sm"
                style={{ color: 'var(--danger)' }}
                onClick={() => disable.mutate({ password })}
              >
                Disable
              </button>
            </span>
          )}
        </div>
      )}
      <ErrorNote message={error} />
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
        Locked out? Shell access is the rescue:{' '}
        <code>node dist/cli.js user:reset-password &lt;email&gt; &lt;new-password&gt;</code>
      </p>
    </Card>
  )
}

function SessionsCard() {
  const utils = trpc.useUtils()
  const sessions = trpc.auth.sessions.useQuery()
  const revoke = trpc.auth.revokeSession.useMutation({
    onSuccess: () => utils.auth.sessions.invalidate(),
  })
  return (
    <Card title="Active sessions">
      <ul className="text-sm">
        {sessions.data?.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <span style={{ color: 'var(--text-2)' }}>
              Signed in {new Date(s.createdAt).toLocaleString()}
              {s.current && (
                <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--live)' }}>
                  this device
                </span>
              )}
            </span>
            {!s.current && (
              <button
                type="button"
                className="text-xs underline"
                style={{ color: 'var(--danger)' }}
                onClick={() => revoke.mutate({ sessionId: s.id })}
              >
                revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function NotificationsTab(props: { isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const setEmail = trpc.auth.setEmailNotifications.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const mailConfigured = status.data?.mailConfigured ?? false
  const enabled = status.data?.me?.emailNotifications ?? false

  return (
    <>
      <Card title="My email notifications">
        {mailConfigured ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={setEmail.isPending}
              onChange={(e) => setEmail.mutate({ enabled: e.target.checked })}
            />
            Email me reminders and heads-up notices ({status.data?.me?.email})
          </label>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            No SMTP configured yet
            {props.isAdmin
              ? ' — fill in the channel below to enable email notifications, emailed invites, and the forgot-password flow.'
              : '. Ask your admin to configure the email channel; that enables email notifications, emailed invites, and the forgot-password flow.'}
          </p>
        )}
      </Card>
      {props.isAdmin ? (
        <>
          <SmtpCard />
          <NtfyCard />
        </>
      ) : (
        <Card title="Push (ntfy)">
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            Channels are configured by an admin on this tab. Reminder and heads-up notifications
            push to every device subscribed to the ntfy topic.
          </p>
          <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
            Without a channel configured, notifications appear in the server log only.
          </p>
        </Card>
      )}
    </>
  )
}

function IntegrationsTab() {
  const utils = trpc.useUtils()
  const hooks = trpc.webhooks.list.useQuery()
  const create = trpc.webhooks.create.useMutation({
    onSuccess: () => utils.webhooks.list.invalidate(),
  })
  const revoke = trpc.webhooks.revoke.useMutation({
    onSuccess: () => utils.webhooks.list.invalidate(),
  })
  const [target, setTarget] = useState<'inbox' | 'today' | 'tasks'>('inbox')
  const [label, setLabel] = useState('')
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const { busy, error, onSubmit } = useSubmit(async () => {
    const res = await create.mutateAsync({ target, label })
    setLastUrl(res.url)
    setLabel('')
  })

  return (
    <Card title="Incoming webhooks">
      <p className="text-sm mb-1" style={{ color: 'var(--text-2)' }}>
        Give other apps a URL that drops text straight into your Inbox, Today note, or Tasks:
      </p>
      <code
        className="block mb-4 text-xs rounded border px-2 py-1.5 overflow-x-auto whitespace-nowrap"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        curl -X POST &lt;url&gt; -H "content-type: application/json" -d {'{'}"text": "from my
        script"{'}'}
      </code>
      <form onSubmit={onSubmit} className="flex items-center gap-2 mb-3 flex-wrap">
        <select
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          value={target}
          onChange={(e) => setTarget(e.target.value as typeof target)}
        >
          <option value="inbox">→ Inbox</option>
          <option value="today">→ Today</option>
          <option value="tasks">→ Tasks</option>
        </select>
        <input
          className="rounded-lg border px-3 py-1.5 text-sm flex-1 min-w-40"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          placeholder="label (e.g. Phone shortcut)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !label.trim()}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          Create
        </button>
      </form>
      <ErrorNote message={error} />
      {lastUrl && (
        <div
          className="rounded-lg border px-3 py-2 mb-4 text-xs font-mono break-all"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          {lastUrl}
          <div className="mt-1 font-sans" style={{ color: 'var(--text-3)' }}>
            The URL is the credential and is shown once — copy it now.
          </div>
        </div>
      )}
      <ul className="text-sm">
        {hooks.data?.map((h) => (
          <li
            key={h.id}
            className="flex items-center justify-between py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)', opacity: h.revoked ? 0.5 : 1 }}
          >
            <span>
              {h.label} <span style={{ color: 'var(--text-3)' }}>→ {h.target}</span>
              {h.revoked && (
                <span className="ml-2 text-xs" style={{ color: 'var(--danger)' }}>
                  revoked
                </span>
              )}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                {h.lastUsedAt
                  ? `last used ${new Date(h.lastUsedAt).toLocaleDateString()}`
                  : 'never used'}
              </span>
              {!h.revoked && (
                <button
                  type="button"
                  className="text-xs underline"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => revoke.mutate({ id: h.id })}
                >
                  revoke
                </button>
              )}
            </span>
          </li>
        ))}
        {hooks.data?.length === 0 && (
          <li className="py-2 text-sm" style={{ color: 'var(--text-3)' }}>
            No webhooks yet.
          </li>
        )}
      </ul>
    </Card>
  )
}

function StorageTab() {
  return <StorageCard />
}

function sourceLabel(source: 'db' | 'env' | 'off' | undefined): string {
  if (source === 'db') return 'active (from these settings)'
  if (source === 'env') return 'active (from env vars)'
  return 'not configured'
}

function SmtpCard() {
  const utils = trpc.useUtils()
  const settings = trpc.settings.get.useQuery()
  const save = trpc.settings.saveSmtp.useMutation()
  const s = settings.data?.smtp
  const [form, setForm] = useState({
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
  })
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  if (s && !loaded) {
    setForm({ host: s.host, port: s.port, secure: s.secure, user: s.user, pass: '', from: s.from })
    setLoaded(true)
  }
  const { busy, error, onSubmit } = useSubmit(async () => {
    await save.mutateAsync(form)
    await Promise.all([utils.settings.get.invalidate(), utils.auth.status.invalidate()])
    setForm((f) => ({ ...f, pass: '' }))
    setDone(true)
  })

  return (
    <Card title={`Email (SMTP) — ${sourceLabel(settings.data?.mailSource)}`}>
      <form onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Host" value={form.host} onChange={(v) => setForm({ ...form, host: v })} />
          <Field
            label="Port"
            value={String(form.port)}
            onChange={(v) => setForm({ ...form, port: Number(v) || 587 })}
          />
          <Field
            label="Username (optional)"
            value={form.user}
            onChange={(v) => setForm({ ...form, user: v })}
          />
          <Field
            label={s?.hasPass ? 'Password (blank = keep saved)' : 'Password'}
            type="password"
            value={form.pass}
            onChange={(v) => setForm({ ...form, pass: v })}
          />
        </div>
        <Field
          label="From address (e.g. notes@example.com)"
          value={form.from}
          onChange={(v) => setForm({ ...form, from: v })}
        />
        <label className="flex items-center gap-2 mb-4 text-sm">
          <input
            type="checkbox"
            checked={form.secure}
            onChange={(e) => setForm({ ...form, secure: e.target.checked })}
          />
          Implicit TLS (port 465); off = STARTTLS
        </label>
        <ErrorNote message={error} />
        {done && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Saved — applies immediately, no restart.
          </p>
        )}
        <SubmitButton label="Save SMTP" busy={busy} />
      </form>
    </Card>
  )
}

function NtfyCard() {
  const utils = trpc.useUtils()
  const settings = trpc.settings.get.useQuery()
  const save = trpc.settings.saveNtfy.useMutation()
  const s = settings.data?.ntfy
  const [form, setForm] = useState({ url: '', topic: '' })
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  if (s && !loaded) {
    setForm({ url: s.url, topic: s.topic })
    setLoaded(true)
  }
  const { busy, error, onSubmit } = useSubmit(async () => {
    await save.mutateAsync(form)
    await utils.settings.get.invalidate()
    setDone(true)
  })

  return (
    <Card title={`Push (ntfy) — ${sourceLabel(settings.data?.ntfySource)}`}>
      <form onSubmit={onSubmit}>
        <Field
          label="ntfy server URL (e.g. https://ntfy.sh)"
          value={form.url}
          onChange={(v) => setForm({ ...form, url: v })}
        />
        <Field
          label="Topic (treat it like a password)"
          value={form.topic}
          onChange={(v) => setForm({ ...form, topic: v })}
        />
        <ErrorNote message={error} />
        {done && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Saved.
          </p>
        )}
        <SubmitButton label="Save ntfy" busy={busy} />
      </form>
    </Card>
  )
}

function RecaptchaCard() {
  const utils = trpc.useUtils()
  const settings = trpc.settings.get.useQuery()
  const save = trpc.settings.saveRecaptcha.useMutation()
  const s = settings.data?.recaptcha
  const [form, setForm] = useState({ siteKey: '', secretKey: '' })
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  if (s && !loaded) {
    setForm({ siteKey: s.siteKey, secretKey: '' })
    setLoaded(true)
  }
  const { busy, error, onSubmit } = useSubmit(async () => {
    await save.mutateAsync(form)
    await utils.settings.get.invalidate()
    setForm((f) => ({ ...f, secretKey: '' }))
    setDone(true)
  })

  return (
    <Card title="Form spam protection (Google reCAPTCHA)">
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Optional. Add your reCAPTCHA v2 keys to offer it as a form&apos;s spam protection. Forms set
        to reCAPTCHA fall back to the built-in math challenge until these are filled in. reCAPTCHA
        loads Google&apos;s script on your published pages.
      </p>
      <form onSubmit={onSubmit}>
        <Field
          label="Site key"
          value={form.siteKey}
          onChange={(v) => setForm({ ...form, siteKey: v })}
        />
        <Field
          label={`Secret key${s?.hasSecret ? ' (leave blank to keep current)' : ''}`}
          type="password"
          value={form.secretKey}
          onChange={(v) => setForm({ ...form, secretKey: v })}
        />
        <ErrorNote message={error} />
        {done && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Saved.
          </p>
        )}
        <SubmitButton label="Save reCAPTCHA" busy={busy} />
      </form>
    </Card>
  )
}

function StorageCard() {
  const utils = trpc.useUtils()
  const settings = trpc.settings.get.useQuery()
  const save = trpc.settings.saveStorage.useMutation()
  const s = settings.data?.storage
  const [form, setForm] = useState({
    driver: 'fs' as 'fs' | 'db' | 's3',
    s3Bucket: '',
    s3Endpoint: '',
    s3Region: 'us-east-1',
    s3AccessKey: '',
    s3SecretKey: '',
    s3ForcePathStyle: true,
  })
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  if (s && !loaded) {
    setForm({
      driver: s.driver,
      s3Bucket: s.s3Bucket,
      s3Endpoint: s.s3Endpoint,
      s3Region: s.s3Region,
      s3AccessKey: s.s3AccessKey,
      s3SecretKey: '',
      s3ForcePathStyle: s.s3ForcePathStyle,
    })
    setLoaded(true)
  }
  const { busy, error, onSubmit } = useSubmit(async () => {
    await save.mutateAsync(form)
    await utils.settings.get.invalidate()
    setForm((f) => ({ ...f, s3SecretKey: '' }))
    setDone(true)
  })

  return (
    <Card title="File storage">
      <form onSubmit={onSubmit}>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Where uploads live</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={form.driver}
            onChange={(e) => setForm({ ...form, driver: e.target.value as typeof form.driver })}
          >
            <option value="fs">Filesystem (default) — the uploads folder/volume</option>
            <option value="db">Database — everything in one backup</option>
            <option value="s3">S3-compatible — MinIO, AWS, Wasabi, R2, B2</option>
          </select>
        </label>
        {form.driver === 's3' && (
          <div className="grid grid-cols-2 gap-x-4">
            <Field
              label="Bucket"
              value={form.s3Bucket}
              onChange={(v) => setForm({ ...form, s3Bucket: v })}
            />
            <Field
              label="Endpoint"
              hint="Blank = AWS"
              value={form.s3Endpoint}
              onChange={(v) => setForm({ ...form, s3Endpoint: v })}
            />
            <Field
              label="Region"
              value={form.s3Region}
              onChange={(v) => setForm({ ...form, s3Region: v })}
            />
            <Field
              label="Access key"
              value={form.s3AccessKey}
              onChange={(v) => setForm({ ...form, s3AccessKey: v })}
            />
            <Field
              label={s?.hasSecret ? 'Secret key (blank = keep saved)' : 'Secret key'}
              type="password"
              value={form.s3SecretKey}
              onChange={(v) => setForm({ ...form, s3SecretKey: v })}
            />
          </div>
        )}
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
          Switching applies to new uploads immediately; existing files stay readable where they are.
          Consolidate later with <code>cli blobs:migrate</code>. S3 settings are verified with a
          real write before saving.
        </p>
        <ErrorNote message={error} />
        {done && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Saved.
          </p>
        )}
        <SubmitButton label="Save storage" busy={busy} />
      </form>
    </Card>
  )
}

function UsersTab() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const users = trpc.users.list.useQuery()
  const invites = trpc.users.invites.useQuery()
  const createInvite = trpc.users.createInvite.useMutation({
    onSuccess: () => utils.users.invites.invalidate(),
  })
  const revoke = trpc.users.revokeInvite.useMutation({
    onSuccess: () => utils.users.invites.invalidate(),
  })
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const [emailedTo, setEmailedTo] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const mailConfigured = status.data?.mailConfigured ?? false

  const makeInvite = async () => {
    const email = inviteEmail.trim() || undefined
    const res = await createInvite.mutateAsync({
      role: 'member',
      suggestedEmail: email,
      sendEmail: Boolean(email && mailConfigured),
    })
    setLastUrl(`${window.location.origin}/invite/${res.token}`)
    setEmailedTo(res.emailed ? (email ?? null) : null)
    setInviteEmail('')
  }

  return (
    <Card title="Members & invites">
      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mb-3">
        <input
          type="email"
          className="rounded-lg border px-3 py-1.5 text-sm w-full sm:flex-1 sm:max-w-60"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          placeholder={mailConfigured ? 'email (sends the link)' : 'email (optional)'}
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
        />
        <button
          type="button"
          onClick={makeInvite}
          disabled={createInvite.isPending}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white w-full sm:w-auto"
          style={{ background: 'var(--accent)' }}
        >
          + Invite link
        </button>
      </div>
      {lastUrl && (
        <div
          className="rounded-lg border px-3 py-2 mb-4 text-xs font-mono break-all"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          {lastUrl}
          <div className="mt-1 font-sans" style={{ color: 'var(--text-3)' }}>
            {emailedTo
              ? `Emailed to ${emailedTo}. Single use, expires in 7 days.`
              : 'Single use, expires in 7 days. Shown once — copy it now.'}
          </div>
        </div>
      )}
      <ul className="text-sm mb-5">
        {users.data?.map((u) => (
          <li
            key={u.id}
            className="flex justify-between py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <span>
              {u.name} <span style={{ color: 'var(--text-3)' }}>({u.email})</span>
            </span>
            <span style={{ color: 'var(--text-2)' }}>{u.role}</span>
          </li>
        ))}
      </ul>
      {(invites.data?.length ?? 0) > 0 && (
        <ul className="text-sm">
          {invites.data?.map((i) => (
            <li
              key={i.id}
              className="flex justify-between items-center py-2 border-b last:border-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <span style={{ color: 'var(--text-2)' }}>
                {i.suggestedEmail ?? 'anyone'} · {i.status} · expires{' '}
                {new Date(i.expiresAt).toLocaleDateString()}
              </span>
              {i.status === 'pending' && (
                <button
                  type="button"
                  className="underline text-xs"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => revoke.mutate({ id: i.id })}
                >
                  revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
