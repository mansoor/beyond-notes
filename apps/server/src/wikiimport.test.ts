import { type ImportNodePlan, foldMergedNodes } from '@bn/schema'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDb } from './db'
import { GithubError, parseRepoUrl, titleCase } from './github'
import { createPagesService } from './pages'
import { createPublishingService } from './publishing'
import { createRepo } from './repo'
import { ImportError, applyImportPlan, planFromGithub, planFromMarkdown } from './wikiimport'

/** Narrow away `null`/`undefined` from a lookup without a non-null assertion. */
function req<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('expected a value')
  return x
}

const README = `# Demo Project

An intro paragraph.

## Table of contents

1. [Setup](#setup)

## Setup

Install it.

### Windows

Use the installer.

## Usage

Run it.
`

describe('parseRepoUrl', () => {
  it('accepts the shapes people actually paste', () => {
    expect(parseRepoUrl('https://github.com/owner/repo')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
      ref: null,
    })
    expect(parseRepoUrl('github.com/owner/repo.git')).toMatchObject({ owner: 'owner' })
    expect(parseRepoUrl('owner/repo')).toMatchObject({ owner: 'owner', repo: 'repo' })
    expect(parseRepoUrl('https://github.com/owner/repo/tree/develop')).toMatchObject({
      ref: 'develop',
    })
    expect(parseRepoUrl('https://github.com/o/r/blob/main/docs/x.md')).toMatchObject({
      ref: 'main',
      path: 'docs/x.md',
    })
  })

  it('refuses hosts that are not GitHub — this is the one URL the server fetches', () => {
    expect(() => parseRepoUrl('https://evil.test/owner/repo')).toThrow(GithubError)
    expect(() => parseRepoUrl('http://127.0.0.1:3800/admin')).toThrow(GithubError)
    expect(() => parseRepoUrl('')).toThrow(GithubError)
  })
})

/** A GitHub stub: the API for the branch and tree, raw for file contents. */
function fakeGithub(files: Record<string, string>, branch = 'main') {
  const tree = Object.keys(files).map((path) => ({ path, type: 'blob' }))
  return (async (url: string | URL) => {
    const href = String(url)
    const ok = (body: unknown) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
    if (href.endsWith('/repos/acme/widgets')) return ok({ default_branch: branch })
    if (href.includes('/git/trees/')) return ok({ tree, truncated: false })
    const raw = href.split(`/${branch}/`)[1]
    const content = raw ? files[decodeURIComponent(raw)] : undefined
    return content === undefined ? new Response('no', { status: 404 }) : ok(content)
  }) as unknown as typeof fetch
}

describe('planFromMarkdown', () => {
  it('proposes intro + sections and suggests a name from the H1', () => {
    const plan = planFromMarkdown(README, 'README.md')
    expect(plan.suggestedName).toBe('Demo Project')
    expect(plan.sourceLabel).toBe('README.md')
    expect(plan.nodes.map((n) => [n.title, n.level])).toEqual([
      ['Introduction', 0],
      ['Setup', 0],
      ['Windows', 1],
      ['Usage', 0],
    ])
  })

  it('refuses an empty document instead of creating an empty space', () => {
    expect(() => planFromMarkdown('   ')).toThrow(ImportError)
  })
})

describe('planFromGithub', () => {
  it('puts README sections first, docs/ next, and policy files at the bottom', async () => {
    const plan = await planFromGithub(
      { url: 'https://github.com/acme/widgets' },
      fakeGithub({
        'README.md': README,
        'CONTRIBUTING.md': '# Contributing\n\nBe nice.',
        'CODE_OF_CONDUCT.md': 'Be excellent.',
        'SECURITY.md': 'Report privately.',
        LICENSE: 'MIT License\n\nCopyright…',
        'docs/guides/install.md': '# Install\n\nSteps.',
        'src/index.ts': 'not markdown',
      }),
    )

    const titles = plan.nodes.map((n) => n.title)
    expect(titles.slice(0, 4)).toEqual(['Introduction', 'Setup', 'Windows', 'Usage'])
    expect(titles).toContain('Documentation')
    expect(titles.slice(-4)).toEqual(['Contributing', 'Code of Conduct', 'Security', 'License'])
    // every policy page sits at the top level, not nested under a section
    for (const title of ['Contributing', 'Security', 'License']) {
      expect(plan.nodes.find((n) => n.title === title)?.level).toBe(0)
    }
    expect(titles).not.toContain('Index')
    expect(plan.sourceLabel).toBe('github.com/acme/widgets @ main')
    expect(plan.suggestedName).toBe('Widgets')
  })

  it('spells acronyms in a name instead of "Ddns"', () => {
    expect(titleCase('cloudflare-ddns-plus')).toBe('Cloudflare DDNS Plus')
    expect(titleCase('my-api-sdk')).toBe('My API SDK')
    expect(titleCase('CODE_OF_CONDUCT')).toBe('Code of Conduct')
    expect(titleCase('beyond-notes')).toBe('Beyond Notes')
  })

  it('nests a docs/ folder under Documentation', async () => {
    const plan = await planFromGithub(
      { url: 'acme/widgets' },
      fakeGithub({ 'README.md': '# X\n\nhi', 'docs/guides/install.md': '# Install\n\nSteps.' }),
    )
    const levels = new Map(plan.nodes.map((n) => [n.title, n.level]))
    expect(levels.get('Documentation')).toBe(0)
    expect(levels.get('Guides')).toBe(1)
    expect(levels.get('Install')).toBe(2)
  })

  it('says so when there is no README rather than failing silently', async () => {
    const plan = await planFromGithub(
      { url: 'acme/widgets' },
      fakeGithub({ 'CONTRIBUTING.md': 'Be nice.' }),
    )
    expect(plan.warnings.join(' ')).toMatch(/No README/i)
    expect(plan.nodes).toHaveLength(1)
  })
})

