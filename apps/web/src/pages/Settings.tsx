import type { AuditEventView, AuditFamily, GraphEdgeKind, OidcSettings } from '@bn/schema'
import { useEffect, useState } from 'react'
import { ErrorNote, Field, Modal, SubmitButton, useSubmit } from '../components'
import { webEdition } from '../edition'
import { passkeyErrorMessage, passkeysSupported, startRegistration } from '../passkey'
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
import { THEMES, THEME_ICON, THEME_LABEL, applyTheme } from '../theme'
import { trpc } from '../trpc'

const TABS = [
  'Account',
  'Appearance',
  'Preferences',
  'Security',
  'Notifications',
  'Integrations',
  'Users',
  'Storage',
  'Backup',
  'Activity',
] as const
type Tab = (typeof TABS)[number]
const ADMIN_TABS: Tab[] = ['Users', 'Storage', 'Backup', 'Activity']
const TAB_ICONS: Record<Tab, string> = {
  Account: '👤',
  Appearance: '👁',
  Preferences: '🎛',
  Security: '🔒',
  Notifications: '🔔',
  Integrations: '🔗',
  Users: '👥',
  Storage: '🗄',
  Backup: '💾',
  Activity: '📜',
}

export function SettingsPage() {
  const status = trpc.auth.status.useQuery()
  const isAdmin = status.data?.me?.role === 'admin'
  // the SSO link flow returns to /settings?sso=linked (or ?sso_error=…)
  // a core tab name, or the id of a tab an add-on edition contributes
  const [tab, setTab] = useState<string>(() => {
    const q = new URLSearchParams(window.location.search)
    return q.has('sso') || q.has('sso_error') ? 'Security' : 'Account'
  })
  const extraTabs = (webEdition.settingsTabs ?? []).filter((t) => !t.adminOnly || isAdmin)
  const tabs = [
    ...TABS.filter((t) => !ADMIN_TABS.includes(t) || isAdmin).map((t) => ({
      id: t as string,
      label: t as string,
      icon: TAB_ICONS[t],
    })),
    ...extraTabs,
  ]
  const ExtraTab = extraTabs.find((t) => t.id === tab)?.Component

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
          onChange={(e) => setTab(e.target.value)}
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.icon} {t.label}
            </option>
          ))}
        </select>
        <nav className="hidden md:flex md:flex-col md:gap-0.5 md:w-44 md:shrink-0 md:sticky md:top-8">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex items-center gap-2 text-left px-3 py-2 text-sm rounded-lg"
              style={{
                color: tab === t.id ? 'var(--accent)' : 'var(--text-2)',
                background: tab === t.id ? 'var(--accent-soft)' : undefined,
                fontWeight: tab === t.id ? 600 : 400,
              }}
            >
              <span className="text-xs">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          {tab === 'Account' && <AccountTab />}
          {tab === 'Appearance' && <AppearanceTab />}
          {tab === 'Preferences' && <PreferencesTab />}
          {tab === 'Security' && <SecurityTab />}
          {tab === 'Notifications' && <NotificationsTab isAdmin={isAdmin} />}
          {tab === 'Integrations' && <IntegrationsTab />}
          {tab === 'Users' && isAdmin && <UsersTab />}
          {tab === 'Storage' && isAdmin && <StorageTab />}
          {tab === 'Backup' && isAdmin && <BackupTab />}
          {tab === 'Activity' && isAdmin && <ActivityTab />}
          {ExtraTab ? <ExtraTab /> : null}
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
      <DefaultThemeCard />
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
 * The account's default theme — the look a device adopts on first login, before
 * it has a choice of its own. Picking one here also switches this device now (and
 * the toolbar swatch keeps overriding it per-device). Kept in Appearance because
 * it is purely about the look, and it is the one theme control that travels.
 */
