# Design notes

The product-level thinking behind Beyond Notes. `README.md` is the user-facing
guide; [`TECH-PLAN.md`](TECH-PLAN.md) is the architecture; this file holds the
concept and the product decisions that were argued and settled. Moved here when
the README became end-user documentation (2026-07-21).

---

## The model

Every space = **authoring mode × visibility × public renderer**.

| Facet | Authoring mode | Visibility | Public renderer |
|---|---|---|---|
| Organized notes | page tree | private | — |
| Wiki | page tree | public (per space) | Docs: left nav from tree, own header/footer |
| Daily notes | journal (date-keyed) | private | — |
| Random thoughts | stream (Memos-style) | private | — |
| Website | page tree + page types | public | Website: home/blog/gallery pages |

---

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
- **App theme ≠ site theme.** The app ships four, lightest to darkest: Light,
  Paper, Midnight navy, Dark. Each published site
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
- Export/import: full-instance export + Markdown both ways, shipped v0.2.

## Data tables (v0.7)

- **Metadata + JSON rows.** Columns are a JSON definition on the table; each row
  stores a JSON object keyed by stable column id. No per-table DDL, no dynamic
  schema — one migration covers every table a user will ever make.
- **`[[form:id]]` embedding over page-level attach.** A form is rarely the whole
  page; a contact page wants prose *and* a form. An inline token composes.
- **Forms and embeds compose at serve time, not publish time.** A published
  snapshot is frozen content; live data would be stale the moment it was
  written. Chrome (nav, social, forms, table embeds) is assembled on each
  request against the same visibility rules.
- **Visibility follows the database, not the row.** A table in a personal
  database can never appear in public output, even if the token is pasted into
  a published page.

---

## Password locks are a lock screen, not encryption (v0.8, decided 2026-07-21)

A locked notebook or page asks for the **account password** before it opens, and
remembers the answer for the session or for 30 idle minutes. Enforcement is
server-side: the document never leaves the server locked, and locked pages are
filtered out of search so a snippet cannot leak what the page refuses to show.

It is deliberately **not** encryption. The content stays plain text in the
database, so a backup, the DB file, or `cli export` still reveal it. Two reasons
that is the right first version:

- **A forgotten passphrase would be unrecoverable data loss.** Encrypting at
  rest turns "I locked my notes" into "I destroyed my notes" for anyone who
  forgets, and a personal-notes tool should not hold that gun.
- **The threat it was asked to answer is the laptop left open**, not an attacker
  with disk access. Someone with the database file already has everything.

The UI says all of this at the moment of locking, rather than letting the word
"password" imply more than it delivers.

Two upgrades are open if the promise ever needs to be bigger: encryption with a
**separate passphrase** per notebook (strongest, needs an explicit "if you lose
this, the notes are gone" ceremony), or a key derived from the account password
(no second secret, but a password change means re-encrypting and the CLI reset
would orphan locked notes). Both were considered and deferred, not overlooked.

## Categories are derived, not curated (v0.9, decided 2026-07-22)

A blog post or a gallery holds one **category** as free text on the page. There
is no categories table: the list a picker offers is the distinct set the pages
of that space already use, so a category is created by naming it and retires
when its last page lets it go.

The cost is real — two spellings are two categories — and it is paid down by
offering the existing names first and matching case-insensitively when the set
is derived. What it buys is that there is nothing to keep in sync: no orphan
rows, no rename cascade, no "delete category → what happens to its pages?"
dialog. Tags already cover many-to-many; categories are the single-value axis
that fits in a dropdown, which is exactly why they are worth having as well.

Categories and the blog's **list/grid** choice are *live presentation*, like the
nav icon: they read from the page row at serve time, not from the frozen
snapshot. Recategorising or switching layout shows immediately without a
republish, which is what a reader-facing filter has to do to be useful.

Filtering is `?category=<slug>` on the blog index and on a parent gallery. The
chips are the only route to a filtered view — an unrecognised slug is ignored
rather than 404ing, so a stale link degrades to the full list.

## Form layout: a grid the author declares, not one inferred (v0.9)

Multi-column forms let each field name its **column** and its **span**. Fields
flow in order and a new row starts when the column is already taken, which is
plain CSS grid auto-placement — so what the author declares is what renders,
including a deliberate gap.

Two things make it safe. The clamp (`normalizeFormLayout`) lives in `@bn/schema`
so the browser's dropdowns and the saved config cannot disagree about what fits;
narrowing a 4-column form to 2 refits every field instead of stranding one. And
placement travels as `--c` / `--w` custom properties rather than an inline
`grid-column`, because the phone breakpoint has to collapse everything to one
column and an inline style would outrank the media query.

The cap is **four**, which is more than a usable public form wants — the point
is room to arrange, not to fill. Wide grids degrade in two steps: `.bn-form-dense`
(3–4 columns) halves on a tablet, then everything flattens on a phone. The phone
rule has to name the dense selector too, or it loses on specificity and a
4-column form stops at two columns on a phone. That one was found by measuring
the rendered grid at three widths, not by reading the CSS.

**One table, not two.** Which fields are on the form and where they sit is a
single decision, so it is a single table: tick box, field name, position, width.
The controls stay visible but inert for a field that is off (or a form with no
grid) rather than appearing and disappearing, so the table does not reflow while
you work down it.

## Milestone history

- **v0.1.0** — settings tabs, TOTP 2FA (hand-rolled RFC 6238, verified against
  published vectors; recovery codes shown once, single-use), session
  list/revoke, password change, the CLI rescue (`user:reset-password`), global
  search (Ctrl+K, portable LIKE, access-filtered), PWA with share-target →
  Inbox, backup/restore docs. Closed all six milestones in one week.
- **v0.2.0** — SMTP + forgot-password (single-use 1h reset tokens, sessions
  revoked on reset, TOTP deliberately survives a reset, emailed invites, email
  notification channel with per-user opt-in — every email-dependent flow hides
  in the UI until SMTP is configured); S3-compatible blob storage behind the
  BlobStore seam (`cli blobs:migrate fs s3`, idempotent); export/import.
- **M4.5** — attachments + galleries. Four-method BlobStore, content-addressed
  sha256 keys with two-level fanout; images re-encoded at ingest (max edge 2560,
  WebP, orientation applied, EXIF/GPS stripped) with 480px thumbs. Each version
  records its attachment ids and the public file route serves exactly the union
  over live versions of enabled spaces — 404 before publish, 200 after, 404
  again on retire.
- **M5** — reminders + notifications. Postgres-as-queue: `scheduled_jobs` + a
  30s tick with a portable compare-and-set claim (single process by design),
  stale-job guards, 3-attempt retry, boot-time catch-up. Channels opt-in: ntfy
  when configured, log otherwise.
- **M4** — website renderer, blog, RSS, themes, note→post. M0–M3 landed the same
  day.
- **v0.3–v0.6** — context rail, explicit tags, pinned favorites; `[[` links,
  backlinks, slug redirects, trash, version diff, templates; SEO/OG meta, public
  tag pages, blog pagination, draft previews, scheduled publishing; wiki reading
  experience (TOC, breadcrumbs, collapsible nav, code copy, stale pages).
- **v0.7.0** — databases, tables, public forms with CAPTCHA, read-only table
  embeds, CSV/zip export.

`mockup.html` is the original UI direction.
