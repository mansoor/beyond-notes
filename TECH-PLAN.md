# Beyond Notes — technology plan

Companion to `README.md` (the concept) and `mockup.html` (the UI direction).
This document settles the stack, the repo shape, testing, deployment, and the
release process. Format follows the command-center convention: decision, why,
what was rejected and why.

**Guiding principles**

1. **Self-host-first.** One Docker image, one Postgres, one volume. Every extra
   container (Redis, Elasticsearch, object storage) must justify its ops cost.
   Target: a Raspberry-Pi-class box can run it.
2. **Solo-dev velocity.** One language (TypeScript) end to end, types flowing
   from the DB schema to the browser without codegen ceremonies.
3. **The publish boundary is sacred.** Public serving reads only immutable
   published snapshots. This is enforced structurally (separate code path,
   separate tables), not by if-statements sprinkled through handlers.
4. **Boring where possible, novel only where the product is novel.** The novel
   parts are the editor blocks and the publish pipeline. Everything else should
   be the most conventional choice available.

---

## Stack summary

| Area | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Runtime | Node.js 22 LTS |
| Monorepo | pnpm workspaces |
| Backend | Fastify 5 + tRPC 11 (app API) / plain Fastify routes (public sites) |
| Database | PostgreSQL 16 (recommended) or SQLite (light mode); Drizzle ORM |
| Search | Postgres FTS / SQLite FTS5 behind one search interface |
| Editor | BlockNote (TipTap/ProseMirror underneath), ProseMirror JSON storage |
| Frontend | React 18 + Vite, TanStack Router + Query, Tailwind CSS v4 |
| Public rendering | Render-to-HTML **at publish time**, stored snapshots |
| Files/images | Pluggable blob store: local volume (default) or S3-compatible (MinIO, AWS, Wasabi); sharp thumbnails, EXIF-stripped on publish |
| Auth | Cookie sessions, argon2id, optional TOTP 2FA, email password reset + CLI rescue |
| Jobs/scheduler | Postgres-backed job table + in-process tick loop (no Redis) |
| Notifications | ntfy (push) + SMTP (email) |
| Testing | Vitest, Testcontainers (integration), Playwright (E2E) |
| Lint/format | Biome |
| CI/CD | GitHub Actions → multi-arch image on GHCR |
| Versioning | SemVer 0.x, conventional commits |

---

## The decisions, argued

### Editor: BlockNote on TipTap/ProseMirror

The editor is the highest-risk, highest-constraint choice — it decides the
document format, and the document format is the product's spine.

- **BlockNote** gives Notion-grade block UX (slash menu, drag handles, nesting)
  out of the box, and it *is* TipTap/ProseMirror underneath — custom blocks
  (task block, gallery block, embed) are ordinary TipTap node extensions, and
  ejecting to raw TipTap is a refactor, not a rewrite. Docmost itself is TipTap,
  which is evidence the base handles the wiki use case at production quality.
- **Storage format: ProseMirror JSON**, one document per page, stamped with a
  `schema_version` so block-format migrations are possible later (same logic as
  prompt versioning in the command center: never lose the ability to replay).
- Rejected: **Lexical** (block ecosystem thinner, custom block cost higher),
  **Markdown as source of truth** (loses structured blocks — a task block or
  gallery block has no faithful Markdown form; Markdown stays as an
  import/export format, not the storage format).

### No real-time collaboration (yet) — explicit non-goal

Yjs/CRDT sync is the single biggest complexity cliff in this category of app.
Single-user-first means: debounced autosave of the working copy, optimistic
locking (reject save if `updated_at` moved), last-writer-wins within one
account's sessions. **Revisit trigger:** the day two people routinely edit the
same page at the same time. The BlockNote/Yjs path exists and is well-trodden;
deferring costs nothing architecturally.

### Backend: Fastify + tRPC, split by audience

Two API surfaces with different needs:

- **App API (authenticated): tRPC.** End-to-end types from server procedure to
  React hook with zero codegen. For a solo TS developer this is the single
  largest velocity win available. Procedures organized per surface:
  `pages.*`, `spaces.*`, `tasks.*`, `publish.*`, `reminders.*`.