function DefaultThemeCard() {
  const prefs = useSidebarPrefs()
  const current = prefs.defaultTheme
  return (
    <Card title="Theme">
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Your default theme. A device that hasn’t picked one — a fresh sign-in — starts here, so the
        look follows you across machines. The toolbar swatch still overrides it on this device.
      </p>
      <div className="flex flex-wrap gap-2">
        {THEMES.map((t) => {
          const active = t === current
          return (
            <button
              key={t}
              type="button"
              disabled={prefs.saving}
              onClick={() => {
                applyTheme(t) // switch this device now…
                prefs.setDefaultTheme(t) // …and remember it as the account default
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border disabled:opacity-60"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                color: active ? 'var(--accent)' : 'var(--text-2)',
                background: active ? 'var(--accent-soft)' : undefined,
                fontWeight: active ? 600 : 400,
              }}
            >
              <span aria-hidden>{THEME_ICON[t]}</span>
              {THEME_LABEL[t]}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/**
 * Behaviour preferences — how the app acts, as opposed to what the sidebar
 * shows. Split out of Appearance once it had grown into a grab-bag of both.
 */
function PreferencesTab() {
  return (
    <>
      <ComingUpCard />
      <KnowledgeGraphCard />
      <DeleteConfirmCard />
      <LinkCaptureCard />
    </>
  )
}

const GRAPH_EDGE_LABELS: Record<GraphEdgeKind, { label: string; hint: string }> = {
  concept: { label: 'Concepts', hint: 'pages that share a key term' },
  link: { label: 'Links', hint: 'explicit [[wiki links]] between pages' },
  tag: { label: 'Tags', hint: 'pages carrying the same #tag' },
  relation: { label: 'Relations', hint: 'verb links read from the text (X runs Y)' },
  semantic: { label: 'Similar meaning', hint: 'pages that read alike (embeddings)' },
}

/**
 * The per-space knowledge graph. Off, a space name just expands in the sidebar
 * like any folder. On, clicking it opens the graph overview — and these edge
 * toggles decide which relationships that graph draws.
 */
function KnowledgeGraphCard() {
  const prefs = useSidebarPrefs()
  const status = trpc.auth.status.useQuery()
  const embeddingsAvailable = status.data?.graphEmbeddings ?? false
  const enabled = prefs.graphEnabled
  const edges = new Set(prefs.graphEdges)

  const kinds: GraphEdgeKind[] = ['concept', 'link', 'tag', 'relation', 'semantic']
  const shown = kinds.filter((k) => k !== 'semantic' || embeddingsAvailable)

  const toggleEdge = (kind: GraphEdgeKind, on: boolean) => {
    const next = new Set(edges)
    if (on) next.add(kind)
    else next.delete(kind)
    prefs.setGraphPrefs({
      enabled,
      edges: shown.filter((k) => next.has(k)),
      mobile: prefs.graphMobile,
    })
  }

  return (
    <Card title="Knowledge graph">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          disabled={prefs.saving}
          onChange={(e) =>
            prefs.setGraphPrefs({
              enabled: e.target.checked,
              edges: prefs.graphEdges,
              mobile: prefs.graphMobile,
            })
          }
        />
        <span>Show a space’s knowledge graph when I click its name</span>
      </label>
      <p className="text-xs mt-2 mb-4" style={{ color: 'var(--text-3)' }}>
        On, clicking a space name in the sidebar opens its graph overview. Off, clicking just
        expands or collapses the space, and the graph is never built.
      </p>

      <div style={{ opacity: enabled ? 1 : 0.45 }}>
        <label className="flex items-center gap-2 text-sm mb-4">
          <input
            type="checkbox"
            checked={prefs.graphMobile}
            disabled={prefs.saving || !enabled}
            onChange={(e) =>
              prefs.setGraphPrefs({
                enabled,
                edges: prefs.graphEdges,
                mobile: e.target.checked,
              })
            }
          />
          <span>Build it on phones too</span>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            — off, a phone just expands the space instead
          </span>
        </label>

        <span className="block text-sm font-medium mb-2">Draw these connections</span>
        <div className="flex flex-col gap-2">
          {shown.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={edges.has(kind)}
                disabled={prefs.saving || !enabled}
                onChange={(e) => toggleEdge(kind, e.target.checked)}
              />
              <span style={{ color: 'var(--text-2)' }}>{GRAPH_EDGE_LABELS[kind].label}</span>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                — {GRAPH_EDGE_LABELS[kind].hint}
              </span>
            </label>
          ))}
        </div>
        {!embeddingsAvailable && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
            “Similar meaning” needs the embeddings build (the <code>-ml</code> image with{' '}
            <code>GRAPH_EMBEDDINGS</code> on); it’s hidden until then.
          </p>
        )}
      </div>
    </Card>
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
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  // an account made by single sign-on has no password yet: set one, no "current"
  const firstPassword = status.data?.me?.passwordSet === false
  const change = trpc.auth.changePassword.useMutation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (next !== confirm) throw new Error('New passwords do not match.')
    await change.mutateAsync({ current: firstPassword ? '' : current, next })
    if (firstPassword) await utils.auth.status.invalidate()
    setCurrent('')
    setNext('')
    setConfirm('')
    setDone(true)
  })
  const mismatch = confirm !== '' && next !== confirm

  return (
    <Card title={firstPassword ? 'Set a password' : 'Change password'}>
      <form onSubmit={onSubmit}>
        {firstPassword ? (
          <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
            You sign in with single sign-on, so this account has no password. Set one to lock
            notebooks and pages, or to sign in when single sign-on is unavailable.
          </p>
        ) : (
          <Field label="Current password" type="password" value={current} onChange={setCurrent} />
        )}
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
            {firstPassword ? 'Password set.' : 'Password changed.'}
          </p>
        )}
        <SubmitButton label={firstPassword ? 'Set password' : 'Change password'} busy={busy} />
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
      <LinkedSignInsCard />
      <PasskeysCard />
      <TwoFactorCard />
      <SessionsCard />
      {isAdmin ? <SsoSettingsCard /> : null}
      {isAdmin ? <ProxyAuthCard /> : null}
      {/* form spam protection is a security control, not a notification channel —
          it only lived on that tab because reCAPTCHA needed a home */}
      {isAdmin ? <RecaptchaCard /> : null}
    </>
  )
}

/** Read ?sso=linked / ?sso_error=… once, then drop them from the address bar. */
function takeSsoResult(): { ok: boolean; message: string } | null {
  const q = new URLSearchParams(window.location.search)
  const error = q.get('sso_error')
  const linked = q.get('sso') === 'linked'
  if (error === null && !linked) return null
  window.history.replaceState(null, '', window.location.pathname)
  return error !== null ? { ok: false, message: error } : { ok: true, message: 'Linked.' }
}

/** A sensible default name for a new passkey: the device it's being made on. */
function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows Hello'
  return 'Passkey'
}

