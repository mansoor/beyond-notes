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
| Database | PostgreSQL 16 + Drizzle ORM (drizzle-kit migrations) |
| Search | Postgres full-text search (tsvector) |
| Editor | BlockNote (TipTap/ProseMirror underneath), ProseMirror JSON storage |
| Frontend | React 18 + Vite, TanStack Router + Query, Tailwind CSS v4 |
| Public rendering | Render-to-HTML **at publish time**, stored snapshots |
| Files/images | Local volume + sharp (thumbnails), EXIF-stripped on publish |
| Auth | Cookie sessions, argon2id; users table multi-user-ready |
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

### Database: PostgreSQL 16 + Drizzle

- Postgres over SQLite: the job scheduler, FTS, and concurrent publish/serve
  paths all want a real server; the user already operates Postgres in Docker.
  SQLite would save one container but cost migration pain the first time
  anything concurrent happens.
- **Drizzle ORM**: schema defined in TypeScript (single source of truth for
  types), SQL-transparent (no query-builder mystery), first-class migrations
  via drizzle-kit. Migrations are **forward-only**, run automatically on boot
  under a Postgres advisory lock.
- Core tables (from the concept doc): `users`, `spaces`, `pages`, `documents`
  (working copies), `page_versions` (immutable snapshots + rendered HTML),
  `tasks` (index over checkbox blocks), `reminders`, `attachments`,
  `scheduled_jobs`, `sessions`.
- **Search: Postgres FTS.** A tsvector column on working copies (private
  search) and one on published versions (public search, per site). Meilisearch
  is the upgrade path if FTS relevance ever disappoints; it is not worth a
  permanent extra container on day one.

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

### Auth: boring cookie sessions

Email + password, argon2id hashing, HttpOnly SameSite=Lax session cookie,
sessions table (revocable). Rate-limited login. No OAuth providers, no auth
SaaS — this is a self-hosted personal tool and the multi-user seam is the
`users` table, not the login method. Passkeys are a nice later addition.
CSRF: SameSite plus origin-check on mutations; the public surface is read-only.

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

Unit tests colocate (`*.test.ts`); integration tests run against a disposable
Postgres via Testcontainers (locally and in CI — same container image as
production compose).

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
  pgdata, uploads
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
- **M6 — polish to v0.1.** PWA + share target, global search UX, dark theme
  audit, backup/restore docs, first tagged release.

Risk watch: M1 (editor custom blocks) and M3 (publish correctness) are where
the unknowns live; if either slips, cut scope elsewhere, not there.

## Open questions (carried forward)

- Single-user vs. household multi-user: the schema seam exists (`users`,
  per-user task/reminder ownership); the *decision* is still open and should be
  made before M2 (tasks belong to someone).
- Image originals: keep forever vs. recompress — decide before galleries (M4).
- Export: PM JSON + Markdown export ships no later than v0.2 — data captivity
  in a personal-notes tool is a trust failure.