- **Public surface (unauthenticated): plain Fastify routes.** Published sites,
  RSS/Atom feeds, sitemaps, media. These must be curl-able, cacheable, and
  dependency-free — tRPC's RPC envelope is wrong here.

Rejected: **Next.js / full-stack meta-frameworks** — the app is a self-hosted
SPA plus server-rendered *public* pages, and the public pages are rendered at
publish time (below), so there is nothing for a meta-framework's SSR to do.
One Fastify process serves everything.

### Database: Postgres first, SQLite for light mode — MySQL rejected

- **PostgreSQL 16 is the recommended, reference deployment** — the compose
  file ships with it, CI treats it as primary, performance work targets it.
- **SQLite (WAL mode) is the supported light option.** It unlocks a genuinely
  different deployment class: no database container at all, one file to back
  up, runs on the smallest hardware. It's viable *because* the app is a single
  process — the scheduler and publish path don't need cross-process locking
  there.
- **MySQL/MariaDB: rejected.** The ask was "cheap enough to support" — and it
  isn't cheap; that's the honest answer. Every extra dialect multiplies
  migrations, FTS implementations, CI runs, and bug surface, forever. The
  audience that wants light wants SQLite (no DB server at all); anyone already
  operating MariaDB can run the Postgres container with identical effort, so
  MySQL support serves almost nobody while taxing everything. Two dialects is
  the most this project can test honestly.
- **Cost containment for two dialects** (this is what makes the SQLite promise
  real rather than aspirational): portable SQL only — no JSONB operators, no
  arrays, no PG-only tricks in shared code; the two genuine divergences live
  behind two narrow seams — a search interface (tsvector vs. FTS5) and a
  job-claim function (`SKIP LOCKED` vs. single-writer transaction). The
  integration suite runs on **both** dialects in CI; a feature is not done
  until it's green on both.
- **Drizzle ORM** (supports both dialects): schema defined in TypeScript
  (single source of truth for types), SQL-transparent, first-class migrations
  via drizzle-kit. Migrations are **forward-only**, run automatically on boot
  (advisory-locked on Postgres).
- Core tables (from the concept doc): `users`, `spaces`, `pages`, `documents`
  (working copies), `page_versions` (immutable snapshots + rendered HTML),
  `tasks` (index over checkbox blocks), `reminders`, `attachments`,
  `scheduled_jobs`, `sessions`.
- Search stays in the database (private search over working copies, per-site
  public search over published versions). Meilisearch is the upgrade path if
  relevance ever disappoints; not worth a permanent extra container on day one.

### Frontend: React + Vite SPA

React because the editor ecosystem is React-first. Vite for the build. TanStack
Router (typed routes) + TanStack Query (tRPC integrates natively). Tailwind v4
with the design tokens from the mockup as CSS variables — which is also exactly
how app light/dark and the public-site theme presets work: themes are token
sets, so the theming decision from the concept doc falls out of the CSS
architecture for free.

The SPA is built once and served as static files by Fastify — no Node SSR
process, no hydration complexity.

**Mobile capture:** the SPA ships as a PWA with a Web Share Target, so
"share to Beyond Notes" lands in the Inbox from a phone. This is the cheap 80%
of a mobile app and it's on the critical path for the Inbox surface being real.

### Publish pipeline: render at publish time

The concept doc's "working copy is never public, snapshot is never edited"
becomes physical here:

1. **Publish** = validate → snapshot the ProseMirror JSON into `page_versions`
   → render it to HTML **now** (via the shared renderer package) → store the
   HTML alongside the JSON → regenerate the site's nav, RSS, sitemap → flip the
   live pointer, all in one transaction.
2. **Serving** a public page = look up host → site, path → live version, return
   stored HTML wrapped in the site's theme shell. No ProseMirror, no React, no
   document parsing on the read path. It is effectively a static site with a
   database as the file system — fast, cacheable (ETag = version id), and
   incapable of leaking a draft because the draft has no rendered artifact.
