import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'

const docOf = (text: string) =>
  JSON.stringify([
    { id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] },
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
  const space = await pages.createSpace(user, { name: 'Notes', category: 'notebook', personal: false })

  const write = async (title: string, body: string) => {
    const page = await pages.createPage(user, { spaceId: space.id, parentId: null, title })
    const doc = await repo.getDocument(page.id)
    await pages.saveDocument(user, {
      pageId: page.id,
      content: docOf(body),
      baseUpdatedAt: (doc as { updatedAt: Date }).updatedAt.toISOString(),
    })
    return page
  }

  return { repo, pages, user, space, write }
}

describe('pages.spaceGraph', () => {
  it('links two pages through a concept they both mention', async () => {
    const { pages, user, space, write } = await setup()
    await write('Backups', 'Docker volume backups run nightly.')
    await write('Restore', 'Restoring a Docker volume from a backup.')

    const g = await pages.spaceGraph(user, space.id)
    const concepts = g.nodes.filter((n) => n.kind === 'concept').map((n) => n.label)
    expect(concepts).toContain('docker')
    expect(g.edges.length).toBeGreaterThan(0)
  })

  it('excludes a locked page so its words never reach the graph', async () => {
    const { pages, user, space, write } = await setup()
    await write('Public', 'Docker volume backups.')
    const secret = await write('Secret', 'Docker volume backups and passwords.')

    // with the secret page hidden (as a lock would), the only remaining page has
    // no partner to share a concept with — so there are no concept nodes at all
    const g = await pages.spaceGraph(user, space.id, { excludePageIds: new Set([secret.id]) })
    expect(g.pageCount).toBe(1)
    expect(g.nodes.filter((n) => n.kind === 'concept')).toHaveLength(0)
    expect(g.nodes.some((n) => n.id === secret.id)).toBe(false)
  })
})
