# Beyond Notes

One block-page primitive, five surfaces. Notes that go beyond the note: they
organize your day, hold your tasks, and publish to the web.

**Status: v0.2 in progress** — the three v0.2 items landed 2026-07-18/19:
**SMTP + forgot-password** (mailer seam, single-use 1h reset tokens, sessions
revoked on reset, TOTP deliberately survives a reset, emailed invites, email
notification channel with per-user opt-in — every email-dependent flow hides
in the UI until SMTP is configured), **S3-compatible blob storage** (MinIO/
AWS/Wasabi/R2/B2 behind the same BlobStore seam; set `S3_BUCKET` to switch;
`cli blobs:migrate fs s3` moves an existing library, idempotent), and
**export/import** (portability section below). v0.1.0 closed all six
milestones the same week: settings tabs, TOTP 2FA
(hand-rolled RFC 6238, verified against published vectors; recovery codes
shown once, single-use), session list/revoke, password change, the CLI
rescue (`node dist/cli.js user:reset-password` — resets password, clears
2FA, revokes sessions), global search (Ctrl+K, portable LIKE over titles/
content/memos, access-filtered), PWA (installable, share-target → Inbox
prefill), and backup/restore docs below.
Earlier: M5 (reminders + notifications) —
Reminders are lightweight scheduled tasks: one-time or recurring (freq ×
interval in pure date math — RRULE upgrade path open), optional heads-up
lead time, per-user. The scheduler is the plan's Postgres-as-queue design:
scheduled_jobs + a 30s tick with a portable compare-and-set claim (single
process by design), stale-job guards, 3-attempt retry, and boot-time
catch-up. Channels are opt-in: ntfy when configured (env), log otherwise;
SMTP arrives with M6 settings. Due reminders join Today's due list
(complete = re-arm), upcoming ones fill the Coming-up rail. Earlier:
M4.5 (attachments + galleries) —
Uploads flow through the four-method BlobStore (fs driver, content-addressed
sha256 keys, two-level fanout; the S3-compatible driver plugs in behind the
same seam later). Images are re-encoded at ingest — max edge 2560, WebP,
orientation applied, EXIF/GPS stripped — with 480px thumbs; non-images stored
as-is. Editor gets image blocks (BlockNote uploadFile); 'gallery' page type
gets a grid manager (multi-upload, captions, remove) and publishes its grid
into the snapshot. The privacy rule extends to files: each version records
its attachment ids, and the public file route serves exactly the union over
live versions of enabled spaces (cache invalidated on publish/retire) —
anonymous access is 404 before publish, 200 after, 404 again on retire.
M4 (website renderer, blog, RSS, themes, note→post) and M0–M3 landed the
same day. `mockup.html` is the UI direction; `TECH-PLAN.md` is the plan.

## Develop

Requires Node 20+ (dev machine note: portable Node 22 lives at
`~/.local/node22` — prepend it to PATH; system Node is 18) and pnpm 9 via
corepack.

```bash
pnpm install
pnpm --filter @bn/server dev     # API on :3800, SQLite at data/beyond.db by default
pnpm --filter @bn/web dev        # Vite on :5173, proxies /api to :3800
pnpm test                        # SQLite always; set TEST_PG_URL for the pg run
pnpm typecheck && pnpm lint
```

Production-style run: `pnpm build`, then from `apps/server`:
`WEB_DIST=../web/dist node dist/index.js`. Docker: `docker compose up -d`
(Postgres) after setting `POSTGRES_PASSWORD` in `.env`. Reset a dev instance
by deleting `apps/server/data/`.

## Backup & restore (the database IS the product)

**SQLite light mode:** everything lives in two places — the DB file
(`DATABASE_URL` path, plus its `-wal`/`-shm` siblings) and the uploads dir
(`UPLOADS_DIR`). Stop the app (or use `sqlite3 db ".backup backup.db"` for a
hot copy), copy both, done. Restore = put them back, start the app.

**Postgres:** nightly `docker compose exec postgres pg_dump -U beyond
beyond_notes > backup.sql` plus a copy of the uploads volume. Restore into a
fresh instance: `docker compose up -d postgres`, `psql < backup.sql`, restore
uploads, `docker compose up -d app`. Migrations are forward-only and run on
boot, so restoring an older dump into a newer app version is safe.

Test the restore once before trusting it — a backup that has never been
restored is a hope, not a backup.

## Export & import (your data is yours)

- **Full instance** — `node dist/cli.js export <dir>` writes `data.json` +
  `blobs/` (sessions and reset tokens deliberately excluded); restore with
  `node dist/cli.js import <dir>` into an **empty** database (it refuses
  otherwise). Passwords, 2FA, page trees, tasks, reminders, and files all
  survive; works across storage drivers (export from fs, import into S3).
- **One space as Markdown** — the ⤓ button next to a space downloads a zip:
  one `.md` per page mirroring the tree, images under `_attachments/` with
  links rewritten. Readable anywhere, importable into Obsidian et al.