3. The renderer lives in `packages/renderer` as a **pure function**
   (PM JSON → HTML) shared by server and tests. Media referenced by published
   pages is re-encoded on publish: thumbnails generated, **EXIF (including GPS)
   stripped** — a gallery of personal photos must not publish location data.

### Attachments: pluggable blob store, filesystem by default

Every upload (wiki attachments, note images, gallery photos) goes through a
deliberately tiny `BlobStore` interface — `put / getStream / delete / exists` —
keyed by content hash (free dedupe; re-uploading the same photo costs nothing).

- **Drivers: local filesystem (default, zero config)** and **S3-compatible**
  (endpoint + bucket + keys via env — covers MinIO, AWS S3, Wasabi, R2, B2).
  Two drivers, one interface, both in CI (S3 tested against MinIO in a
  container). Unlike a second SQL dialect, this abstraction genuinely is
  cheap — the interface has four methods and no query language.
- **All access is proxied through the app** — private attachments require a
  session; published media is served from the version-pinned public path with
  long cache headers. No presigned URLs in v0: they'd bypass the visibility
  boundary and make the storage backend visible to clients. Switching a
  deployment from filesystem to S3 is an env change plus a migration command
  (`cli blobs:migrate`), invisible to every URL.
- Derived assets (thumbnails, EXIF-stripped publish copies) are stored through
  the same interface. Backup story per driver: uploads volume, or the bucket's
  own durability + versioning.

### Auth: boring cookie sessions, with the safety rails

Email + password, argon2id hashing, HttpOnly SameSite=Lax session cookie,
sessions table (revocable — active-sessions list with per-device revoke in
Settings). Rate-limited login with lockout backoff. No OAuth providers, no
auth SaaS — the multi-user seam is the `users` table, not the login method.
Passkeys are a nice later addition. CSRF: SameSite plus origin-check on
mutations; the public surface is read-only.

- **2FA: TOTP, opt-in.** Standard authenticator-app enrolment (QR + manual
  secret), verified before it's enabled, with one-time recovery codes shown
  exactly once. No SMS (expensive, weaker, needs a provider).
- **Forgot password: email reset link** — single-use token, one-hour expiry,
  sessions invalidated on reset. This requires working SMTP, so there is also
  a **CLI rescue**: `docker compose exec app node cli user:reset-password` —
  a self-hoster locked out with broken SMTP must never be locked out of their
  own notes. The CLI path requires shell access to the host, which *is* the
  admin credential in a self-hosted deployment.

### Jobs, reminders, notifications: Postgres is the queue

A `scheduled_jobs` table (due-at, type, payload, attempts) plus a 30-second
in-process tick that claims jobs with `FOR UPDATE SKIP LOCKED`. Recurrence:
reminders store an RRULE (`rrule` package); completing an occurrence computes
and inserts the next one — which also implements re-arm-on-check from the
concept doc. Heads-up windows are just a second scheduled job per occurrence.

Channels: **ntfy** first (self-hosted push, trivial API, works on both phone
platforms), SMTP second, Web Push for the PWA later. Rejected: Redis/BullMQ —
a second stateful service to back up and monitor, for a queue that will see
dozens of jobs a day.

**Everything is opt-in.** No channel sends anything until it is both configured
(env) and enabled by the user (Settings → Notifications), with per-event
toggles: task due, reminder due, heads-up notices, and an optional daily digest
email (one morning message summarizing Today) instead of — or alongside —
per-event pings. Default state for every toggle is off; a notes app that
surprises you with email on day one has already broken trust.

### Settings: env for infrastructure, DB for preferences, tabs for humans

Two config layers with a hard line between them:

- **Environment variables** — things needed *before* the app is up, or that
  are deployment facts: DB connection, port, base URL, storage driver +
  credentials, SMTP/ntfy endpoints. Documented in an ASCII-only `.env.example`.
- **Database-stored settings** — everything a user can change at runtime,
  edited in the UI, validated by per-group zod schemas (no giant settings
  blob; each group is its own versioned object).

