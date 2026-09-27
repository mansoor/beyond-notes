import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDailyService } from './daily'
import { createDb } from './db'
import { createStarter } from './onboarding'
import { createPagesService } from './pages'
import { createPublishingService } from './publishing'
import { createRepo } from './repo'
import { createTasksService } from './tasks'

describe('first-run starter notebook', () => {
  it('makes a personal notebook with working links, a dated task, a tag and a journal line', async () => {
    const appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    const repo = createRepo(appDb)
    const auth = createAuthService(repo)
    const { user } = await auth.setup({
      name: 'New',
      email: 'new@x.dev',
      password: 'longpassword1',
    })
    const now = new Date(2026, 8, 27, 10, 0, 0)
    const pages = createPagesService(repo)
    const daily = createDailyService(repo, { now: () => now })

    const result = await createStarter(
      { repo, pages, publishing: createPublishingService(repo), daily, now: () => now },
      user,
    )
    expect(result.pages).toBe(5)

    const space = await repo.getSpace(result.spaceId)
    expect(space).toMatchObject({ name: 'Getting started', category: 'notebook', ownerId: user.id })

    const tree = await pages.tree(user, result.spaceId)
    const byTitle = new Map(tree.map((p) => [p.title, p.id]))
    const welcome = await repo.getDocument(byTitle.get('Welcome') ?? '')
    // placeholders became real links, and none were left behind
    expect(welcome?.content).toContain(`/p/${byTitle.get('Writing')}`)
    expect(welcome?.content).not.toContain('bn-page:')

    const tasks = await createTasksService(repo).agenda(user)
    expect(tasks.map((t) => t.task.due)).toContain('2026-09-28')
    const tags = await repo.listPageTags(byTitle.get('Welcome') ?? '')
    expect(tags.map((t) => t.tag)).toContain('getting-started')

    const day = await daily.day(user, '2026-09-27')
    expect(day.doc.content).toContain('Started using Beyond Notes.')
    await appDb.close()
  })
})
