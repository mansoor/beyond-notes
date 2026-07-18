# Beyond Notes

One block-page primitive, five surfaces. Notes that go beyond the note: they
organize your day, hold your tasks, and publish to the web.

**Status:** concept. `mockup.html` is the UI direction — open it in a browser.

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

## Open questions

- Single-user or household/multi-user (decide before the schema exists)
- Mobile capture (PWA + share target?) — the inbox lives or dies on this
- Editor foundation (TipTap/ProseMirror is the leading candidate)
- Hosting shape for the public renders (static snapshot serving)
