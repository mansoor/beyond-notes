# Beyond Notes

**Your notes, your wiki, and your website — one self-hosted app you actually own.**

Beyond Notes is a block-based note-taking app that doesn't stop at notes. The
same page you write in the morning can become a documentation site, a blog post,
or a public gallery in the afternoon — without exporting anything, converting
anything, or trusting anyone else's cloud. It runs as a single Docker container
on a laptop, a NAS, or a $5 VPS.

It is built around one idea: **there is only one kind of thing — a page.** A
folder is a page with children. A task is a checkbox inside a page. A blog post
is a page that got published. Learn the editor once and you know the whole app.

**What you get**

- 📝 A modern block editor (slash commands, drag handles, code blocks, images,
  tables, Mermaid diagrams) with autosave
- 📚 **Notebooks, wikis and websites** — private notes, published docs, or a
  full blog/gallery site, all from the same page tree
- ⤒ **Import a README or a whole GitHub repo** into a wiki — proposed structure
  first, your edits, then the pages
- 🗓️ **Journal, Inbox, Tasks and Reminders** — frictionless capture and a real
  agenda, with notifications
- 🗃️ **Databases** — spreadsheet-style tables with typed columns and
  validation, publishable as **public forms** and **read-only table embeds**
- 🌐 **Publishing that can't leak** — public output is composed only from
  published snapshots; a draft is a 404 to the world, always
- 👥 **Household multi-user** — invite people, keep spaces personal or shared,
  2FA, sessions you can revoke
- 🔒 **No accounts, no telemetry, no CDN** — fonts, icons and diagram scripts
  are served from your own instance; it works offline

---

## Table of contents

