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

// Hand-kept highlights; the full history lives on GitHub Releases.
// KEEP CURRENT: prepend an entry the moment you bump the version for a release —
// this is what the About dialog's "What's new" shows, and it drifts otherwise.
const RELEASE_NOTES: { v: string; notes: string[] }[] = [
  {
    v: '0.8.24',
    notes: [
      'Swipe left/right on the Today page to move between days',
      'About: “What’s new” is current again, with a Check-for-updates link',
    ],
  },
  {
    v: '0.8.23',
    notes: [
      'Swipe left/right to move between pages in a space',
      'Fixed the account menu being hidden on iPad',
      'Publishing dialog tabs become a dropdown on phones',
    ],
  },
  {
    v: '0.8.22',
    notes: [
      'Knowledge graph is now a preference — turn it off, pick which connections it draws, or disable it on phones',
      'New Preferences tab, split out of Appearance',
      'A default theme that follows you to a new device',
    ],
  },
  {
    v: '0.8.21',
    notes: [
      'Restore now brings back pages sitting in the Trash',
      'Each space kind shows an icon in the sidebar and the New-space dialog',
    ],
  },
  {
    v: '0.8.20',
    notes: ['On-demand restore — whole backup or space by space, add missing pages or replace'],
  },
  {
    v: '0.8.19',
    notes: [
      'Scheduled and on-demand full backups (admin), with retention and an optional S3 copy',
      'Empty days no longer appear on the Journal timeline',
    ],
  },
  {
    v: '0.8.18',
    notes: ['The knowledge graph draws typed relationships read from the text (“X runs Y”)'],
  },
  {
    v: '0.8.17',
    notes: [
      'Journal folds by year and month, with expand / collapse all',
      'Wider Journal and Settings, and more consistent icons',
    ],
  },
  {
    v: '0.8.16',
    notes: [
      'Optional on-device “similar meaning” graph layer (the -ml image)',
      'Leaner default image',
    ],
  },
  {
    v: '0.8.15',
    notes: [
      'Sharper graph concepts, plus [[links]] and shared #tags as connections',
      'Interactive graph — pin a concept, filter edge types, tune label density',
    ],
  },
  {
    v: '0.8.14',
    notes: ['The concept graph opens in a right drawer on mobile'],
  },
  {
    v: '0.8.13',
    notes: ['A clearer, less crowded graph with zoom and adjustable label density'],
  },
  {
    v: '0.8.12',
    notes: ['Per-space knowledge graph — single-click a space name to open its overview'],
  },
  {
    v: '0.8.11',
    notes: [
      'Journal timeline — every day, newest first',
      'A promoted inbox note links to where it landed',
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
          <div
            className="text-xs flex flex-wrap items-center gap-x-2"
            style={{ color: 'var(--text-3)' }}
          >
            <span>Version {version}</span>
            {/* the repo is private, so we can't check for a newer version from
                here — the link jumps to Releases where the latest is marked */}
            <a
              href={`${LINKS.github}/releases/latest`}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              Check for updates ↗
            </a>
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
            Use your browser’s <b>Install app</b> / <b>Add to Home Screen</b> option to keep it a
            tap away.
          </p>
        )}
      </Section>

      <details className="mb-5">
        <summary className="cursor-pointer text-sm font-semibold py-1 select-none">
          What’s new
        </summary>
        <div
          className="mt-2 max-h-56 overflow-y-auto rounded-lg border p-3"
          style={{ borderColor: 'var(--border)' }}
        >
          {RELEASE_NOTES.map((r) => (
            <div key={r.v} className="mb-3 last:mb-1">
              <div className="text-xs font-semibold mb-1">v{r.v}</div>
              <ul
                className="list-disc pl-4 text-sm flex flex-col gap-0.5"
                style={{ color: 'var(--text-2)' }}
              >
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
