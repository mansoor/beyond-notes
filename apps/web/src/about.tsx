import type { ReactNode } from 'react'
import pkg from '../package.json'
import { BrandMark, Modal } from './components'
import { isIOS, useInstallPrompt } from './pwa'

const version = (pkg as { version: string }).version

const LINKS = {
  github: 'https://github.com/mansoor/beyond-notes',
  // Your project's public site. Left blank the row is hidden.
  website: 'https://beyondnotes.app',
}

const BUILT_WITH = [
  'TypeScript',
  'React',
  'Vite',
  'Fastify',
  'tRPC',
  'TanStack Router & Query',
  'Drizzle ORM',
  'Tailwind CSS',
  'Docker',
]

// The notable third-party libraries the app leans on, beyond the frameworks.
const CREDITS: [string, string][] = [
  ['BlockNote', 'block editor'],
  ['Mermaid', 'diagrams'],
  ['Material Symbols', 'icons'],
  ['Simple Icons', 'social glyphs'],
  ['Zod', 'schema validation'],
  ['sharp', 'image processing'],
  ['argon2', 'password hashing'],
  ['Nodemailer', 'email delivery'],
  ['fflate', 'zip export'],
  ['SQLite & PostgreSQL', 'storage engines'],
]

// Hand-kept highlights; the full, generated changelog lives on GitHub Releases.
const RELEASE_NOTES: { v: string; notes: string[] }[] = [
  {
    v: '0.8.5',
    notes: [
      'Settings sections stack and use a dropdown on mobile',
      'Row action menus (＋ / ⋯) are reachable on touch',
    ],
  },
  {
    v: '0.8.4',
    notes: [
      'Mobile shell: sidebar becomes a drawer behind a fixed top bar',
      'Editor context rail and Today’s calendar open in a right drawer',
      'Fixed mobile scrollbars and editor width overflow',
    ],
  },
  {
    v: '0.8.3',
    notes: [
      'URL and Date-time database column types',
      'Drag to reorder columns and form fields',
      'Faster native multi-arch release builds',
    ],
  },
  {
    v: '0.8.2',
    notes: [
      'Optional delete confirmation',
      'Maintenance mode for published sites',
      'Whole-space draft preview before publishing',
      'Clearer lock / unlock messaging',
    ],
  },
]

export function AboutModal(props: { onClose: () => void }) {
  const { canInstall, installed, install } = useInstallPrompt()

  return (
    <Modal title="About Beyond Notes" onClose={props.onClose} width="lg">
      <div className="flex items-center gap-3 mb-4">
        <BrandMark size={40} />
        <div>
          <div className="font-semibold text-lg leading-tight">Beyond Notes</div>
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>
            Version {version}
          </div>
        </div>
      </div>

      <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
        A self-hosted home for your notes, journal, tasks, databases, and published website — one
        tool, running on your own server.
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        {LINKS.website ? <LinkChip href={LINKS.website} label="Website" /> : null}
        <LinkChip href={LINKS.github} label="GitHub" />
      </div>

      <Section title="Install">
        {installed ? (
          <p className="text-sm" style={{ color: 'var(--live)' }}>
            Installed — you’re running Beyond Notes as an app.
          </p>
        ) : canInstall ? (
          <button
            type="button"
            onClick={install}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            Install Beyond Notes
          </button>
        ) : isIOS ? (
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            On iPhone/iPad: tap the Share button, then <b>Add to Home Screen</b>.
          </p>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            Use your browser’s <b>Install app</b> / <b>Add to Home Screen</b> option to keep it a tap
            away.
          </p>
        )}
      </Section>

      <details className="mb-5">
        <summary className="cursor-pointer text-sm font-semibold py-1 select-none">What’s new</summary>
        <div
          className="mt-2 max-h-56 overflow-y-auto rounded-lg border p-3"
          style={{ borderColor: 'var(--border)' }}
        >
          {RELEASE_NOTES.map((r) => (
            <div key={r.v} className="mb-3 last:mb-1">
              <div className="text-xs font-semibold mb-1">v{r.v}</div>
              <ul className="list-disc pl-4 text-sm flex flex-col gap-0.5" style={{ color: 'var(--text-2)' }}>
                {r.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ))}
          <a
            href={`${LINKS.github}/releases`}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline"
            style={{ color: 'var(--text-3)' }}
          >
            Full history on GitHub →
          </a>
        </div>
      </details>

      <Section title="Built with">
        <div className="flex flex-wrap gap-1.5">
          {BUILT_WITH.map((t) => (
            <span
              key={t}
              className="text-xs rounded-full px-2 py-0.5"
              style={{ background: 'var(--accent-soft)', color: 'var(--text-2)' }}
            >
              {t}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Open-source credits">
        <ul className="text-sm flex flex-col gap-1" style={{ color: 'var(--text-2)' }}>
          {CREDITS.map(([name, what]) => (
            <li key={name}>
              <span className="font-medium">{name}</span> — {what}
            </li>
          ))}
        </ul>
        <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
          …and the many libraries these depend on. Thank you to their authors.
        </p>
      </Section>
    </Modal>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3
        className="text-[11px] uppercase tracking-wide font-semibold mb-2"
        style={{ color: 'var(--text-3)' }}
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  )
}

function LinkChip(props: { href: string; label: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="rounded-lg border px-3 py-1.5 text-sm"
      style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
    >
      {props.label} ↗
    </a>
  )
}