1. [Quick start](#quick-start)
   - [A. `docker run` (SQLite — simplest)](#a-docker-run-sqlite--simplest)
   - [B. Docker Compose with SQLite](#b-docker-compose-with-sqlite)
   - [C. Docker Compose with Postgres](#c-docker-compose-with-postgres)
   - [First run](#first-run)
2. [Features](#features)
   - [The editor](#the-editor)
   - [Spaces: notebooks, wikis, sites](#spaces-notebooks-wikis-sites)
   - [Day, Inbox, Tasks, Reminders](#day-inbox-tasks-reminders)
   - [Finding things](#finding-things)
   - [Databases, forms and table embeds](#databases-forms-and-table-embeds)
   - [Publishing to the web](#publishing-to-the-web)
   - [Files, images and galleries](#files-images-and-galleries)
   - [People, access and security](#people-access-and-security)
   - [Keeping the sidebar yours](#keeping-the-sidebar-yours)
   - [Password-locking a notebook or a page](#password-locking-a-notebook-or-a-page)
   - [Safety nets](#safety-nets)
3. [Configuration](#configuration)
   - [Environment variables](#environment-variables)
   - [In-app settings](#in-app-settings)
4. [Putting it on the internet](#putting-it-on-the-internet)
5. [How-to guides](#how-to-guides)
   - [Publish a wiki](#publish-a-wiki)
   - [Turn a README (or a repo) into a wiki](#turn-a-readme-or-a-repo-into-a-wiki)
   - [Run a blog](#run-a-blog)
   - [Collect submissions with a form](#collect-submissions-with-a-form)
   - [Embed a table in a page](#embed-a-table-in-a-page)
   - [Invite someone to your instance](#invite-someone-to-your-instance)
   - [Capture from your phone or another app](#capture-from-your-phone-or-another-app)
   - [Get your data out](#get-your-data-out)
   - [Back up and restore](#back-up-and-restore)
   - [Upgrade to a new version](#upgrade-to-a-new-version)
6. [Troubleshooting](#troubleshooting)
7. [Development](#development)

---

## Quick start

Every release publishes a **multi-architecture Docker image** (linux/amd64 and
linux/arm64 — so Intel/AMD servers *and* Apple Silicon / Raspberry Pi 4+ / ARM
VPSes) to GitHub Container Registry:

```
ghcr.io/mansoor/beyond-notes:v0.8.0   # pinned version (recommended)
ghcr.io/mansoor/beyond-notes:latest   # moving tag
```

> **The repository and the image are currently private.** Log in before pulling:
> ```bash
> echo <YOUR_GITHUB_PAT> | docker login ghcr.io -u <your-github-username> --password-stdin
> ```
> The token needs the `read:packages` scope. To drop the login step entirely,
> open the package on GitHub → *Package settings* → *Change visibility* →
> **Public**; anonymous `docker pull` then works anywhere.

**Requirements:** Docker (and Docker Compose v2 for options B and C). ~300 MB of
disk for the image, plus whatever your content needs.

### A. `docker run` (SQLite — simplest)

Good for a laptop, a NAS, or a single-person instance. No database server, one
volume, one command:

```bash
docker volume create beyond-data

docker run -d \
  --name beyond-notes \
  --restart unless-stopped \
  -p 3800:3800 \
  -v beyond-data:/app/data \
  -e BASE_URL=http://127.0.0.1:3800 \
  ghcr.io/mansoor/beyond-notes:latest
```

Open <http://127.0.0.1:3800>. Everything — database, uploads, encryption key —
lives inside that one volume at `/app/data`, so backing the app up means backing
up one thing. Prefer a host directory? Swap the volume for
`-v /srv/beyond/data:/app/data`.

### B. Docker Compose with SQLite

Same engine, nicer to live with. Save as `docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/mansoor/beyond-notes:latest
    restart: unless-stopped
    ports:
      - "3800:3800"
    environment:
      # file: paths are relative to /app inside the container
      DATABASE_URL: file:./data/beyond.db
      BASE_URL: ${BASE_URL:-http://127.0.0.1:3800}
    volumes:
      - beyond-data:/app/data

volumes:
  beyond-data:
```

```bash
docker compose up -d
docker compose logs -f app     # watch it migrate and start
```

### C. Docker Compose with Postgres

Choose this if you expect several users, heavy publishing, or you already run
Postgres backups. Save as `docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/mansoor/beyond-notes:latest
    restart: unless-stopped
    ports:
      - "3800:3800"
    environment:
      DATABASE_URL: postgres://beyond:${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}@postgres:5432/beyond_notes
      BASE_URL: ${BASE_URL:-http://127.0.0.1:3800}
    volumes:
      - beyond-data:/app/data      # uploads + secrets key still live here
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: beyond
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: beyond_notes
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U beyond -d beyond_notes"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  beyond-data:
  pgdata:
```

Put the password in a `.env` file next to it:

```env
POSTGRES_PASSWORD=change-me-to-something-long
BASE_URL=https://notes.example.com
```

```bash
docker compose up -d
```

> ⚠️ **Postgres only reads `POSTGRES_PASSWORD` the first time it initialises its
> data directory.** Changing it later in `.env` will not change the database
> password — it just breaks the app's connection string. To rotate it properly,
> use `ALTER USER` inside Postgres and update `.env` to match.

**SQLite or Postgres?** Both are fully supported and every test runs against
both. SQLite is a file, needs no second container, and is plenty for one person
or a household. Postgres is the better answer for many concurrent writers and
for teams with existing DBA habits. You can start on SQLite and move later —
`cli export` / `cli import` copies an instance across engines.

### First run

1. Open your `BASE_URL`. Because there is **no open registration, ever**, the
   very first visit shows a **Create admin account** page instead of a login
   form. That page appears exactly once — the moment a user exists, it becomes a
   normal login screen.
2. Create your account. You are the admin: you can invite others, manage
   storage, and configure email.
3. Create your first space from the sidebar (**+ New space**), pick *Notebook*,
   *Wiki* or *Site*, and start writing.

> **Seeing "Create admin account" on an instance that already had content?** You
> are almost certainly pointed at a different/empty database — check
> `DATABASE_URL` and that your volume is actually mounted. Do **not** create the
> account; fix the path first, or you will start a second, empty instance.

---

## Features

### The editor

A Notion-style block editor (BlockNote). Type `/` for the block menu; drag the
handle to reorder; select text for the formatting toolbar.

- Headings, lists, quotes, callouts, dividers, tables, alignment (including
  justify)
- **Code blocks** with syntax highlighting and a copy button on published pages
- **Mermaid diagrams** — flowcharts, sequence diagrams, gantt charts; the script
  is served from your instance, never a CDN
- **Images** pasted or dropped straight in, re-encoded and stripped of EXIF/GPS
- **`[[` page links** with autocomplete, plus a **backlinks** panel showing what
  points here
- **`#tags`** typed inline anywhere, or added as chips
- Everything autosaves; **History** keeps published versions with a visual diff
  and one-click rollback

The right-hand **context rail** carries the page's icon, description, tags,
links, backlinks and settings without cluttering the writing surface.

### Spaces: notebooks, wikis, sites

A **space** is a tree of pages. Its category decides which features it gets:

| Category | Best for | Public renderer |
|---|---|---|
| **Notebook** | personal notes, projects, reference | optional docs-style site |
| **Wiki** | documentation, handbooks, recipes | docs layout: left nav from the tree, breadcrumbs, on-this-page TOC, prev/next |
| **Site** | a blog, a portfolio, a public homepage | full website: home, blog with pagination and RSS, galleries, tag pages, share buttons, social links |

Spaces are **shared** with everyone on the instance by default, or **personal**
to you. Sidebar groups (NOTEBOOKS / WIKIS / SITES / DATABASES) are visual
grouping only — the publishable unit is the individual space.

Pages can be reordered by drag-and-drop, nested, duplicated, saved as
**templates**, given an emoji or Material Symbols icon, and moved between
parents with the *Reorganize* dialog.

**Import a whole wiki in one step.** ⤒ *Import a wiki* (in the sidebar, or on a
space) turns a long markdown document — or a GitHub repository — into a page
tree: the prose before the contents list becomes *Introduction*, each `##`
section becomes a page, each `###` its child, and the table of contents itself is
dropped because the wiki's own navigation replaces it. From a repository it also
picks up `docs/` and adds `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`,
`LICENSE` and friends as pages at the bottom. **The first pass only proposes** —
you rename, re-nest, reorder and untick rows, choose drafts or publish-on-import,
and nothing is written until you approve. In-document links like
`[Quick start](#quick-start)` are rewritten to point at the page that section
became.

### Day, Inbox, Tasks, Reminders

- **Today** — a date-keyed journal page plus everything due today, and a
  "Coming up" rail for the near horizon.
- **Inbox** — frictionless capture. No title, no filing. Later, promote a memo
  into a note, the journal, or a task.
- **Tasks** — a global agenda built from **checkbox blocks anywhere in your
  pages**. The block is the source of truth; ticking it off in the agenda edits
  the block. Due dates and times use a scroll-wheel picker.
- **Reminders** — one-time or recurring (daily/weekly/monthly/yearly ×
  interval), with an optional **heads-up lead time** — the feature that makes
  annual life-admin (registrations, renewals, birthdays) actually work, because
  firing on the day is useless. Notifications go to **ntfy** or **email** when
  configured.

### Finding things

- **Ctrl/⌘+K** global search across page titles, page content and memos —
  always filtered to what you're allowed to see
- **Tags** page: everything carrying a given `#tag`, pages and memos together
- **Pinned favorites** and **recently edited** at the top of the sidebar
- **Stale pages** view: published pages that haven't been touched in a while

### Databases, forms and table embeds

The **Databases** section of the sidebar holds databases; each database holds
tables. A table is a simple, editable grid:

- Column types: **text, long text, number, date, checkbox, select, email**
- Per-column **constraints with custom validation messages** — required,
  min/max, min/max length, regex pattern
- Rows added, edited and deleted inline; duplicate, rename, move, archive or
  restore a whole table from its **⋯ menu**

Two things make tables more than a spreadsheet:

**Public forms.** Turn any table into a form. Configure the title, description,
which columns appear, the submit-button label, the thank-you message and whether
a submission notifies you — then drop `[[form:<id>]]` into any page of a
published space. Forms can be laid out in **up to four columns**: one table
lists every column of the table with a tick box, a **position** and a **width**,
so *Zip* can sit beside *City* while *Message* runs the full width. A field can
only span as far as the last position, so the width choices change with the
position you pick. Narrow screens step down — a wide form halves on a tablet,
and everything falls back to a single column on a phone. Submissions land as rows, tagged with their source. A hidden
honeypot field and per-IP rate limiting are always on; on top of that you can
switch on a **built-in math CAPTCHA** (self-hosted, no third party, no network
calls) or **Google reCAPTCHA v2** if an admin adds keys in Settings →
Notifications. The form works without JavaScript too.

**Read-only table embeds.** Present live table data inside a published page:

```
[[table='<table-id>' layout='cards' pagesize='10' columns='name,role' sort='name:asc' filter='role:editor' limit='200']]
```

| Attribute | Meaning | Default |
|---|---|---|
| `table` / `id` | the table's id (copy it from the table's *Embed* button) | required |
| `layout` | `table`, `cards` or `list` | `table` |
| `columns` | comma-separated column names/ids to show, in order | all |
| `sort` | `column:asc` or `column:desc` | insertion order |
| `filter` | `column:value` exact match | none |
| `limit` | max rows fetched (1–2000) | 500 |
| `pagesize` | client-side page size; omit for one page | none |

Embeds render at **serve time**, so a published page always shows current data
— and a table in a **personal** database will never render publicly, by design.

**Export** anytime: a table as CSV, or a whole database as a zip of CSVs, from
the buttons in the Data view.

### Publishing to the web

Publishing is a two-track lifecycle, and it's the part of the app that is
deliberately paranoid:

- The **working copy is never public.** Publishing takes an **immutable
  snapshot**; editing afterwards changes only the draft.
- **Retire** clears the live pointer — the page 404s publicly but the history is
  kept. **Rollback** just moves the pointer back to an older version.
- A page is publicly reachable **only if all of its ancestors are live.** Nav,
  search, feeds and links are computed from live versions only.
- Renaming a slug leaves a **redirect** behind, so external links keep working.
- **Scheduled publishing** (publish at a future date/time) and **draft preview
  links** (a secret URL for one unpublished page) are both built in.
- SEO comes free: per-page description, Open Graph/Twitter meta, `robots.txt`,
  a favicon derived from your logo, and an RSS feed for blogs.

Each publishable space gets its own **theme** (paper, ink, mist, sand, bloom) ×
**appearance** (auto / light / dark), a logo, a tagline, one of four header
layouts, social links, and a footer. Themes are design tokens only — they never
change structure, so every theme works with every space forever.

> **Is Publish useful before you have a domain?** Yes, for two reasons. It
> creates the version history — every publish is a restorable snapshot with a
> diff — and you can view the result immediately at
> `http://<your-host>:3800/s/<the-space's-public-host>/`, no DNS required. See
> [Putting it on the internet](#putting-it-on-the-internet).

### Files, images and galleries

Uploads go through a pluggable store, switchable at runtime in Settings →
Storage:

- **Filesystem** (default) — content-addressed under `UPLOADS_DIR`
- **Database** — everything in one place; simplest possible backup
- **S3-compatible** — MinIO, AWS, Wasabi, Cloudflare R2, Backblaze B2

Images are re-encoded on upload (max edge 2560, WebP, orientation applied, **EXIF
and GPS stripped**) with 480px thumbnails. `gallery` pages get a grid manager
with multi-upload, captions, covers, layouts, a lightbox and optional carousel
autoplay. A gallery can carry a **category**; a parent gallery shows its albums
as cards with those labels and a row of chips to filter them. Public file access follows the same rule as pages: a file is served
publicly only if it belongs to a currently-live version.

Already have files in one driver and want another? `cli blobs:migrate fs s3`
moves them; it is idempotent and safe to re-run.

### People, access and security

- **Invite-only.** Admins create invites (emailed if SMTP is configured, or a
  link to hand over). There is no open registration mode and there never will
  be.
- Two roles: **admin** and **member**. Visibility is flat and deliberate —
  a space is either shared with everyone or personal to one user. No ACLs, no
  groups, no per-page permission puzzles.
- **TOTP two-factor** (any authenticator app) with single-use recovery codes
  shown once.
- **Session list** with individual revoke, password change, and
  forgot-password over SMTP.
- Secrets stored in the settings table are **encrypted at rest** with a key kept
  outside the database.
- **Locked out?** Shell access to the host is the master credential:
  ```bash
  docker compose exec app node dist/cli.js user:reset-password you@example.com <new-password>
  ```
  That resets the password, disables 2FA and revokes every session.

### Keeping the sidebar yours

**Settings → Appearance** also sets how far ahead the Today page's **"Coming
up"** list looks (default 7 days) — anything further out stays off the page,
except a reminder whose own heads-up window has opened. It hides sections you
don't use — Notebooks, Sites, Wikis
or Databases — or single spaces inside them. Hiding is only about clutter: a
hidden space still works, still takes new pages, and comes straight back when you
untick it. Creating something of a hidden kind is still allowed; the dialog warns
you it won't appear and offers to unhide it in one click. The preference follows
your account to every device you sign in from.

### Password-locking a notebook or a page

Lock a whole notebook or one page from its **⋯ menu**, and it asks for your
account password before opening. Choose when it asks again: **once per sign-in**,
or **after a period of not using it** — 5 minutes, 2 hours, or anything up to a
week (reading it slides the window forward). Signing out
re-locks everything, and so does a server restart.

> **What a lock is:** a lock screen for the laptop left open on the kitchen
> table. The server refuses to send a locked document, and locked pages never
> appear in search results.
>
> **What it is not:** encryption. The content is still plain text in the
> database, so a backup, the database file or a full-instance export can be read
> by anyone holding them. The lock dialog says so too — see
> [`DESIGN-NOTES.md`](DESIGN-NOTES.md) for why that trade was made and what the
> upgrade path is.

A page that is live on a public site cannot be locked — retire it first.

### Safety nets

- **Trash** — deleted pages recoverable for 30 days
- **Archive** — put a page or a data table out of the way without deleting it;
  restore anytime
- **History** — published versions with diffs and rollback
- **Export** — full-instance export, per-space Markdown zip, CSV per table

---

## Configuration

### Environment variables

Everything has a sensible default; a minimal deployment sets `BASE_URL` and
possibly `DATABASE_URL`.

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `file:./data/beyond.db` | `file:` path for SQLite, or a `postgres://` URL |
| `PORT` | `3800` | HTTP port inside the container |
| `BASE_URL` | `http://127.0.0.1:3800` | Public URL of the **app**. Used for links in emails, and an `https://` value turns on secure cookies. Set this correctly behind a proxy. |
| `UPLOADS_DIR` | `./data/uploads` | Filesystem blob store location |
| `SECRETS_KEY` | *(generated)* | Encryption key for stored secrets. If unset, one is generated and kept at `SECRETS_KEY_FILE` |
| `SECRETS_KEY_FILE` | `./data/secrets.key` | Where the generated key lives — **back this up with your database** |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | *(empty)* | Enables forgot-password, emailed invites and email notifications. Unset = those flows are hidden in the UI rather than failing |
| `NTFY_URL` / `NTFY_TOPIC` | *(empty)* | Push notifications via [ntfy](https://ntfy.sh) |
| `S3_BUCKET` / `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_FORCE_PATH_STYLE` | *(empty)* | Setting `S3_BUCKET` switches the blob store to S3. Empty endpoint = real AWS |
| `WEB_DIST` / `MIGRATIONS_DIR` | preset in the image | Only relevant when running from source |

### In-app settings

Admins can configure SMTP, ntfy, reCAPTCHA and storage from **Settings** in the
app — no restart, no redeploy. **A settings group filled in through the UI wins
over the matching environment variables;** env remains the bootstrap path and
the fallback. Tabs: *Account*, *Security*, *Notifications*, *Integrations*, and
(admins only) *Users* and *Storage*.

Database migrations run automatically on boot and are forward-only and
additive — starting a newer image against an older database is the normal
upgrade path.

---

## Putting it on the internet

The app serves both the private UI **and** every published site from the same
port, routing by `Host` header. Terminate TLS in a reverse proxy; the app never
does TLS itself.

1. Point DNS at your server: `notes.example.com` for the app, plus one hostname
   per published space (`docs.example.com`, `example.com`, …).
2. Set `BASE_URL=https://notes.example.com` so cookies are marked secure.
3. Proxy everything to port 3800. With Caddy (which gets you free HTTPS), see
   [`docker/Caddyfile.example`](docker/Caddyfile.example):

   ```caddyfile
   notes.example.com { reverse_proxy 127.0.0.1:3800 }
   docs.example.com  { reverse_proxy 127.0.0.1:3800 }
   example.com       { reverse_proxy 127.0.0.1:3800 }
   ```

4. In the app, open a space's **publishing settings**, enable public access and
   set its public host to the matching domain.

**No DNS yet?** Every published space is also reachable at
`http://<app-host>:3800/s/<public-host>/` — the same content, the same
visibility rules, no domain required. It's the fastest way to check what the
world would see.

---

## How-to guides

### Publish a wiki

1. **+ New space** → *Wiki*. Write a few pages; nest them by dragging.
2. Space **⚙ publishing settings** → enable public access → set a public host →
   pick a theme.
3. Publish each page you want live (a page is only reachable if its parents are
   live too).
4. Visit `/s/<public-host>/` to see the docs layout: tree nav on the left,
   breadcrumbs, an on-this-page TOC, and prev/next links at the bottom.

### Turn a README (or a repo) into a wiki

1. Click **⤒ Import a wiki** in the sidebar — or the **⤒** on an existing space
   to import into it.
2. Either paste a GitHub repository URL (`https://github.com/owner/repo`, a
   `/tree/<branch>` link, or just `owner/repo`) or choose/paste a markdown file.
   Private repository? Open *Private repository?* and supply a read token — it is
   used for that one request and never stored.
3. **Review the proposed structure.** Rename a page, indent or outdent it (⇥ /
   ⇤), move it (↑ / ↓), or untick anything you don't want.
   - **⊕ merges a row into the page above it** — its text is appended there
     under its own heading instead of becoming a page of its own. Useful for a
     `## License` section sitting next to a LICENSE file, or a subsection too
     small to deserve a page. Nested rows re-parent instead of disappearing, and
     **undo** puts everything back.
4. Pick the destination — a new wiki or an existing space — and decide whether
   pages arrive as **drafts** (default) or **published**.
   - Importing into a space that already has pages offers **"Archive the N pages
     already in this space"**, which is how you re-import a wiki over itself
     without ending up with two of everything. Archived pages are not deleted:
     published versions survive and any of them can be restored from *Archive*.
5. Import. You land on the first page it created.

### Run a blog

1. **+ New space** → *Site*.
2. Create a page and set its type to **blog** in the page settings — its child
   pages become posts, listed newest-first with pagination and an RSS feed.
   Choose how they are listed: a dated **list**, or a **grid** of cards led by
   their listing images.
3. Give posts a description, a listing image, a **category** and `#tags` — tags
   get their own public pages, and categories become filter chips on the blog
   index. Pick a category from the ones the site already uses, or type a new
   one; the set is simply whatever the pages use.
4. Optional: schedule a post to publish itself at a future date/time.

### Collect submissions with a form

1. In the sidebar under **Databases**, click **＋** (*New database*), then **＋**
   on that database (*New table*). Give the table the columns you want, plus
   constraints such as *required* and an email pattern.
2. Open the table's **Form** dialog: give it a title, choose visible columns,
   write the thank-you message, and pick a CAPTCHA mode (*basic* is
   self-hosted and needs no keys).
3. Copy `[[form:<id>]]` into any page of a **published, shared** space, and
   publish that page.
4. Submissions arrive as rows. Export them as CSV whenever you like.

> Keep the database **shared**, not personal — a form or embed in a personal
> database is intentionally invisible to the public.

### Embed a table in a page

Use the table's **Embed** button to copy a ready-made token, then paste it into
a page and adjust the attributes ([full list above](#databases-forms-and-table-embeds)):

```
[[table='abc123' layout='cards' columns='name,city' sort='name:asc' pagesize='12']]
```

Embeds and forms are composed when the page is served, so they show live data —
which also means they render on **published** pages, not inside the editor.

### Invite someone to your instance

Settings → **Users** → *Create invite*. With SMTP configured the invite is
emailed; otherwise copy the link and send it yourself. They pick their own
password on arrival. Their journal, inbox and tasks are their own; shared spaces
are visible to both of you, personal spaces are not.

### Capture from your phone or another app

- **Install the PWA** — open the app in mobile Chrome/Safari and *Add to home
  screen*. It registers as a **share target**, so sharing a link or some text
  from any app drops it into your Inbox.
- **Incoming webhooks** — Settings → Integrations creates a token per target;
  any script can then `POST` plain text:
  ```bash
  curl -X POST -d 'Buy cat food' https://notes.example.com/api/hooks/<token>
  ```
  The token *is* the credential and is scoped to one target, so a leaked inbox
  token can't touch your tasks.

### Get your data out

| What | How |
|---|---|
| The whole instance | `docker compose exec app node dist/cli.js export /app/data/export` → `data.json` + `blobs/` |
| One space as Markdown | the **⤓** button next to the space — a zip of `.md` files mirroring the tree, images under `_attachments/`, links rewritten |
| One table | **Export CSV** in the table view |
| A whole database | **Export zip** — one CSV per table |
| Import back | `cli import <dir>` into an **empty** database (it refuses otherwise), or `cli import:markdown <dir> <space-name> <owner-email>` to build a space from a folder of Markdown |

Exports deliberately exclude sessions and password-reset tokens. Everything else
— passwords, 2FA, page trees, tasks, reminders, files — survives, including
across storage drivers and across SQLite ↔ Postgres.

### Back up and restore

**SQLite:** everything is in the data volume — the `.db` file (plus its `-wal`
and `-shm` siblings), `uploads/`, and `secrets.key`. Stop the app and copy the
directory, or take a hot copy with `sqlite3 beyond.db ".backup backup.db"`.
Restore = put it back and start.

**Postgres:**

```bash
docker compose exec postgres pg_dump -U beyond beyond_notes > backup.sql
```

…plus a copy of the app's data volume (uploads and `secrets.key` are *not* in
Postgres unless you selected database storage). Restore into a fresh instance:
start Postgres, `psql < backup.sql`, restore the volume, start the app.

> **Test the restore once before trusting it.** A backup that has never been
> restored is a hope, not a backup.

### Upgrade to a new version

```bash
docker compose pull
docker compose up -d
```

Migrations run on boot, forward-only and additive, so an older database against
a newer image is the supported path. Take a backup first anyway. Pinning
`:v0.8.0` instead of `:latest` means upgrades happen when *you* decide.

---

## Troubleshooting

**"Cannot reach the server" / the page loads but nothing works.**
The API isn't answering. `docker compose logs -f app` and look for a migration
or database error. Check `GET /healthz` — it returns `{"ok":true,"dialect":…}`
and tells you which engine it actually opened.

**I get the "create admin account" page and my content is gone.**
Nothing is lost — you're connected to a *different* database. The usual causes
are a missing volume mount, or `DATABASE_URL` unset so the app fell back to the
default `./data/beyond.db`. Fix the path, restart, and your login returns. Don't
create the account first.

**`ECONNREFUSED` connecting to something that is clearly running.**
On many systems `localhost` resolves to IPv6 `::1` while Docker publishes on
IPv4 only. Use `127.0.0.1`.

**Login cookie doesn't stick behind HTTPS.**
`BASE_URL` must be the real external `https://…` URL. It's what decides whether
cookies are marked secure.

**A published page 404s.**
Three things must all be true: the space has public access enabled, the page has
a live published version, and **every ancestor is also live**. An unpublished
parent hides its whole subtree — that's the safety rule, not a bug.

**My form or table embed shows nothing on the published page.**
The database must be **shared**, not personal — public output never includes
anything from a personal space. Also check the id in the token, and that you
published the page *after* adding it.

**Postgres password changes did nothing / the app can't connect.**
The Postgres image only reads `POSTGRES_PASSWORD` when it first initialises its
data directory. Change it with `ALTER USER` inside the database, then update
`DATABASE_URL`.

**Notification / invite emails aren't sending.**
Email-dependent features hide themselves until SMTP is configured. Check
Settings → Notifications; remember that a filled-in in-app SMTP group overrides
the environment variables.

**`docker pull` says "denied" or "not found".**
The package is private — `docker login ghcr.io` with a PAT carrying
`read:packages`, or make the package public (see [Quick start](#quick-start)).

**Uploads fail after switching storage drivers.**
Switching the driver doesn't move existing files. Run
`cli blobs:migrate <from> <to>` (`fs`, `s3` or `db`); it's idempotent.

---

## Development

Requires Node 20+ and pnpm 9 (via corepack).

```bash
pnpm install
pnpm --filter @bn/server dev     # API on :3800, SQLite at data/beyond.db
pnpm --filter @bn/web dev        # Vite on :5173, proxies /api to :3800
pnpm test                        # SQLite always; set TEST_PG_URL for the pg run
pnpm typecheck && pnpm lint
```

Production-style run: `pnpm build`, then from `apps/server`:
`WEB_DIST=../web/dist node dist/index.js`. Reset a dev instance by deleting
`apps/server/data/`.

The workspace: `apps/server` (Fastify + tRPC + Drizzle + publish pipeline +
scheduler), `apps/web` (React SPA), `packages/schema` (Drizzle tables + Zod
DTOs, dual-dialect), `packages/renderer` (pure ProseMirror-JSON → HTML).

- [`TECH-PLAN.md`](TECH-PLAN.md) — the architecture and every decision, argued
- [`ROADMAP.md`](ROADMAP.md) — what shipped and what's next
- [`DESIGN-NOTES.md`](DESIGN-NOTES.md) — the product model and the settled
  product decisions behind it
