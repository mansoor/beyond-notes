# Roadmap

Staged so each release is one coherent theme, migrations are bundled, and later
stages build on earlier ones. Order of v0.5 vs v0.6 is swappable; everything
else has real dependencies.

## v0.2.0 — cut what's on develop (no new work)

Everything since v0.1.1: settings-in-app (SMTP/ntfy/storage + encryption),
webhooks, tags, archive, gallery layouts + lightbox + autoplay, site branding
(logo/tagline/header styles/socials), covers, share bars, site + wiki search,
hierarchical nav, day topic notes, profile/password-reset, modal fix, tabbed
publishing dialog, section-scoped page types, wiki sidebar resize + prev/next.
Release whenever testing feels done.

## v0.3.0 — The context rail (workspace restructure)

The WordPress-post model: context always visible on the right, saved with the
page. Builds the shelf that later features (backlinks, SEO, scheduling) sit on.

1. **Permanent right rail** (~300px) in the editor: publish status, page type,
   tags, and the per-type settings that today hide behind the ⚙ gear —
   share toggle + listing image (site pages), layout + autoplay + cover note
   (galleries). Gear goes away; below ~1100px the rail collapses back into a
   gear-opened drawer so laptops aren't cramped.
2. **Explicit tags in the rail.** Chip input; stored in `page_tags` alongside
   inline-detected `#tags` (new `source` column: `manual` | `inline`).
   Reconcile-on-save keeps manual tags, refreshes inline ones. Inline #tags
   keep working everywhere — the rail shows both, detected ones marked.
3. **Today keeps its calendar** in the same rail slot — one layout everywhere.
4. **Inbox + Tasks widen** to match the app (`max-w-5xl`); their capture stays
   inline/simple by design.
5. Small shell wins while we're in there: **pinned favorites** section in the
   left sidebar, **recently edited** on Today.

Migration: `page_tags.source`.

## v0.4.0 — Links & safety (shared core)

The features every section shares. Redirects land here, *before* the website
push amplifies public URLs.

1. **`[[` page-link autocomplete** in the editor; `page_links` index
   reconciled on save (same pattern as tags/tasks).
2. **Backlinks panel** in the context rail ("Linked from") — first proof the
   rail was worth building.
3. **Slug redirects**: `page_slugs` history table; renamed published pages
   301 from every old path (wiki + site).
4. **Trash**: delete moves to trash, restore any time, auto-purge after 30
   days; permanent delete only from inside Trash. (Archive stays: archive is
   "done with this", trash is "get rid of this".)
5. **Version diff** in the History dialog.
6. **Duplicate page** + **templates** (save page as template, new-from-template).

Migrations: `page_links`, `page_slugs`, trash fields.

## v0.5.0 — Website reach

Everything that makes shared links and readers work harder for the site.

1. **OG/SEO meta**: `og:title/description/image` (reuse covers), meta
   description field in the context rail for site pages.
2. **Public tag pages** (`/tags/<tag>`) + tags shown on post listings.
3. **Blog pagination.**
4. **Draft preview links** — tokened URL serving the working copy, revocable,
   never in nav.
5. **Scheduled publishing** (`publishAt` on a version).
6. **Favicon** derived from the site logo; **robots.txt**.

## v0.6.0 — Wiki reading experience

Almost all renderer work; no migrations expected.

1. **"On this page" TOC** rail on published docs (from headings).
2. **Heading anchors** + hover copy-link.
3. **Last-updated stamp** on published pages; stale-pages view in the app.
4. **Breadcrumbs** in the docs shell (site already has them).
5. **Code block copy button + syntax highlighting.**
6. **Collapsible nav** with auto-expanded active trail.
7. **"Edit this page"** link for logged-in visitors.

## v0.7.0 — Capture & mobile

1. **PWA manifest + share target** → phone share sheet sends to Inbox.
2. **Journal calendar month view** (rides the Today rail).
3. **Bookmarklet** for desktop quick capture.

## Standing decisions

- Sections are different products on one skeleton: wiki = docs-only,
  notebook = docs + galleries, site = full set. Enforced server-side.
- Share bars, SEO, branding are site-only concepts.
- Notebooks stay publishable (docs renderer) unless decided otherwise.
- No open-registration mode, ever.
