/**
 * First run: a small personal notebook that shows how Beyond Notes works by
 * being an example of it, with real links between its pages, a checklist that
 * lands in Tasks, a #tag, a diagram, plus a first line in today's Journal.
 *
 * It goes through the importer's apply step, so it is built exactly the way
 * imported content is (and links resolve to the pages it creates).
 */
import type { ImportNodePlan, ImportResultView } from '@bn/schema'
import type { DailyService } from './daily'
import type { PagesService } from './pages'
import type { PublishingService } from './publishing'
import type { Repo, UserRow } from './repo'
import { applyImportPlan } from './wikiimport'

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function starterPages(now: Date): ImportNodePlan[] {
  const tomorrow = dateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))
  const page = (key: string, title: string, markdown: string, level = 0): ImportNodePlan => ({
    key,
    title,
    level,
    kind: 'file',
    markdown,
    excerpt: '',
  })
  return [
    page(
      'welcome',
      'Welcome',
      `This notebook is yours to read, change or delete. It's here to show how things fit together.

## Where things live

- **Today** is your daily page: jot anything, it's filed under the date. Past days are in **Journal**.
- **Inbox** catches quick thoughts and links to sort later.
- **Tasks** gathers every checklist item from every page, with due dates.
- **Notebooks** hold your own pages, **wikis** are for shared knowledge, **sites** publish a space as a website, and **databases** are tables you can sort and filter.

Press **Ctrl K** (⌘K on a Mac) to search everything.

## Next

- [Writing](bn-page:writing): formatting, links, tags and tasks
- [Capturing](bn-page:capture): getting things in from anywhere
- [Publishing](bn-page:publish): turning a space into a website
- [Keeping it safe](bn-page:safe): backups and sign-in

#getting-started`,
    ),
    page(
      'writing',
      'Writing',
      `Type **/** for the block menu: headings, lists, checklists, tables, images, code and more. Markdown shortcuts work too: \`#\` for a heading, \`-\` for a list, \`[]\` for a checklist.

## Link your notes

Link to another page and it shows up there as a backlink, like this link back to [Welcome](bn-page:welcome). The space's knowledge graph (click the space name in the sidebar) draws these connections.

## Tags

Write a word with **#** in front, like #idea, and the page appears under Tags.

## Tasks

A checklist item becomes a task. Add a date with **@** to give it a due date:

- [ ] Open the Tasks page and tick this off @${tomorrow}
- [ ] Try making a page in this notebook

## Diagrams

A code block set to \`mermaid\` is drawn as a diagram:

\`\`\`mermaid
graph LR
  Inbox --> Notebook
  Notebook --> Website
\`\`\``,
    ),
    page(
      'capture',
      'Capturing',
      `Get things in wherever you are:

- **Phone:** install Beyond Notes to your home screen (About → Install), then share links and text straight into the Inbox.
- **Browser:** the web clipper saves the page you're reading, or just your selection. Find it under Settings → Integrations.
- **Other apps:** Settings → Integrations has webhooks that drop text into your Inbox, Today or Tasks.
- **AI assistants:** make an API token in Settings → Integrations and connect Claude or another assistant through the MCP server. It can then search your notes and save to them.
- **Other note apps:** bring notes over from Notion, Obsidian, Evernote, Markdown or a GitHub repository. Choose **+ New space** and tick "Import content into it".`,
    ),
    page(
      'publish',
      'Publishing',
      `Any notebook or wiki can become a website. Make a **site** space (or open a space's ⋯ menu → Publishing), pick a theme and an address, and publish the pages you want public. Everything else stays private.

Pages are drafts until you publish them, and you can preview the whole site before anyone sees it.`,
    ),
    page(
      'safe',
      'Keeping it safe',
      `- **Backups:** an admin can schedule full backups under Settings → Backup, with an optional copy to S3, and restore a whole instance or one space at a time.
- **Sign-in:** turn on two-factor or add a passkey under Settings → Security. Admins can connect single sign-on (Authentik, Authelia, Keycloak, Google and others).
- **Locks:** a notebook or page can ask for your password before it opens.
- **Activity:** admins can see sign-ins and changes under Settings → Activity.`,
    ),
  ]
}

export async function createStarter(
  deps: {
    repo: Repo
    pages: PagesService
    publishing: PublishingService
    daily: DailyService
    now?: () => Date
  },
  user: UserRow,
): Promise<ImportResultView> {
  const now = deps.now ?? (() => new Date())
  const result = await applyImportPlan(
    { repo: deps.repo, pages: deps.pages, publishing: deps.publishing, now },
    user,
    {
      newSpaceName: 'Getting started',
      category: 'notebook',
      personal: true,
      publish: false,
      archiveExisting: false,
      importImages: false,
      imageBase: null,
      nodes: starterPages(now()),
    },
  )
  await deps.daily.appendToDay(user, dateKey(now()), 'Started using Beyond Notes.')
  return result
}