describe('applyImportPlan', () => {
  const setup = async () => {
    const db = createDb('file::memory:')
    await db.migrate('./drizzle')
    const repo = createRepo(db)
    const auth = createAuthService(repo)
    const user = (await auth.setup({ email: 'a@b.test', password: 'password123', name: 'A' })).user
    const pages = createPagesService(repo)
    const publishing = createPublishingService(repo)
    return { db, repo, pages, publishing, user }
  }

  it('creates the tree the plan described, with the right parents', async () => {
    const { repo, pages, publishing, user } = await setup()
    const plan = planFromMarkdown(README, 'README.md')

    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      newSpaceName: 'Demo',
      category: 'wiki',
      personal: false,
      publish: false,
      archiveExisting: false,
      importImages: false,
      imageBase: null,
      nodes: plan.nodes,
    })

    expect(result.pages).toBe(4)
    expect(result.published).toBe(0)
    const created = await repo.listPagesInSpace(result.spaceId)
    const byTitle = new Map(created.map((p) => [p.title, p]))
    expect(req(byTitle.get('Windows')).parentId).toBe(req(byTitle.get('Setup')).id)
    expect(req(byTitle.get('Usage')).parentId).toBeNull()
    // drafts by default: nothing is live
    expect(created.every((p) => p.liveVersionId === null)).toBe(true)
  })

  it('writes the section body as blocks, not as a wall of text', async () => {
    const { repo, pages, publishing, user } = await setup()
    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      newSpaceName: 'Demo',
      category: 'wiki',
      personal: false,
      publish: false,
      archiveExisting: false,
      importImages: false,
      imageBase: null,
      nodes: planFromMarkdown('# T\n\n## A\n\ntext\n\n- one\n- two', 'r.md').nodes,
    })
    const page = (await repo.listPagesInSpace(result.spaceId)).find((p) => p.title === 'A')
    const doc = await repo.getDocument(req(page).id)
    const blocks = JSON.parse(req(doc).content) as Array<{ type: string }>
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'bulletListItem', 'bulletListItem'])
  })

  it('rewrites an in-document anchor to the page that section became', async () => {
    const { repo, pages, publishing, user } = await setup()
    const md = '# T\n\nSee [Setup](#setup) first.\n\n## Setup\n\nInstall.'
    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      newSpaceName: 'Demo',
      category: 'wiki',
      personal: false,
      publish: false,
      archiveExisting: false,
      importImages: false,
      imageBase: null,
      nodes: planFromMarkdown(md, 'r.md').nodes,
    })
    const all = await repo.listPagesInSpace(result.spaceId)
    const intro = req(all.find((p) => p.title === 'Introduction'))
    const setupPage = req(all.find((p) => p.title === 'Setup'))
    const doc = req(await repo.getDocument(intro.id))
    expect(doc.content).toContain(`/p/${setupPage.id}`)
    expect(doc.content).not.toContain('#setup')
  })

  it('publishes every page when asked', async () => {
    const { repo, pages, publishing, user } = await setup()
    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      newSpaceName: 'Demo',
      category: 'wiki',
      personal: false,
      publish: true,
      archiveExisting: false,
      importImages: false,
      imageBase: null,
      nodes: planFromMarkdown(README, 'README.md').nodes,
    })
    expect(result.published).toBe(4)
    const created = await repo.listPagesInSpace(result.spaceId)
    expect(created.every((p) => p.liveVersionId !== null)).toBe(true)
  })

  it('imports into an existing space when one is chosen', async () => {
    const { repo, pages, publishing, user } = await setup()
    const space = await pages.createSpace(user, {
      name: 'Existing',
      category: 'wiki',
      personal: false,
    })
    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      spaceId: space.id,
      category: 'wiki',
      personal: false,
      publish: false,
      archiveExisting: false,
      importImages: false,
      imageBase: null,
      nodes: planFromMarkdown('# T\n\n## A\n\nx', 'r.md').nodes,
    })
    expect(result.spaceId).toBe(space.id)
    expect(await repo.listPagesInSpace(space.id)).toHaveLength(1)
  })

  it('archives what the target space already held, when asked', async () => {
    const { repo, pages, publishing, user } = await setup()
    const space = await pages.createSpace(user, {
      name: 'Docs',
      category: 'wiki',
      personal: false,
    })
    const old = await pages.createPage(user, {
      spaceId: space.id,
      parentId: null,
      title: 'Old page',
    })
    const oldChild = await pages.createPage(user, {
      spaceId: space.id,
      parentId: old.id,
      title: 'Old child',
    })

    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      spaceId: space.id,
      category: 'wiki',
      personal: false,
      publish: false,
      archiveExisting: true,
      importImages: false,
      imageBase: null,
      nodes: planFromMarkdown('# T\n\n## Fresh\n\nnew', 'r.md').nodes,
    })

    expect(result.archived).toBe(1) // one root — its subtree goes with it
    const after = await repo.listPagesInSpace(space.id)
    expect(req(after.find((p) => p.id === old.id)).archivedAt).not.toBeNull()
    expect(req(after.find((p) => p.id === oldChild.id)).archivedAt).not.toBeNull()
    // the newly imported page is live in the sidebar, not archived
    expect(req(after.find((p) => p.title === 'Fresh')).archivedAt).toBeNull()
  })

  it('never archives when creating a new space — there is nothing to lose', async () => {
    const { repo, pages, publishing, user } = await setup()
    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      newSpaceName: 'Fresh wiki',
      category: 'wiki',
      personal: false,
      publish: false,
      archiveExisting: true,
      importImages: false,
      imageBase: null,
      nodes: planFromMarkdown('# T\n\n## A\n\nx', 'r.md').nodes,
    })
    expect(result.archived).toBe(0)
  })

  it('repairs an impossible nesting jump instead of orphaning a page', async () => {
    const { repo, pages, publishing, user } = await setup()
    const result = await applyImportPlan({ repo, pages, publishing }, user, {
      newSpaceName: 'Demo',
      category: 'wiki',
      personal: false,
      publish: false,
      archiveExisting: false,
      importImages: false,
      imageBase: null,
      nodes: [
        { key: 'a', title: 'A', level: 0, kind: 'section', markdown: 'a', excerpt: '' },
        { key: 'b', title: 'B', level: 5, kind: 'section', markdown: 'b', excerpt: '' },
      ],
    })
    const all = await repo.listPagesInSpace(result.spaceId)
    const a = req(all.find((p) => p.title === 'A'))
    expect(req(all.find((p) => p.title === 'B')).parentId).toBe(a.id)
  })
})

