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

## Open questions

- Single-user or household/multi-user (decide before the schema exists)
- Mobile capture (PWA + share target?) — the inbox lives or dies on this
- Editor foundation (TipTap/ProseMirror is the leading candidate)
- Hosting shape for the public renders (static snapshot serving)