The Settings page is **small groups in separate tabs** (per the concept
discussion): **Account** (profile, email), **Security** (password, 2FA,
recovery codes, active sessions), **Notifications** (channels, per-event
toggles, digest), **Appearance** (app theme), **Storage** (backend info,
usage), **System** (version, update check, backup guidance). Per-site settings
(domain, theme, nav, header/footer) deliberately do *not* live here — they
stay on each space, where the mockup already puts them.

---

## Repository layout

```
beyond-notes/
  apps/
    server/        Fastify + tRPC + Drizzle + publish pipeline + scheduler
    web/           React SPA (app shell, editor, all five surfaces)
  packages/
    schema/        Drizzle tables + zod schemas + shared types
    renderer/      PM JSON → HTML (pure; used by publish + golden tests)
    editor/        BlockNote configuration + custom blocks (task, gallery…)
  e2e/             Playwright suites
  docker/          Dockerfile, compose files, Caddyfile example
  docs/            concept (README), this plan, ADRs as decisions accrue
```

pnpm workspaces; a change to `packages/schema` type-checks against both apps
in one `pnpm -r typecheck`.

---

## Testing strategy

The product's riskiest promises get the strongest tests:

1. **Renderer golden tests (Vitest).** Fixture PM JSON documents → expected
   HTML files, diffed exactly. Every block type, every nesting case. This is
   the publish pipeline's core and it's a pure function — cheap to test
   exhaustively.
2. **Visibility invariants (integration, Testcontainers).** Build a space
   containing drafts, pending edits, retired pages, and a published child under
   an unpublished parent; assert public nav, search, feeds, and link resolution
   expose *only* correctly-live content. These tests are the security
   boundary's spec, written adversarially.
3. **Version lifecycle (integration).** Publish v1 → edit → assert live serves
   v1 → publish v2 → assert v1 archived, v2 live → retire → 404 privately-kept →
   republish v1 → live again. Slug change leaves a redirect.
4. **Scheduler with a fake clock (Vitest).** RRULE advancement, heads-up
   scheduling, re-arm on completion, missed-tick catch-up after "downtime".
5. **Task indexing.** Editing a document reconciles the tasks index; checking
   off in the agenda mutates the block; both directions property-tested on
   random documents.
6. **E2E (Playwright), the golden paths only:** capture memo → promote to
   task → appears on Today; create wiki page → publish → visible on the public
   site, draft sibling absent; note → move into blog → post appears in feed.

Unit tests colocate (`*.test.ts`); integration tests run via Testcontainers —
against disposable Postgres **and** file-backed SQLite (the same suite, both
dialects, every CI run), plus MinIO for the S3 blob driver. A feature isn't
done until the matrix is green.

---

## Git flow

Mirrors the command-center convention, kept deliberately light for solo work:

- **`develop`** — integration branch, every commit CI-checked (lint,
  typecheck, unit, integration). Day-to-day work lands here directly or via
  short-lived feature branches (`feat/publish-pipeline`) when a change spans
  days.
- **`main`** — releasable, only receives merges from `develop` when cutting a
  release. Protected: full suite + E2E must pass.