describe('foldMergedNodes (pure)', () => {
  const node = (key: string, title: string, markdown: string, level = 0): ImportNodePlan => ({
    key,
    title,
    level,
    kind: 'section',
    markdown,
    excerpt: '',
  })
  const nodes = [
    node('a', 'License', 'MIT.'),
    node('b', 'License', 'Full licence text.'),
    node('c', 'Usage', 'Run it.'),
  ]

  it('appends a merged page under its own heading, and drops the row', () => {
    const out = foldMergedNodes(nodes, { b: 'a' })
    expect(out.map((n) => n.key)).toEqual(['a', 'c'])
    expect(out[0]?.markdown).toBe('MIT.\n\n## License\n\nFull licence text.')
  })

  it('follows a chain: merged into something itself merged', () => {
    const out = foldMergedNodes(nodes, { c: 'b', b: 'a' })
    expect(out.map((n) => n.key)).toEqual(['a'])
    expect(out[0]?.markdown).toContain('Full licence text.')
    expect(out[0]?.markdown).toContain('Run it.')
  })

  it('leaves an unmerged plan untouched', () => {
    expect(foldMergedNodes(nodes, {})).toEqual(nodes)
  })

  it('survives a merge into a row that is no longer there', () => {
    expect(foldMergedNodes([nodes[1] as ImportNodePlan], { b: 'gone' })).toEqual([])
  })
})