- **Markdown folder in** — `node dist/cli.js import:markdown <dir> <space-name>
  <owner-email>` creates a space from a folder of `.md` files (folders nest,
  a leading H1 becomes the title, checkboxes land in the task index).

**Locked out?** (lost password, lost 2FA device, broken everything):
`docker compose exec app node dist/cli.js user:reset-password <email> <new>`
— resets the password, disables 2FA, revokes all sessions. Shell access to
the host is the credential.

## The model

Every space = **authoring mode × visibility × public renderer**.

| Facet | Authoring mode | Visibility | Public renderer |
|---|---|---|---|
| Organized notes | page tree | private | — |
| Wiki | page tree | public (per space) | Docs: left nav from tree, own header/footer |
| Daily notes | journal (date-keyed) | private | — |
| Random thoughts | stream (Memos-style) | private | — |
| Website | page tree + page types | public | Website: home/blog/gallery pages |

## Settled in the brainstorm (2026-07-18)

- **One primitive.** Everything is a block-based page with the same Notion-like
  editor. A "folder" is a page with children — no separate folder concept.
- **Tasks are a block, not an app.** Checkbox blocks anywhere are indexed into a
  global agenda with due dates and reminders. The block is the source of truth;
  the agenda edits the block.
- **Inbox and journal stay separate, but the day view surfaces both.** Capture is
  frictionless (no title, no filing); memos can be promoted to a note, the
  journal, or a task.
- **Publishing is a two-track lifecycle.** The working copy is never public; the
  published snapshot is never edited. Per page: working copy (autosaved) +
  immutable published versions + a live pointer. Draft = no live version.
  Retire = clear the pointer (404 publicly, history kept). Rollback = move the
  pointer. Slug changes leave redirects.
- **Public output may only contain published content.** Nav, search, links,
  embeds — computed from live versions only. A page is publicly reachable only
  if all its ancestors are live.
- **One-space-per-public-site convention.** Space-level "can this be public",
  page-level "is this live right now". Site chrome (header/footer/nav/logo) is a
  small per-space settings object, not a theming engine.
- **Journal, Inbox, and Tasks are singleton surfaces, not user-managed spaces.**
  The app ships with exactly one of each; "create a space" only ever means
  creating a page tree (notebook, wiki, or site). One workspace total — no
  Notion-style multi-workspace, which would mean multiple inboxes and journals
  and defeat frictionless capture.
- **Sidebar containers (Wikis / Notebooks / Sites) are UI grouping only.** They
  hold no settings and no data. The publishable unit is the individual wiki
  (tree space): each wiki carries its own visibility and its own domain or
  path (`docs.mansoor.io`, or `mansoor.io/recipes`). Never give the container
  a visibility switch — that reintroduces per-item classification ambiguity.
- **Tasks are never generated — the checkbox block is the only source.** They
  come from three doors, all producing the same block: written inline in any
  page, promoted from a memo, or quick-added in the Tasks view (those land in a
  built-in "Tasks inbox" note). The Tasks view is an index over blocks, not a
  store; checking off in either place is the same edit.
- **Reminders live inside the Tasks surface, not as a separate subsystem.** A
  reminder is a lightweight task with a schedule; recurring ones carry an
  RRULE and re-arm on completion. One notification channel (push/email/ntfy)
  serves both task reminders and standalone reminders. A separate Reminders
  app-within-the-app was considered and rejected: two things that both mean
  "nag me later" would force a taxonomy decision on every capture.
- **Reminders carry an optional heads-up lead time, and surface on Today.**
  Annual life-admin (car registration, tax due date, passport renewal) is the
  primary use case, and firing on the day is useless for those — so a reminder
  has a due date/rule plus an optional heads-up window ("30 days before").
  The Today page shows reminders due today in "Due today" and the near horizon
  in a "Coming up" card; birthdays/anniversaries are just yearly reminders.
- **App theme ≠ site theme.** The app supports light/dark. Each published site
  picks from a small set of preset themes — design tokens only (fonts, colors,
  header style), never structure — each with a light and dark variant. A
  WordPress-style theming engine is explicitly out of scope: the renderer owns
  structure, the theme owns skin, so every theme works with every space forever.

## Formerly open, now settled (see TECH-PLAN.md)

- Multi-user: yes — flat household model. Space-level personal/shared only,
  two roles (admin/member), no ACLs or groups in this version.
  Journal/Inbox/Tasks/Reminders are per-user singletons.
- Mobile capture: PWA + Web Share Target.
- Editor: BlockNote (TipTap/ProseMirror), ProseMirror JSON storage.
- Public hosting: render-to-HTML at publish time, served from snapshots.
- Images: recompressed on upload — sharing copies, not primary photo storage.
- Export/import: full-instance export + Markdown both ways, ships v0.2.