/** Passkeys on this account: add one from this device, rename, or remove. */
function PasskeysCard() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const list = trpc.passkeys.list.useQuery()
  const options = trpc.passkeys.registrationOptions.useMutation()
  const register = trpc.passkeys.register.useMutation()
  const rename = trpc.passkeys.rename.useMutation()
  const remove = trpc.passkeys.remove.useMutation()
  const [name, setName] = useState(guessDeviceName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const available = Boolean(status.data?.passkeys) && passkeysSupported()
  const rows = list.data ?? []

  const add = async () => {
    setBusy(true)
    setError(null)
    setAdded(false)
    try {
      const optionsJSON = await options.mutateAsync()
      const response = await startRegistration({ optionsJSON })
      await register.mutateAsync({
        response: response as unknown as Record<string, unknown>,
        name,
      })
      await utils.passkeys.list.invalidate()
      setAdded(true)
    } catch (err) {
      setError(passkeyErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Passkeys">
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Sign in with Face ID, Touch ID, Windows Hello, your phone or a security key instead of a
        password. A passkey also counts as your second factor.
      </p>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2 mb-3">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              {editing?.id === p.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!editing.name.trim()) return
                    await rename.mutateAsync({ id: p.id, name: editing.name })
                    await utils.passkeys.list.invalidate()
                    setEditing(null)
                  }}
                >
                  <input
                    className="flex-1 rounded border px-2 py-1 text-sm"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                    value={editing.name}
                    maxLength={60}
                    autoFocus
                    onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                  />
                  <button type="submit" className="text-xs underline">
                    Save
                  </button>
                </form>
              ) : (
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {p.backedUp ? 'Synced' : 'This device only'} · added{' '}
                    {new Date(p.createdAt).toLocaleDateString()}
                    {p.lastUsedAt
                      ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
              )}
              {editing?.id !== p.id && (
                <div className="flex gap-3 shrink-0 text-xs">
                  <button
                    type="button"
                    className="underline"
                    style={{ color: 'var(--text-2)' }}
                    onClick={() => setEditing({ id: p.id, name: p.name })}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="underline"
                    style={{ color: 'var(--danger)' }}
                    disabled={remove.isPending}
                    onClick={async () => {
                      await remove.mutateAsync({ id: p.id })
                      await utils.passkeys.list.invalidate()
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {available ? (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <Field label="Name for this passkey" value={name} onChange={setName} />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="mb-4 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {busy ? 'Waiting for your device…' : 'Add a passkey'}
          </button>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {status.data?.passkeys
            ? 'This browser does not support passkeys.'
            : 'Passkeys need the app to be opened over https at its own domain (the BASE_URL it is set up with).'}
        </p>
      )}
      <ErrorNote message={error} />
      {added && (
        <p className="text-sm" style={{ color: 'var(--live)' }}>
          Passkey added. You can sign in with it from the sign-in page.
        </p>
      )}
    </Card>
  )
}

/** Single sign-on identities on this account: link one, or unlink one. */
function LinkedSignInsCard() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const identities = trpc.auth.identities.useQuery()
  const unlink = trpc.auth.unlinkIdentity.useMutation()
  const [result] = useState(takeSsoResult)
  const [error, setError] = useState<string | null>(null)
  const sso = status.data?.sso ?? null
  const rows = identities.data ?? []
  if (!sso && rows.length === 0) return null

  return (
    <Card title="Single sign-on">
      {rows.length === 0 ? (
        <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
          Link your account to {sso?.label} so you can sign in with it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{r.email ?? r.provider}</div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {r.provider}
                  {r.lastLoginAt
                    ? ` · last used ${new Date(r.lastLoginAt).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                className="text-xs underline shrink-0"
                style={{ color: 'var(--danger)' }}
                disabled={unlink.isPending}
                onClick={async () => {
                  setError(null)
                  try {
                    await unlink.mutateAsync({ id: r.id })
                    await utils.auth.identities.invalidate()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not unlink.')
                  }
                }}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && (
        <p className="text-sm mb-3" style={{ color: result.ok ? 'var(--live)' : 'var(--danger)' }}>
          {result.message}
        </p>
      )}
      <ErrorNote message={error} />
      {sso && (
        <a
          href="/auth/oidc/login?link=1&next=%2Fsettings"
          className="inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          {rows.length === 0 ? `Link ${sso.label}` : 'Link another'}
        </a>
      )}
    </Card>
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
  return (
    <>
      <ApiTokensCard />
      <ClipperCard />
      <AssistantsCard />
      <WebhooksCard />
    </>
  )
}

/** Copy to the clipboard, with a text fallback the viewer can select. */
function CopyField(props: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
    >
      <code className="text-xs flex-1 break-all select-all">{props.value}</code>
      <button
        type="button"
        className="text-xs underline shrink-0"
        style={{ color: 'var(--text-2)' }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(props.value)
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      >
        {copied ? 'Copied' : (props.label ?? 'Copy')}
      </button>
    </div>
  )
}

const EXPIRY_CHOICES: { value: string; label: string; days: number | null }[] = [
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
  { value: 'never', label: 'Never', days: null },
]

/** Personal access tokens for the REST API and MCP clients. */
function ApiTokensCard() {
  const utils = trpc.useUtils()
  const list = trpc.tokens.list.useQuery()
  const create = trpc.tokens.create.useMutation()
  const revoke = trpc.tokens.revoke.useMutation({
    onSuccess: () => utils.tokens.list.invalidate(),
  })
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [expiry, setExpiry] = useState('90')
  const [fresh, setFresh] = useState<string | null>(null)
  const { busy, error, onSubmit } = useSubmit(async () => {
    const days = EXPIRY_CHOICES.find((c) => c.value === expiry)?.days ?? null
    const res = await create.mutateAsync({ name, scope, expiresInDays: days })
    setFresh(res.token)
    setName('')
    await utils.tokens.list.invalidate()
  })
  const rows = list.data ?? []
  const selectStyle = { background: 'var(--bg)', borderColor: 'var(--border)' }

  return (
    <Card title="API tokens">
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Let scripts and AI assistants read and write your notes as you. A read-only token can search
        and read; a read and write token can also create pages and add to your journal, tasks and
        inbox. Tokens never open locked notebooks or pages, and can’t change settings.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 mb-3">
        <input
          className="w-full rounded-lg border px-3 py-1.5 text-sm"
          style={selectStyle}
          placeholder="What it’s for, e.g. Claude Desktop"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={selectStyle}
            value={scope}
            onChange={(e) => setScope(e.target.value as 'read' | 'write')}
            aria-label="Access"
          >
            <option value="read">Read only</option>
            <option value="write">Read and write</option>
          </select>
          <select
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={selectStyle}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            aria-label="Expires"
          >
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                Expires: {c.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            Create token
          </button>
        </div>
      </form>
      <ErrorNote message={error} />
      {fresh && (
        <div className="mb-4">
          <p className="text-sm mb-2" style={{ color: 'var(--live)' }}>
            Copy this token now. It won’t be shown again.
          </p>
          <CopyField value={fresh} />
        </div>
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {t.name}{' '}
                  <span className="text-xs font-normal" style={{ color: 'var(--text-3)' }}>
                    {t.scope === 'write' ? 'read and write' : 'read only'}
                  </span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                  <code>{t.prefix}…</code>
                  {t.lastUsedAt
                    ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : ' · never used'}
                  {t.expiresAt
                    ? ` · expires ${new Date(t.expiresAt).toLocaleDateString()}`
                    : ' · never expires'}
                </div>
              </div>
              <button
                type="button"
                className="text-xs underline shrink-0"
                style={{ color: 'var(--danger)' }}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ id: t.id })}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Where to get the browser extension that saves pages here. */
function ClipperCard() {
  return (
    <Card title="Browser clipper">
      <p className="text-sm mb-2" style={{ color: 'var(--text-2)' }}>
        Save the page you’re reading, a selection or a link to your Inbox, or as a new page, from
        Chrome, Edge, Brave or Firefox. Connect it with a read and write token from above.
      </p>
      <a
        className="text-sm underline"
        href="https://github.com/mansoor/beyond-notes/tree/main/extensions/clipper#readme"
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--accent)' }}
      >
        Get the clipper and set it up ↗
      </a>
    </Card>
  )
}

/** How to point an AI assistant (MCP) or a script (REST) at this instance. */
function AssistantsCard() {
  const origin = window.location.origin
  const mcpUrl = `${origin}/api/mcp`
  return (
    <Card title="Connect an AI assistant">
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Beyond Notes is an MCP server, so Claude and other assistants can search your notes, read
        pages and your journal, and (with a read and write token) save pages, tasks and inbox notes.
        Use this address with an API token from above:
      </p>
      <CopyField value={mcpUrl} />
      <p className="text-sm mt-4 mb-2" style={{ color: 'var(--text-2)' }}>
        Claude Code:
      </p>
      <CopyField
        value={`claude mcp add --transport http beyond-notes ${mcpUrl} --header "Authorization: Bearer <your token>"`}
      />
      <p className="text-sm mt-4" style={{ color: 'var(--text-2)' }}>
        Other apps send the token as <code>Authorization: Bearer …</code>. For scripts there is also
        a REST API; its description is at{' '}
        <a
          className="underline"
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--accent)' }}
        >
          /api/v1/openapi.json
        </a>
        .
      </p>
    </Card>
  )
}

/** Incoming webhooks: a URL per target that drops text in. */
function WebhooksCard() {
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function BackupTab() {
  const utils = trpc.useUtils()
  const settings = trpc.settings.get.useQuery()
  const backups = trpc.settings.listBackups.useQuery()
  const save = trpc.settings.saveBackup.useMutation()
  const runNow = trpc.settings.backupNow.useMutation()
  const del = trpc.settings.deleteBackup.useMutation()
  const [restoreName, setRestoreName] = useState<string | null>(null)

  const b = settings.data?.backup
  const isS3 = settings.data?.storage?.driver === 's3'
  const [form, setForm] = useState({
    enabled: false,
    frequency: 'weekly' as 'daily' | 'weekly' | 'monthly',
    hour: 3,
    retention: 4,
    s3Copy: false,
  })
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  if (b && !loaded) {
    setForm({
      enabled: b.enabled,
      frequency: b.frequency,
      hour: b.hour,
      retention: b.retention,
      s3Copy: b.s3Copy,
    })
    setLoaded(true)
  }

  const { busy, error, onSubmit } = useSubmit(async () => {
    await save.mutateAsync(form)
    await utils.settings.get.invalidate()
    setDone(true)
  })

  return (
    <>
      <Card title="Automatic backups">
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          A full backup — every space, page, note, task and image — is written as one zip to the
          server's backup folder. Guard those files: they contain your data and your saved secrets.
        </p>
        <form onSubmit={onSubmit}>
          <label className="flex items-center gap-2 text-sm font-medium mb-4">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Back up automatically
          </label>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <label className="text-sm">
              <span className="block mb-1" style={{ color: 'var(--text-2)' }}>
                Frequency
              </span>
              <select
                value={form.frequency}
                disabled={!form.enabled}
                onChange={(e) =>
                  setForm({ ...form, frequency: e.target.value as typeof form.frequency })
                }
                className="w-full rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (Mondays)</option>
                <option value="monthly">Monthly (1st)</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block mb-1" style={{ color: 'var(--text-2)' }}>
                Hour of day (0–23)
              </span>
              <input
                type="number"
                min={0}
                max={23}
                value={form.hour}
                disabled={!form.enabled}
                onChange={(e) =>
                  setForm({ ...form, hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })
                }
                className="w-full rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
              />
            </label>
          </div>

          <label className="text-sm block mt-2 max-w-[50%] pr-2">
            <span className="block mb-1" style={{ color: 'var(--text-2)' }}>
              Keep last
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={form.retention}
              onChange={(e) =>
                setForm({
                  ...form,
                  retention: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                })
              }
              className="w-full rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
          </label>

          {isS3 && (
            <label className="flex items-center gap-2 text-sm mt-4">
              <input
                type="checkbox"
                checked={form.s3Copy}
                onChange={(e) => setForm({ ...form, s3Copy: e.target.checked })}
              />
              Also copy each backup to S3
            </label>
          )}

          <ErrorNote message={error} />
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton label="Save" busy={busy} />
            {done && !busy && (
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                Saved.
              </span>
            )}
          </div>
        </form>
      </Card>

      <OffsiteCard />

      <Card title="Backups">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            disabled={runNow.isPending}
            onClick={async () => {
              await runNow.mutateAsync()
              await utils.settings.listBackups.invalidate()
              // the offsite card shows how the copy went
              await utils.settings.get.invalidate()
            }}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            {runNow.isPending ? 'Backing up…' : 'Back up now'}
          </button>
          {runNow.error && (
            <span className="text-xs" style={{ color: 'var(--danger)' }}>
              {runNow.error.message}
            </span>
          )}
        </div>

        {(backups.data ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            No backups yet.
          </p>
        ) : (
          <div className="flex flex-col">
            {(backups.data ?? []).map((bk) => (
              <div
                key={bk.name}
                className="flex items-center gap-3 py-2 border-b text-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{new Date(bk.createdAt).toLocaleString()}</span>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {fmtBytes(bk.sizeBytes)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setRestoreName(bk.name)}
                  className="text-xs underline shrink-0"
                  style={{ color: 'var(--accent)' }}
                >
                  Restore
                </button>
                <a
                  href={`/api/backups/${bk.name}`}
                  className="text-xs underline shrink-0"
                  style={{ color: 'var(--accent)' }}
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    await del.mutateAsync({ name: bk.name })
                    await utils.settings.listBackups.invalidate()
                  }}
                  className="text-xs shrink-0"
                  style={{ color: 'var(--danger)' }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {restoreName && <RestoreModal name={restoreName} onClose={() => setRestoreName(null)} />}
    </>
  )
}

/**
 * Offsite copies: each backup encrypted here (age, with a passphrase) and
 * uploaded to a bucket somewhere else. Fetching one brings it back into the
 * local list below, where Restore works as usual.
 */
function OffsiteCard() {
  const utils = trpc.useUtils()
  const settings = trpc.settings.get.useQuery()
  const save = trpc.settings.saveOffsite.useMutation()
  const o = settings.data?.offsite
  const [form, setForm] = useState({
    enabled: false,
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    prefix: 'beyond-notes/',
    accessKey: '',
    secretKey: '',
    passphrase: '',
    forcePathStyle: true,
  })
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  const [showCopies, setShowCopies] = useState(false)
  if (o && !loaded) {
    setForm({
      enabled: o.enabled,
      endpoint: o.endpoint,
      region: o.region,
      bucket: o.bucket,
      prefix: o.prefix,
      accessKey: o.accessKey,
      secretKey: '',
      passphrase: '',
      forcePathStyle: o.forcePathStyle,
    })
    setLoaded(true)
  }
  const { busy, error, onSubmit } = useSubmit(async () => {
    setDone(false)
    await save.mutateAsync(form)
    await utils.settings.get.invalidate()
    setForm((f) => ({ ...f, secretKey: '', passphrase: '' }))
    setDone(true)
  })
  const active = Boolean(o?.enabled && o.bucket && o.hasPassphrase)

  return (
    <Card title="Offsite copies">
      <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
        Send an encrypted copy of every backup to an S3-compatible bucket somewhere else, such as
        Backblaze B2, Wasabi, Cloudflare R2 or a NAS at another address. Copies are encrypted on
        this server with your passphrase, so whoever runs the bucket can't read them.
      </p>
      <form onSubmit={onSubmit}>
        <label className="flex items-center gap-2 text-sm font-medium mb-4">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Copy each backup offsite
        </label>
        {form.enabled && (
          <>
            <div className="grid grid-cols-2 gap-x-4">
              <Field
                label="Bucket"
                value={form.bucket}
                onChange={(v) => setForm({ ...form, bucket: v })}
              />
              <Field
                label="Folder in the bucket"
                value={form.prefix}
                onChange={(v) => setForm({ ...form, prefix: v })}
              />
              <Field
                label="Endpoint"
                hint="Blank = AWS"
                value={form.endpoint}
                onChange={(v) => setForm({ ...form, endpoint: v })}
              />
              <Field
                label="Region"
                value={form.region}
                onChange={(v) => setForm({ ...form, region: v })}
              />
              <Field
                label="Access key"
                value={form.accessKey}
                onChange={(v) => setForm({ ...form, accessKey: v })}
              />
              <Field
                label={o?.hasSecret ? 'Secret key (blank = keep saved)' : 'Secret key'}
                type="password"
                value={form.secretKey}
                onChange={(v) => setForm({ ...form, secretKey: v })}
              />
            </div>
            <Field
              label={
                o?.hasPassphrase
                  ? 'Encryption passphrase (blank = keep saved)'
                  : 'Encryption passphrase'
              }
              type="password"
              value={form.passphrase}
              onChange={(v) => setForm({ ...form, passphrase: v })}
              hint="At least 12 characters. Write it down somewhere other than this server: without it, nobody (you included) can open the copies. Changing it only affects new copies."
            />
            <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
              Saving checks the bucket with a real encrypted write, read and delete. The folder
              keeps as many copies as "Keep last" above, so give each instance its own folder. Any
              copy also opens with the standard{' '}
              <a
                href="https://age-encryption.org"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                age
              </a>{' '}
              tool: <code>age -d copy.zip.age &gt; backup.zip</code>
            </p>
          </>
        )}
        <ErrorNote message={error} />
        {done && !busy && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Saved.
          </p>
        )}
        <SubmitButton label="Save offsite copies" busy={busy} />
      </form>

      {active && (
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          {o?.last ? (
            <p
              className="text-sm mb-3"
              style={{ color: o.last.ok ? 'var(--text-2)' : 'var(--danger)' }}
            >
              {o.last.ok
                ? `Last copy sent ${new Date(o.last.at).toLocaleString()}.`
                : `The last copy failed (${new Date(o.last.at).toLocaleString()}): ${o.last.error}`}
            </p>
          ) : null}
          {showCopies ? (
            <OffsiteCopies />
          ) : (
            <button
              type="button"
              onClick={() => setShowCopies(true)}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            >
              Show copies in the bucket
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

function OffsiteCopies() {
  const utils = trpc.useUtils()
  const copies = trpc.settings.offsiteList.useQuery()
  const fetchCopy = trpc.settings.offsiteFetch.useMutation()
  const [fetched, setFetched] = useState<string[]>([])

  if (copies.isLoading) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>
        Looking in the bucket…
      </p>
    )
  }
  if (copies.error) return <ErrorNote message={copies.error.message} />
  const rows = copies.data ?? []
  return (
    <>
      <p className="text-sm mb-2" style={{ color: 'var(--text-2)' }}>
        Fetch a copy to bring it back into the backups below, then restore it from there.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          No copies in the bucket yet.
        </p>
      ) : (
        <div className="flex flex-col">
          {rows.map((c) => (
            <div
              key={c.name}
              className="flex items-center gap-3 py-2 border-b text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate">{new Date(c.createdAt).toLocaleString()}</span>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {fmtBytes(c.sizeBytes)}, encrypted
                </span>
              </span>
              {fetched.includes(c.name) ? (
                <span className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>
                  Fetched
                </span>
              ) : (
                <button
                  type="button"
                  disabled={fetchCopy.isPending}
                  onClick={async () => {
                    await fetchCopy.mutateAsync({ name: c.name })
                    await utils.settings.listBackups.invalidate()
                    setFetched((f) => [...f, c.name])
                  }}
                  className="text-xs underline shrink-0 disabled:opacity-60"
                  style={{ color: 'var(--accent)' }}
                >
                  {fetchCopy.isPending && fetchCopy.variables?.name === c.name
                    ? 'Fetching…'
                    : 'Fetch'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {fetchCopy.error && <ErrorNote message={fetchCopy.error.message} />}
    </>
  )
}

function RestoreModal({ name, onClose }: { name: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const plan = trpc.settings.restorePlan.useQuery({ name })
  const run = trpc.settings.restoreRun.useMutation()

  // per-space { include, mode }; journal + inbox are simple toggles. 'merge'
  // adds only the pages missing here; 'overwrite' replaces the whole space.
  type SpaceSel = { include: boolean; mode: 'merge' | 'overwrite' }
  const [spaces, setSpaces] = useState<Record<string, SpaceSel>>({})
  const [journal, setJournal] = useState(false)
  const [inbox, setInbox] = useState(false)
  const [result, setResult] = useState<typeof run.data | null>(null)

  const anySelected = journal || inbox || Object.values(spaces).some((s) => s.include)
  const willOverwrite = Object.values(spaces).some((s) => s.include && s.mode === 'overwrite')

  const setSpace = (id: string, patch: Partial<SpaceSel>) =>
    setSpaces((prev) => ({
      ...prev,
      [id]: { include: false, mode: 'merge', ...prev[id], ...patch },
    }))

  const submit = async () => {
    const res = await run.mutateAsync({
      name,
      spaces: Object.entries(spaces)
        .filter(([, v]) => v.include)
        .map(([id, v]) => ({ id, mode: v.mode })),
      journal,
      inbox,
    })
    setResult(res)
    // content changed under the app — refresh spaces, trees, journal, inbox
    await utils.invalidate()
  }

  return (
    <Modal title="Restore from backup" onClose={onClose} dirty={anySelected && !result}>
      {plan.isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Reading backup…
        </p>
      )}
      {plan.error && <ErrorNote message={plan.error.message} />}

      {plan.data && !result && (
        <div className="text-sm">
          <p className="mb-1" style={{ color: 'var(--text-2)' }}>
            Captured {new Date(plan.data.exportedAt).toLocaleString()}.
          </p>
          {!plan.data.compatible && (
            <p className="mb-3" style={{ color: 'var(--danger)' }}>
              This backup was written by a newer version and can't be restored here.
            </p>
          )}
          <p className="mb-4" style={{ color: 'var(--text-3)' }}>
            Restore only brings back content — spaces, journal and inbox. It never changes accounts,
            passwords or server settings.
          </p>

          {plan.data.spaces.length > 0 && (
            <div className="mb-4">
              <div className="font-medium mb-2">Spaces</div>
              {plan.data.spaces.map((sp) => {
                const st = spaces[sp.id] ?? { include: false, mode: 'merge' as const }
                return (
                  <div
                    key={sp.id}
                    className="py-1 border-b"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={st.include}
                        onChange={(e) => setSpace(sp.id, { include: e.target.checked })}
                      />
                      <span className="flex-1">{sp.name}</span>
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {sp.pageCount} {sp.pageCount === 1 ? 'page' : 'pages'}
                      </span>
                    </label>
                    {st.include && !sp.conflict && (
                      <span className="block ml-6 text-xs" style={{ color: 'var(--text-3)' }}>
                        New space — all {sp.pageCount} pages will be added.
                      </span>
                    )}
                    {st.include && sp.conflict && (
                      <div className="ml-6 mt-1 text-xs">
                        <label className="flex items-center gap-2 py-0.5">
                          <input
                            type="radio"
                            name={`mode-${sp.id}`}
                            checked={st.mode === 'merge'}
                            onChange={() => setSpace(sp.id, { mode: 'merge' })}
                          />
                          <span style={{ color: 'var(--text-2)' }}>
                            {sp.missingPages > 0
                              ? `Add the ${sp.missingPages} missing ${
                                  sp.missingPages === 1 ? 'page' : 'pages'
                                } (keeps your ${sp.existingPages} current)`
                              : 'Add missing pages — nothing is missing right now'}
                          </span>
                        </label>
                        <label className="flex items-center gap-2 py-0.5">
                          <input
                            type="radio"
                            name={`mode-${sp.id}`}
                            checked={st.mode === 'overwrite'}
                            onChange={() => setSpace(sp.id, { mode: 'overwrite' })}
                          />
                          <span style={{ color: 'var(--danger)' }}>
                            Replace entirely — delete the {sp.existingPages} current{' '}
                            {sp.existingPages === 1 ? 'page' : 'pages'} and restore all{' '}
                            {sp.pageCount}
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="mb-4">
            <div className="font-medium mb-2">Personal</div>
            <label className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={journal}
                onChange={(e) => setJournal(e.target.checked)}
              />
              <span className="flex-1">Journal, Today &amp; Tasks</span>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                {plan.data.journalPageCount} pages
              </span>
            </label>
            <label className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={inbox} onChange={(e) => setInbox(e.target.checked)} />
              <span className="flex-1">Inbox notes</span>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                {plan.data.inboxCount} notes
              </span>
            </label>
            {(journal || inbox) && (
              <p className="ml-6 text-xs" style={{ color: 'var(--text-3)' }}>
                Added, not overwritten: days and notes you already have are left untouched — only
                ones missing here come back.
              </p>
            )}
          </div>

          <ErrorNote message={run.error?.message ?? null} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!anySelected || !plan.data.compatible || run.isPending}
              onClick={submit}
              className="rounded-lg px-3 py-1.5 text-sm text-white disabled:opacity-50"
              style={{ background: willOverwrite ? 'var(--danger)' : 'var(--accent)' }}
            >
              {run.isPending ? 'Restoring…' : willOverwrite ? 'Overwrite & restore' : 'Restore'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sm"
              style={{ color: 'var(--text-2)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="text-sm">
          <p className="mb-2 font-medium">Restore complete.</p>
          <ul className="mb-3" style={{ color: 'var(--text-2)' }}>
            <li>
              {result.spacesRestored} space{result.spacesRestored === 1 ? '' : 's'} restored
              {result.spacesSkipped > 0 && `, ${result.spacesSkipped} skipped`}
            </li>
            <li>{result.pagesRestored} pages</li>
            {result.journalPagesRestored > 0 && (
              <li>{result.journalPagesRestored} journal pages</li>
            )}
            {result.memosRestored > 0 && <li>{result.memosRestored} inbox notes</li>}
            {result.blobs > 0 && <li>{result.blobs} images</li>}
          </ul>
          {result.warnings.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium mb-1" style={{ color: 'var(--danger)' }}>
                Notes
              </div>
              <ul className="text-xs" style={{ color: 'var(--text-3)' }}>
                {result.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-white"
            style={{ background: 'var(--accent)' }}
          >
            Done
          </button>
        </div>
      )}
    </Modal>
  )
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

const SSO_EMPTY: OidcSettings = {
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid email profile',
  buttonLabel: 'Single sign-on',
  autoCreate: false,
  allowedDomains: '',
  requiredGroup: '',
  adminGroup: '',
  groupsClaim: 'groups',
  passwordLogin: true,
  autoRedirect: false,
}

/** Instance-wide OpenID Connect settings (admin). */
/** Forward-auth is env-only (trusting a header is a deployment decision), so
 *  this just reports what the server is doing. */
function ProxyAuthCard() {
  const settings = trpc.settings.get.useQuery()
  const p = settings.data?.proxyAuth
  if (!p) return null
  return (
    <Card title="Sign-in through a reverse proxy — active (from env vars)">
      <p className="text-sm mb-2" style={{ color: 'var(--text-2)' }}>
        Requests from {p.trusted.join(', ')} that carry the <code>{p.emailHeader}</code> header are
        signed in as that email. The same header from any other address is ignored.
      </p>
      <p className="text-sm" style={{ color: 'var(--text-2)' }}>
        New people:{' '}
        {p.autoCreate
          ? 'an account is created on first visit'
          : 'must already have an account here'}
        . Change these with the <code>AUTH_PROXY_*</code> env vars.
      </p>
    </Card>
  )
}

function SsoSettingsCard() {
  const utils = trpc.useUtils()
  const settings = trpc.settings.get.useQuery()
  const save = trpc.settings.saveOidc.useMutation()
  const test = trpc.settings.testOidc.useMutation()
  const s = settings.data?.oidc
  const [form, setForm] = useState<OidcSettings>(SSO_EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null)
  const [copied, setCopied] = useState(false)
  if (s && !loaded) {
    const { hasSecret: _h, ...rest } = s
    setForm({ ...rest, clientSecret: '' })
    setLoaded(true)
  }
  const set = (patch: Partial<OidcSettings>) => {
    setForm((f) => ({ ...f, ...patch }))
    setDone(false)
  }
  const { busy, error, onSubmit } = useSubmit(async () => {
    await save.mutateAsync(form)
    await Promise.all([utils.settings.get.invalidate(), utils.auth.status.invalidate()])
    setForm((f) => ({ ...f, clientSecret: '' }))
    setDone(true)
  })
  const redirectUri = settings.data?.oidcRedirectUri ?? ''

  const check = (
    label: string,
    key: 'enabled' | 'autoCreate' | 'passwordLogin' | 'autoRedirect',
    hint?: string,
  ) => (
    <label className="flex items-start gap-2 mb-3 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={form[key]}
        onChange={(e) => set({ [key]: e.target.checked })}
      />
      <span>
        {label}
        {hint && (
          <span className="block text-xs" style={{ color: 'var(--text-3)' }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  )

  return (
    <Card title={`Single sign-on (OpenID Connect) — ${sourceLabel(settings.data?.oidcSource)}`}>
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Let people sign in with your identity provider: Authentik, Authelia, Keycloak, Pocket ID,
        Zitadel, Google, Microsoft Entra ID or any other OpenID Connect provider. Register this
        redirect URI with it:
      </p>
      <div
        className="flex items-center gap-2 mb-4 rounded-lg border px-3 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <code className="text-xs flex-1 break-all">{redirectUri}</code>
        <button
          type="button"
          className="text-xs underline shrink-0"
          style={{ color: 'var(--text-2)' }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(redirectUri)
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <form onSubmit={onSubmit}>
        {check('Turn on single sign-on', 'enabled')}
        <Field
          label="Issuer URL"
          placeholder="https://auth.example.com/application/o/beyond-notes/"
          value={form.issuer}
          onChange={(v) => set({ issuer: v })}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label="Client ID" value={form.clientId} onChange={(v) => set({ clientId: v })} />
          <Field
            label={s?.hasSecret ? 'Client secret (blank = keep saved)' : 'Client secret'}
            type="password"
            value={form.clientSecret}
            onChange={(v) => set({ clientSecret: v })}
            hint="Leave empty for a public client; PKCE is always used."
          />
          <Field
            label="Button label"
            value={form.buttonLabel}
            onChange={(v) => set({ buttonLabel: v })}
            hint="Shown as “Continue with …” on the sign-in page."
          />
          <Field label="Scopes" value={form.scopes} onChange={(v) => set({ scopes: v })} />
        </div>

        <h3 className="text-sm font-semibold mt-2 mb-2">Who can sign in</h3>
        {check(
          'Create accounts for new people',
          'autoCreate',
          'Off: only people who already have an account here (matched by verified email) can sign in.',
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field
            label="Allowed email domains"
            placeholder="example.com, family.lan"
            value={form.allowedDomains}
            onChange={(v) => set({ allowedDomains: v })}
            hint="Empty = any domain."
          />
          <Field
            label="Required group"
            value={form.requiredGroup}
            onChange={(v) => set({ requiredGroup: v })}
            hint="Only members of this provider group can sign in. Empty = no check."
          />
          <Field
            label="Admin group"
            value={form.adminGroup}
            onChange={(v) => set({ adminGroup: v })}
            hint="Members become admins, others members, on every sign-in. Empty = manage roles here."
          />
          <Field
            label="Groups claim"
            value={form.groupsClaim}
            onChange={(v) => set({ groupsClaim: v })}
            hint="The claim that lists a person's groups. Usually “groups”."
          />
        </div>

        <h3 className="text-sm font-semibold mt-2 mb-2">Sign-in page</h3>
        {check(
          'Allow password sign-in',
          'passwordLogin',
          'Off: members must use single sign-on. Admins can still use a password from “Admin sign-in”, and the sso:disable command turns SSO off from the server.',
        )}
        {check(
          'Go straight to the identity provider',
          'autoRedirect',
          'Skips the sign-in page. Add ?local to the address to reach it anyway.',
        )}

        <ErrorNote message={error} />
        {probe && (
          <p className="text-sm mb-3" style={{ color: probe.ok ? 'var(--live)' : 'var(--danger)' }}>
            {probe.message}
          </p>
        )}
        {done && (
          <p className="text-sm mb-3" style={{ color: 'var(--live)' }}>
            Saved — applies immediately.
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm sm:w-auto w-full disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
            disabled={test.isPending || !form.issuer}
            onClick={async () => {
              setProbe(null)
              try {
                const r = await test.mutateAsync(form)
                setProbe({ ok: true, message: `Connected to ${r.issuer}.` })
              } catch (err) {
                setProbe({ ok: false, message: err instanceof Error ? err.message : 'Failed.' })
              }
            }}
          >
            {test.isPending ? 'Testing…' : 'Test connection'}
          </button>
          <div className="flex-1">
            <SubmitButton label="Save single sign-on" busy={busy} />
          </div>
        </div>
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
  const setActive = trpc.users.setActive.useMutation({
    onSuccess: (list) => utils.users.list.setData(undefined, list),
  })
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
            className="flex items-center gap-3 py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)', opacity: u.disabled ? 0.6 : 1 }}
          >
            <span className="flex-1 min-w-0 truncate">
              {u.name} <span style={{ color: 'var(--text-3)' }}>({u.email})</span>
            </span>
            <span className="shrink-0" style={{ color: 'var(--text-2)' }}>
              {u.disabled ? 'deactivated' : u.role}
            </span>
            {u.id !== status.data?.me?.id && (
              <button
                type="button"
                className="underline text-xs shrink-0 disabled:opacity-60"
                style={{ color: u.disabled ? 'var(--accent)' : 'var(--danger)' }}
                disabled={setActive.isPending}
                title={
                  u.disabled
                    ? 'Let them sign in again'
                    : 'Sign them out everywhere and stop them signing in. Their notes stay.'
                }
                onClick={() => {
                  if (
                    u.disabled ||
                    window.confirm(
                      `Deactivate ${u.name}? They're signed out everywhere and can't sign in until you reactivate them. Nothing they made is deleted.`,
                    )
                  ) {
                    setActive.mutate({ userId: u.id, active: u.disabled })
                  }
                }}
              >
                {u.disabled ? 'Reactivate' : 'Deactivate'}
              </button>
            )}
          </li>
        ))}
        {setActive.error && (
          <li className="text-xs pt-2" style={{ color: 'var(--danger)' }}>
            {setActive.error.message}
          </li>
        )}
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

const AUDIT_LABEL: Record<string, string> = {
  'auth.setup': 'Set up this instance',
  'auth.login': 'Signed in with a password',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.sso_login': 'Signed in with single sign-on',
  'auth.sso_failed': 'Single sign-on failed',
  'auth.sso_linked': 'Linked single sign-on',
  'auth.sso_unlinked': 'Unlinked single sign-on',
  'auth.passkey_login': 'Signed in with a passkey',
  'auth.passkey_failed': 'Passkey sign-in failed',
  'auth.proxy_login': 'Signed in through the proxy',
  'auth.invite_accepted': 'Joined from an invite',
  'auth.password_changed': 'Changed their password',
  'auth.password_reset_requested': 'Asked for a password reset',
  'auth.password_reset': 'Reset their password',
  'auth.totp_enabled': 'Turned on 2FA',
  'auth.totp_disabled': 'Turned off 2FA',
  'auth.passkey_added': 'Added a passkey',
  'auth.passkey_removed': 'Removed a passkey',
  'auth.session_revoked': 'Signed out a device',
  'auth.token_created': 'Made an API token',
  'auth.token_revoked': 'Revoked an API token',
  'user.invited': 'Invited someone',
  'user.invite_revoked': 'Revoked an invite',
  'user.deactivated': 'Deactivated an account',
  'user.reactivated': 'Reactivated an account',
  'settings.saved': 'Changed settings',
  'backup.created': 'Made a backup',
  'backup.deleted': 'Deleted a backup',
  'backup.downloaded': 'Downloaded a backup',
  'backup.restored': 'Restored from a backup',
  'export.space': 'Exported a space',
}

/** Events an admin should notice when skimming. */
const AUDIT_WARN = new Set([
  'auth.login_failed',
  'auth.sso_failed',
  'auth.passkey_failed',
  'auth.totp_disabled',
  'backup.downloaded',
  'backup.restored',
])

const AUDIT_REASON: Record<string, string> = {
  BAD_CREDENTIALS: 'wrong email or password',
  TOTP_INVALID: 'wrong 2FA code',
  PASSWORD_LOGIN_DISABLED: 'password sign-in is turned off',
  NOT_FOUND: 'passkey not registered here',
  FAILED: 'passkey could not be verified',
  DISABLED: 'single sign-on only',
  NOT_ALLOWED: 'not allowed by the identity provider rules',
  NO_ACCOUNT: 'no account here',
  EMAIL_UNVERIFIED: 'email not verified by the provider',
  EXPIRED: 'sign-in expired',
  PROVIDER: 'identity provider error',
}

const AUDIT_FAMILIES: { value: AuditFamily; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'auth', label: 'Sign-ins and security' },
  { value: 'user', label: 'People and invites' },
  { value: 'settings', label: 'Settings' },
  { value: 'backup', label: 'Backups and restores' },
  { value: 'export', label: 'Exports' },
]

function auditDetail(e: AuditEventView): string {
  const parts: string[] = []
  if (e.target) parts.push(e.target)
  const d = e.detail ?? {}
  if (typeof d.reason === 'string') parts.push(AUDIT_REASON[d.reason] ?? d.reason)
  if (typeof d.role === 'string') parts.push(`as ${d.role}`)
  if (typeof d.spaces === 'number' && d.spaces > 0) {
    parts.push(`${d.spaces} space${d.spaces === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

const AUDIT_PAGE = 50

/** The audit log (admin): newest first, filterable, loads older on demand. */
function ActivityTab() {
  const utils = trpc.useUtils()
  const [family, setFamily] = useState<AuditFamily>('all')
  const [rows, setRows] = useState<AuditEventView[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (from: AuditEventView[], fam: AuditFamily) => {
    setLoading(true)
    setError(null)
    try {
      const page = await utils.client.settings.audit.query({
        family: fam,
        limit: AUDIT_PAGE,
        before: from.at(-1)?.at,
      })
      setRows([...from, ...page])
      setMore(page.length === AUDIT_PAGE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the activity log.')
    } finally {
      setLoading(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the filter changes
  useEffect(() => {
    void load([], family)
  }, [family])

  return (
    <Card title="Activity">
      <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
        Sign-ins (including failed ones), security changes and admin actions on this instance.
      </p>
      <select
        className="mb-4 w-full sm:w-auto rounded-lg border px-3 py-2 text-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
        value={family}
        onChange={(e) => setFamily(e.target.value as AuditFamily)}
      >
        {AUDIT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <ErrorNote message={error} />
      {rows.length === 0 && !loading ? (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Nothing recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((e) => {
            const detail = auditDetail(e)
            return (
              <li
                key={e.id}
                className="flex gap-3 py-2.5 border-t first:border-t-0 text-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: AUDIT_WARN.has(e.action) ? 'var(--danger)' : 'var(--border)',
                  }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium">{AUDIT_LABEL[e.action] ?? e.action}</span>
                    <time className="text-xs" style={{ color: 'var(--text-3)' }} dateTime={e.at}>
                      {new Date(e.at).toLocaleString()}
                    </time>
                  </div>
                  <div className="text-xs break-words" style={{ color: 'var(--text-2)' }}>
                    {e.actorEmail ?? 'unknown'}
                    {detail ? ` · ${detail}` : ''}
                    {e.ip ? ` · ${e.ip}` : ''}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {more && (
        <button
          type="button"
          className="mt-3 rounded-lg border px-4 py-2 text-sm disabled:opacity-60"
          style={{ borderColor: 'var(--border)' }}
          disabled={loading}
          onClick={() => load(rows, family)}
        >
          {loading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </Card>
  )
}
