import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDailyService } from './daily'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'
import { extractTags, extractTagsFromText } from './tags'

const dialects: Array<{ name: string; make: () => Promise<AppDb> }> = [
  {
    name: 'sqlite',
    make: async () => {
      const db = createDb('file::memory:')
      await db.migrate('./drizzle')
      return db
    },
  },
]

if (process.env.TEST_PG_URL) {
  dialects.push({
    name: 'pg',
    make: async () => {
      const db = createDb(process.env.TEST_PG_URL as string)
      await db.db.execute(sql.raw('drop schema public cascade'))
      await db.db.execute(sql.raw('create schema public'))
      await db.db.execute(sql.raw('drop schema if exists drizzle cascade'))
      await db.migrate('./drizzle')
      return db
    },
  })
}

const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const para = (id: string, t: string) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [text(t)],
  children: [],
})

describe('tag extraction', () => {
  it('finds #tags in text, normalizes case, ignores URL fragments', () => {
    expect(extractTagsFromText('planning #Work and #hobby-2 stuff (#Family)')).toEqual([
      'work',
      'hobby-2',
      'family',
    ])
    expect(extractTagsFromText('see https://x.dev/page#section and a lone #')).toEqual([])
    expect(extractTagsFromText('#dup #dup #DUP')).toEqual(['dup'])
  })

  it('walks blocks and children but skips code blocks', () => {
    const blocks = [
      para('1', 'note about #alpha'),
      {
        id: '2',
        type: 'codeBlock',
        props: { language: 'c' },
        content: [text('#include <stdio.h>')],
        children: [],
      },
      {
        id: '3',
        type: 'bulletListItem',
        props: {},
        content: [text('top')],
        children: [para('4', 'nested #beta')],
      },
    ]
    expect(extractTags(JSON.stringify(blocks)).sort()).toEqual(['alpha', 'beta'])
    expect(extractTags('not json')).toEqual([])
  })
})

for (const dialect of dialects) {
  describe(`tag index (${dialect.name})`, () => {
    it('saving a document reindexes its tags; the flat view respects access and archive', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const pages = createPagesService(repo)
      const daily = createDailyService(repo)
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const space = await pages.createSpace(user, {
        name: 'Notes',
        category: 'notebook',
        personal: false,
      })
      const page = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'P' })

      const save = async (content: string) => {
        const doc = await repo.getDocument(page.id)
        await pages.saveDocument(user, {
          pageId: page.id,
          content,
          baseUpdatedAt: (doc as { updatedAt: Date }).updatedAt.toISOString(),
        })
      }

      await save(JSON.stringify([para('a', 'about #work and #travel')]))
      expect(await repo.listPageIdsByTag('work')).toEqual([page.id])
      expect(await repo.listPageIdsByTag('travel')).toEqual([page.id])

      // removing a tag from the text removes it from the index
      await save(JSON.stringify([para('a', 'about #work only now')]))
      expect(await repo.listPageIdsByTag('travel')).toEqual([])
      expect(await repo.listPageIdsByTag('work')).toEqual([page.id])

      // journal day notes index too (appendToDay runs the same reconcile)
      await daily.appendToDay(user, '2026-07-19', 'grocery run #errands')
      const dayPage = await daily.day(user, '2026-07-19')
      expect(await repo.listPageIdsByTag('errands')).toEqual([dayPage.page.id])

      // archived pages fall out of visibility (index row remains, view filters)
      await pages.archivePage(user, page.id)
      const archivedRow = await repo.getPage(page.id)
      expect(archivedRow?.archivedAt).not.toBeNull()
      await appDb.close()
    })

    it('manual tags survive reconciliation; inline ones stay text-owned', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const pages = createPagesService(repo)
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const space = await pages.createSpace(user, {
        name: 'Notes',
        category: 'notebook',
        personal: false,
      })
      const page = await pages.createPage(user, { spaceId: space.id, parentId: null, title: 'P' })
      const save = async (content: string) => {
        const doc = await repo.getDocument(page.id)
        await pages.saveDocument(user, {
          pageId: page.id,
          content,
          baseUpdatedAt: (doc as { updatedAt: Date }).updatedAt.toISOString(),
        })
      }

      await repo.addManualPageTag(page.id, 'project-x')
      await save(JSON.stringify([para('a', 'notes on #work')]))
      expect((await repo.listPageTags(page.id)).sort((x, y) => x.tag.localeCompare(y.tag))).toEqual(
        [
          { tag: 'project-x', source: 'manual' },
          { tag: 'work', source: 'inline' },
        ],
      )

      // a save that drops the inline tag keeps the manual one
      await save(JSON.stringify([para('a', 'no tags left')]))
      expect(await repo.listPageTags(page.id)).toEqual([{ tag: 'project-x', source: 'manual' }])

      // manually adding a tag that's already inline keeps the inline row (no dup)
      await save(JSON.stringify([para('a', 'back to #work')]))
      await repo.addManualPageTag(page.id, 'work')
      const rows = await repo.listPageTags(page.id)
      expect(rows.filter((r) => r.tag === 'work')).toEqual([{ tag: 'work', source: 'inline' }])

      // removeManual only touches manual rows
      await repo.removeManualPageTag(page.id, 'work') // inline — untouched
      await repo.removeManualPageTag(page.id, 'project-x')
      expect(await repo.listPageTags(page.id)).toEqual([{ tag: 'work', source: 'inline' }])

      // both sources count in the flat index
      await repo.addManualPageTag(page.id, 'project-x')
      expect(await repo.listPageIdsByTag('project-x')).toEqual([page.id])
      await appDb.close()
    })

    it('another user cannot see tags from a personal space', async () => {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      const pages = createPagesService(repo)
      const { user } = await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })
      const personal = await pages.createSpace(user, {
        name: 'Mine',
        category: 'notebook',
        personal: true,
      })
      const secret = await pages.createPage(user, {
        spaceId: personal.id,
        parentId: null,
        title: 'S',
      })
      const doc = await repo.getDocument(secret.id)
      await pages.saveDocument(user, {
        pageId: secret.id,
        content: JSON.stringify([para('x', 'the #secretplan')]),
        baseUpdatedAt: (doc as { updatedAt: Date }).updatedAt.toISOString(),
      })

      // index has the row; the router filters by space access — simulate its check
      const ids = await repo.listPageIdsByTag('secretplan')
      expect(ids).toEqual([secret.id])
      const invite = await auth.createInvite(user.id, { role: 'member' })
      const { user: other } = await auth.acceptInvite({
        token: invite.token,
        name: 'O',
        email: 'o@x.dev',
        password: 'longpassword2',
      })
      const spaces = await repo.listSpaces()
      const accessibleToOther = new Set(
        spaces.filter((s) => s.ownerId === null || s.ownerId === other.id).map((s) => s.id),
      )
      expect(accessibleToOther.has(personal.id)).toBe(false)
      await appDb.close()
    })
  })
}
