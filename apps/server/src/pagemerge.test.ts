import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'

const doc = (text: string) =>
  JSON.stringify([
    {
      id: text,
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    },
  ])

async function setup() {
  const db = createDb('file::memory:')
  await db.migrate('./drizzle')
  const repo = createRepo(db)
  const pages = createPagesService(repo)
  const { user } = await createAuthService(repo).setup({
    name: 'M',
    email: 'm@x.dev',
    password: 'longpassword1',
  })
  const space = await pages.createSpace(user, { name: 'W', category: 'wiki', personal: false })
  const write = async (id: string, text: string) => {
    const d = await repo.getDocument(id)
    await pages.saveDocument(user, {
      pageId: id,
      content: doc(text),
      baseUpdatedAt: (d?.updatedAt ?? new Date()).toISOString(),
    })
  }
  return { repo, pages, user, space, write }
}

describe('pages.mergePages (sqlite)', () => {
  it('folds source content into target, re-homes its children, trashes the source', async () => {
    const { repo, pages, user, space, write } = await setup()
    const a = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'Alpha' })
    const b = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'Beta' })
    const bChild = await pages.createPage(user, {
      spaceId: space.id,
      parentId: b.id,
      title: 'Beta kid',
    })
    await write(a.id, 'alpha body')
    await write(b.id, 'beta body')

    await pages.mergePages(user, { sourceId: b.id, targetId: a.id })

    // A now carries both bodies and Beta's title as a heading
    const merged = (await repo.getDocument(a.id))?.content ?? ''
    expect(merged).toContain('alpha body')
    expect(merged).toContain('beta body')
    expect(merged).toContain('Beta') // the folded section keeps its title

    // the tree: Beta is gone, its child now hangs under Alpha
    const tree = await pages.tree(user, space.id)
    const ids = tree.map((p) => p.id)
    expect(ids).toContain(a.id)
    expect(ids).not.toContain(b.id) // trashed → out of the tree
    const kid = tree.find((p) => p.id === bChild.id)
    expect(kid?.parentId).toBe(a.id)

    // Beta is recoverable in the Trash
    const trashed = await pages.listTrashed(user)
    expect(trashed.some((t) => t.page.id === b.id)).toBe(true)
  })

  it('refuses to merge a page into its own sub-page', async () => {
    const { pages, user, space } = await setup()
    const parent = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'P' })
    const child = await pages.createPage(user, {
      spaceId: space.id,
      parentId: parent.id,
      title: 'C',
    })
    await expect(
      pages.mergePages(user, { sourceId: parent.id, targetId: child.id }),
    ).rejects.toThrow()
  })

  it('refuses to merge a page into itself', async () => {
    const { pages, user, space } = await setup()
    const p = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'P' })
    await expect(pages.mergePages(user, { sourceId: p.id, targetId: p.id })).rejects.toThrow()
  })
})
