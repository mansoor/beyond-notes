import { afterEach, describe, expect, it } from 'vitest'
import { type AccessService, createAccess } from './access'
import { createAuthService, newUserRow } from './auth'
import { createDailyService } from './daily'
import { type AppDb, createDb } from './db'
import { PagesError, createPagesService } from './pages'
import { createPublishingService } from './publishing'
import { type UserRow, createRepo } from './repo'
import { createTasksService } from './tasks'

const doc = (text: string) =>
  JSON.stringify([
    {
      id: 'b1',
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    },
  ])

describe('space sharing (access.ts)', () => {
  let appDb: AppDb

  afterEach(async () => {
    await appDb?.close()
  })

  async function setup() {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const repo = createRepo(appDb)
    const access: AccessService = createAccess(repo)
    const pages = createPagesService(repo, { access })
    const tasks = createTasksService(repo, { access })
    const daily = createDailyService(repo, { access })
    const publishing = createPublishingService(repo, { access })
    const { user: owner } = await createAuthService(repo).setup({
      name: 'Owner',
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    const person = async (id: string): Promise<UserRow> => {
      const u = newUserRow({
        id,
        email: `${id}@home.lan`,
        name: id,
        passwordHash: 'x',
        role: 'member',
        createdAt: new Date(),
      })
      await repo.insertUser(u)
      return u
    }
    const ana = await person('ana')
    const ben = await person('ben')
    const space = await pages.createSpace(owner, {
      name: 'Recipes',
      category: 'notebook',
      personal: true,
    })
    const page = await pages.createPage(owner, {
      spaceId: space.id,
      parentId: null,
      title: 'Bread',
    })
    const { doc: d } = await pages.getPage(owner, page.id)
    await pages.saveDocument(owner, {
      pageId: page.id,
      content: doc('Flour, water, salt'),
      baseUpdatedAt: d.updatedAt.toISOString(),
    })
    return { repo, access, pages, tasks, daily, publishing, owner, ana, ben, space, page }
  }

  const code = async (p: Promise<unknown>) => {
    try {
      await p
      return 'ok'
    } catch (err) {
      return err instanceof PagesError ? err.code : String(err)
    }
  }

  it('keeps a personal space to its owner until it is shared', async () => {
    const { pages, ana, space, page } = await setup()
    expect((await pages.listSpaces(ana)).map((s) => s.id)).not.toContain(space.id)
    expect(await code(pages.getPage(ana, page.id))).toBe('NOT_FOUND')
    expect(await code(pages.tree(ana, space.id))).toBe('NOT_FOUND')
  })

  it('lets a viewer read but not change anything', async () => {
    const { access, pages, tasks, ana, space, page } = await setup()
    await access.share({ space, principalType: 'user', principalId: ana.id, role: 'viewer' })

    expect((await pages.listSpaces(ana)).map((s) => s.id)).toContain(space.id)
    expect(await access.role(space, ana)).toBe('viewer')
    expect((await pages.tree(ana, space.id)).map((p) => p.id)).toContain(page.id)
    expect(await code(pages.getPage(ana, page.id))).toBe('ok')

    expect(
      await code(pages.createPage(ana, { spaceId: space.id, parentId: null, title: 'x' })),
    ).toBe('FORBIDDEN')
    expect(
      await code(
        pages.saveDocument(ana, { pageId: page.id, content: doc('mine now'), baseUpdatedAt: '' }),
      ),
    ).toBe('FORBIDDEN')
    expect(await code(pages.renamePage(ana, page.id, 'Cake'))).toBe('FORBIDDEN')
    expect(await code(pages.trashPage(ana, page.id))).toBe('FORBIDDEN')
    expect(await code(pages.checkPage(ana, page.id, 'write'))).toBe('FORBIDDEN')
    expect(await code(pages.renameSpace(ana, space.id, 'Mine'))).toBe('FORBIDDEN')
    // nothing to act on in trash, archive or the agenda
    expect(await pages.listTrashed(ana)).toEqual([])
    expect((await tasks.agenda(ana)).length).toBe(0)
  })

  it('lets an editor change pages but not the space itself', async () => {
    const { access, pages, publishing, ana, space, page } = await setup()
    await access.share({ space, principalType: 'user', principalId: ana.id, role: 'editor' })

    const { doc: d } = await pages.getPage(ana, page.id)
    await pages.saveDocument(ana, {
      pageId: page.id,
      content: doc('Flour, water, salt, yeast'),
      baseUpdatedAt: d.updatedAt.toISOString(),
    })
    const added = await pages.createPage(ana, { spaceId: space.id, parentId: null, title: 'Cake' })
    expect(added.spaceId).toBe(space.id)
    expect(await code(publishing.publish(ana, page.id))).not.toBe('NOT_FOUND')

    expect(await code(pages.renameSpace(ana, space.id, 'Mine'))).toBe('FORBIDDEN')
    expect(await code(pages.deleteSpace(ana, space.id))).toBe('FORBIDDEN')
    expect(
      await code(
        publishing.updateSpacePublishing(ana, {
          spaceId: space.id,
          enabled: true,
          host: 'recipes.example.test',
          title: null,
          footer: null,
          theme: 'paper',
        }),
      ),
    ).toBe('NOT_FOUND')
  })

  it("won't move a page into a space you can only read", async () => {
    const { access, pages, owner, ana, space } = await setup()
    await access.share({ space, principalType: 'user', principalId: ana.id, role: 'viewer' })
    const mine = await pages.createSpace(ana, { name: 'Ana', category: 'notebook', personal: true })
    const note = await pages.createPage(ana, { spaceId: mine.id, parentId: null, title: 'Note' })
    expect(
      await code(
        pages.movePage(ana, { pageId: note.id, parentId: null, index: 0, spaceId: space.id }),
      ),
    ).toBe('NOT_FOUND')
    // the owner, who can write there, can still move their own pages in
    const own = await pages.createSpace(owner, {
      name: 'Drafts',
      category: 'notebook',
      personal: true,
    })
    const draft = await pages.createPage(owner, { spaceId: own.id, parentId: null, title: 'D' })
    expect(
      await code(
        pages.movePage(owner, { pageId: draft.id, parentId: null, index: 0, spaceId: space.id }),
      ),
    ).toBe('ok')
  })

  it('shares through groups, and takes access back with the group', async () => {
    const { access, pages, ana, ben, space, page } = await setup()
    const family = await access.createGroup('Family')
    await access.setGroupMember(family.id, ana.id, true)
    await access.share({ space, principalType: 'group', principalId: family.id, role: 'editor' })
    expect(await access.role(space, ana)).toBe('editor')
    expect(await code(pages.getPage(ben, page.id))).toBe('NOT_FOUND')

    // the best of a direct share and a group share wins
    await access.share({ space, principalType: 'user', principalId: ana.id, role: 'viewer' })
    expect(await access.role(space, ana)).toBe('editor')

    await access.setGroupMember(family.id, ana.id, false)
    expect(await access.role(space, ana)).toBe('viewer')
    await access.unshare(space.id, 'user', ana.id)
    expect(await access.role(space, ana)).toBeNull()

    await access.setGroupMember(family.id, ben.id, true)
    expect(await access.role(space, ben)).toBe('editor')
    await access.deleteGroup(family.id)
    expect(await access.role(space, ben)).toBeNull()
    expect(await access.shares(space.id)).toEqual([])
  })

  it('never shares journals or spaces that are already everyone’s', async () => {
    const { access, pages, daily, repo, owner, ana } = await setup()
    await daily.day(owner, '2026-10-03')
    const journal = (await repo.listSpaces()).find(
      (s) => s.kind === 'journal' && s.ownerId === owner.id,
    )
    expect(journal).toBeDefined()
    await expect(
      access.share({
        space: journal as never,
        principalType: 'user',
        principalId: ana.id,
        role: 'viewer',
      }),
    ).rejects.toThrow(/journal/)
    const team = await pages.createSpace(owner, { name: 'Team', category: 'wiki', personal: false })
    await expect(
      access.share({ space: team, principalType: 'user', principalId: ana.id, role: 'viewer' }),
    ).rejects.toThrow(/already open/)
    // and a shared space is still fully everyone's
    expect(await access.role(team, ana)).toBe('owner')
  })

  it('refuses shares with people or groups that do not exist', async () => {
    const { access, space, owner } = await setup()
    await expect(
      access.share({ space, principalType: 'user', principalId: 'ghost', role: 'viewer' }),
    ).rejects.toThrow(/No such person/)
    await expect(
      access.share({ space, principalType: 'group', principalId: 'ghost', role: 'viewer' }),
    ).rejects.toThrow(/No such group/)
    await expect(
      access.share({ space, principalType: 'user', principalId: owner.id, role: 'viewer' }),
    ).rejects.toThrow(/already owns/)
  })
})