- **Conventional commits** (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`) — this is what makes automated changelogs possible.
- Never commit `.env`; `.env.example` stays ASCII (Windows editor mojibake —
  learned the hard way on the command center).

## Release process

1. Merge `develop` → `main` (merge commit, not squash — preserves the
  conventional-commit history the changelog is generated from).
2. Tag `vX.Y.Z` (SemVer; 0.x until the schema stops churning — minor = feature,
   patch = fix; breaking DB or document-format changes bump minor pre-1.0 and
   get an explicit migration note).
3. GitHub Actions on tag: full suite → build **multi-arch (amd64 + arm64)**
   image → push `ghcr.io/<owner>/beyond-notes:vX.Y.Z` and `:latest` → draft a
   GitHub Release with a changelog generated from conventional commits.
4. **Upgrading an instance** = `docker compose pull && docker compose up -d`.
   Migrations run on boot, forward-only, advisory-locked (safe if two
   containers race). Rollback = restore backup + previous tag — documented,
   not improvised.

## Deployment model

```
docker compose:
  app        ghcr.io/…/beyond-notes  (Fastify: SPA + app API + public sites)
  postgres   postgres:16  (volume: pgdata)
  ntfy       optional, for push notifications
volumes:
  pgdata, uploads   (uploads absent when storage points at an S3 endpoint;
                     pgdata absent in SQLite light mode — one app volume total)
reverse proxy (host level, e.g. Caddy): TLS + routes
  notes.example.com     → app   (the private app)
  docs.mansoor.io       → app   (public: resolved by Host header → wiki)
  mansoor.io            → app   (public: → site space)
```

- One process serves everything; public sites are resolved **by Host header**
  (or path prefix for `mansoor.io/recipes`-style wikis) against each space's
  publishing config. Adding a published wiki = DNS record + one settings field.
- Caddy (or the user's existing proxy) owns TLS; the app never terminates it.
- **Backup** = nightly `pg_dump` + uploads volume snapshot, one documented
  restore script. This is the whole disaster-recovery story and it must be
  tested once before v0.1 ships, not after the first disaster. Note the
  contrast with the command center: there the DBs are disposable; **here the
  database is the product** — treat it accordingly.
- Health endpoint (`/healthz`) for compose/uptime checks. Structured logs
  (pino) to stdout; no log files in the container.

## Security notes

- Private/public split enforced by code path: public routes can only *reach*
  `page_versions` with a live pointer — the working-copy tables aren't touched
  by that router at all.
- Published HTML is generated only by our renderer from structured blocks — no
  raw-HTML block on published output in v0; if one is ever added, it gets
  sanitized at publish time (server-side, sanitize-html), not at serve time.
- Uploads served with restrictive content-types and `X-Content-Type-Options`;
  images re-encoded on publish (also kills embedded-payload tricks).
- Rate limits on login and on public-site request paths; public search is
  per-site scoped by construction (it queries that site's versions only).
- Argon2id, HttpOnly cookies, SameSite=Lax, origin-checked mutations.

---

## Build order (milestones)

Each milestone ends with something runnable — verify by running, always.

- **M0 — walking skeleton.** Monorepo, CI, Docker image, compose, migrations,
  auth, empty app shell. *Proves the pipeline end to end before features exist.*
- **M1 — pages + trees.** BlockNote editor, page CRUD, tree spaces (notebooks
  and wikis are already the same thing here), move/reparent. *The primitive.*
- **M2 — journal + inbox + tasks.** Date-keyed pages + calendar; capture
  stream + promote (note / journal / task); task indexing + Today aggregation.
- **M3 — publish pipeline + docs renderer.** Versions, live pointers, publish/
  retire/rollback, render-at-publish, Host-header routing, the docs theme,
  public FTS. *The moat. Gets the adversarial visibility test suite.*
- **M4 — website renderer.** Page types (blog, gallery), RSS, sitemap,
  redirects, theme presets. Note→post promotion falls out of M1's move + M4's
  types.
- **M5 — reminders + notifications.** Scheduler, RRULE, heads-up windows,
  ntfy/SMTP channels, Coming-up on Today.
- **M6 — polish to v0.1.** Settings surface (tabbed groups), 2FA + password
  reset flows, PWA + share target, global search UX, dark theme audit,
  backup/restore docs, first tagged release. (M0 ships plain email+password
  auth; the hardening lands here.)

Risk watch: M1 (editor custom blocks) and M3 (publish correctness) are where
the unknowns live; if either slips, cut scope elsewhere, not there.

## Open questions (carried forward)

- Single-user vs. household multi-user: the schema seam exists (`users`,
  per-user task/reminder ownership); the *decision* is still open and should be
  made before M2 (tasks belong to someone).
- Image originals: keep forever vs. recompress — decide before galleries (M4).
- Export: PM JSON + Markdown export ships no later than v0.2 — data captivity
  in a personal-notes tool is a trust failure.
