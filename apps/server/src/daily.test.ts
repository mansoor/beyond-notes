import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { createDailyService } from './daily'
import { type AppDb, createDb } from './db'
import { createPagesService } from './pages'
import { createRepo } from './repo'
import { createTasksService, extractTasks } from './tasks'

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

describe('extractTasks (pure)', () => {
  it('collects checkbox blocks with text, checked state, and @due tokens, including nested ones', () => {
    const content = JSON.stringify([
      { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: 'hello', styles: {} }] },
      {
        id: 't1',
        type: 'checkListItem',
        props: { checked: false },
        content: [{ type: 'text', text: 'Renew insurance @2026-07-21', styles: {} }],
        children: [
          {
            id: 't2',
            type: 'checkListItem',
            props: { checked: true },
            content: [{ type: 'text', text: 'nested done', styles: {} }],
          },
        ],
      },
    ])
    const tasks = extractTasks(content)
    expect(tasks).toEqual([
      {
        blockId: 't1',
        text: 'Renew insurance @2026-07-21',
        checked: false,
        due: '2026-07-21',
        dueTime: null,
      },
      { blockId: 't2', text: 'nested done', checked: true, due: null, dueTime: null },
    ])
  })

  it('reads a time off a @dateTHH:MM token', () => {
    const content = JSON.stringify([
      {
        id: 't1',
        type: 'checkListItem',
        props: { checked: false },
        content: [{ type: 'text', text: 'Call the bank @2026-08-01T14:30', styles: {} }],
      },
    ])
    expect(extractTasks(content)).toEqual([
      {
        blockId: 't1',
        text: 'Call the bank @2026-08-01T14:30',
        checked: false,
        due: '2026-08-01',
        dueTime: '14:30',
      },
    ])
  })

  it('tolerates malformed content', () => {
    expect(extractTasks('not json')).toEqual([])
    expect(extractTasks('{"a":1}')).toEqual([])
  })
})

for (const dialect of dialects) {
  describe(`daily + tasks (${dialect.name})`, () => {
    async function setup() {
      const appDb = await dialect.make()
      const repo = createRepo(appDb)
      const auth = createAuthService(repo)
      let tick = 1_700_000_000_000
      const now = () => {
        tick += 10
        return new Date(tick)
      }
      const pages = createPagesService(repo, { now })
      const daily = createDailyService(repo, { now })
      const tasks = createTasksService(repo, { now })
      const { user: admin } = await auth.setup({
        name: 'M',
        email: 'm@x.dev',
        password: 'longpassword1',
      })
      const invite = await auth.createInvite(admin.id, { role: 'member' })
      const { user: member } = await auth.acceptInvite({
        token: invite.token,
        name: 'P',
        email: 'p@x.dev',
        password: 'longpassword2',
      })
      return { appDb, repo, pages, daily, tasks, admin, member }
    }

    it('journal day pages are get-or-create and per-user', async () => {
      const { appDb, daily, pages, admin, member } = await setup()

      const first = await daily.day(admin, '2026-07-18')
      const again = await daily.day(admin, '2026-07-18')
      expect(again.page.id).toBe(first.page.id)
      expect(first.page.dateKey).toBe('2026-07-18')

      // member gets their own journal, not the admin's
      const theirs = await daily.day(member, '2026-07-18')
      expect(theirs.page.id).not.toBe(first.page.id)

      // journal space never appears in the sidebar space list
      const spaceList = await pages.listSpaces(admin)
      expect(spaceList.map((s) => s.kind)).not.toContain('journal')

      // calendar dots
      await daily.day(admin, '2026-07-20')
      expect(await daily.days(admin, '2026-07')).toEqual(['2026-07-18', '2026-07-20'])
      expect(await daily.days(member, '2026-07')).toEqual(['2026-07-18'])
      await appDb.close()
    })

    it('memo capture and all three promote paths', async () => {
      const { appDb, repo, daily, admin } = await setup()
      const shared = await createPagesService(repo).createSpace(admin, {
        name: 'Notes',
        category: 'notebook',
        personal: false,
      })

      const m1 = await daily.capture(admin, 'An idea about gallery captions')
      const m2 = await daily.capture(admin, 'Buy a new NAS drive @2026-08-01')
      const m3 = await daily.capture(admin, 'Reflection about the day')

      // → note
      const page = await daily.promoteToNote(admin, m1.id, shared.id)
      expect(page.title).toContain('An idea about gallery captions')
      const doc = await repo.getDocument(page.id)
      expect(doc?.content).toContain('gallery captions')

      // → task (lands in tasks inbox, indexed with due date)
      await daily.promoteToTask(admin, m2.id)
      const inbox = await daily.tasksInboxPage(admin)
      const inboxTasks = await repo.listTasksForPage(inbox.id)
      expect(inboxTasks).toHaveLength(1)
      expect(inboxTasks[0]?.due).toBe('2026-08-01')

      // → journal (appended with a time stamp)
      await daily.promoteToJournal(admin, m3.id, '2026-07-18')
      const day = await daily.day(admin, '2026-07-18')
      expect(day.doc.content).toContain('Reflection about the day')

      const memos = await daily.listMemos(admin)
      expect(memos.map((m) => m.promotedTo).sort()).toEqual(['journal', 'note', 'task'])
      await appDb.close()
    })

    it('saveDocument reconciles the tasks index (add, edit, check, remove)', async () => {
      const { appDb, repo, pages, admin } = await setup()
      const space = await pages.createSpace(admin, {
        name: 'N',
        category: 'notebook',
        personal: false,
      })
      const page = await pages.createPage(admin, { spaceId: space.id, parentId: null, title: 'T' })

      const block = (id: string, text: string, checked: boolean) => ({
        id,
        type: 'checkListItem',
        props: { checked },
        content: [{ type: 'text', text, styles: {} }],
        children: [],
      })

      const { doc } = await pages.getPage(admin, page.id)
      const r1 = await pages.saveDocument(admin, {
        pageId: page.id,
        content: JSON.stringify([
          block('a', 'first @2026-07-19', false),
          block('b', 'second', false),
        ]),
        baseUpdatedAt: doc.updatedAt.toISOString(),
      })
      let rows = await repo.listTasksForPage(page.id)
      expect(rows).toHaveLength(2)
      expect(rows.find((r) => r.blockId === 'a')?.due).toBe('2026-07-19')

      // edit text, check one, drop the other
      await pages.saveDocument(admin, {
        pageId: page.id,
        content: JSON.stringify([block('a', 'first edited', true)]),
        baseUpdatedAt: r1.updatedAt,
      })
      rows = await repo.listTasksForPage(page.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.text).toBe('first edited')
      expect(rows[0]?.checked).toBe(true)
      expect(rows[0]?.due).toBeNull()
      await appDb.close()
    })

    it('agenda respects space visibility; toggle mutates the block', async () => {
      const { appDb, repo, daily, tasks, admin, member } = await setup()

      await daily.quickAddTask(admin, 'admin private task')
      await daily.quickAddTask(member, 'member private task @2026-07-20')

      const adminAgenda = await tasks.agenda(admin)
      expect(adminAgenda.map((r) => r.task.text)).toEqual(['admin private task'])
      const memberAgenda = await tasks.agenda(member)
      expect(memberAgenda.map((r) => r.task.text)).toEqual(['member private task @2026-07-20'])

      // toggle writes through to the document block
      const target = memberAgenda[0]
      if (!target) throw new Error('missing task')
      await tasks.toggle(member, target.task.id, true)
      const doc = await repo.getDocument(target.page.id)
      expect(doc?.content).toContain('"checked":true')
      const after = await tasks.agenda(member)
      expect(after[0]?.task.checked).toBe(true)

      // a member cannot toggle someone else's private task
      const adminTask = adminAgenda[0]
      if (!adminTask) throw new Error('missing task')
      await expect(tasks.toggle(member, adminTask.task.id, true)).rejects.toThrow('not found')
      await appDb.close()
    })

    it('editing a task rewrites its text and due, preserving the checked state', async () => {
      const { appDb, daily, tasks, admin } = await setup()
      // the user typed a due date in the wrong format — no due was parsed
      await daily.quickAddTask(admin, 'call plumber on 8/1')
      let agenda = await tasks.agenda(admin)
      const t = agenda[0]
      if (!t) throw new Error('missing task')
      expect(t.task.due).toBeNull()

      // fix the text and set a real due date
      await tasks.edit(admin, t.task.id, 'Call the plumber', '2026-08-01')
      agenda = await tasks.agenda(admin)
      expect(agenda[0]?.task.text).toBe('Call the plumber @2026-08-01')
      expect(agenda[0]?.task.due).toBe('2026-08-01')

      // check it, then edit again — the checkbox state survives the rewrite
      await tasks.toggle(admin, t.task.id, true)
      await tasks.edit(admin, t.task.id, 'Call the plumber back', '2026-08-02')
      agenda = await tasks.agenda(admin)
      expect(agenda[0]?.task.checked).toBe(true)
      expect(agenda[0]?.task.due).toBe('2026-08-02')
      expect(agenda[0]?.task.text).not.toContain('@2026-08-01') // old token gone

      // clearing the due date drops the token entirely
      await tasks.edit(admin, t.task.id, 'Call the plumber back', null)
      agenda = await tasks.agenda(admin)
      expect(agenda[0]?.task.due).toBeNull()
      expect(agenda[0]?.task.text).toBe('Call the plumber back')
      await appDb.close()
    })

    it('a task carries an optional time-of-day, dropped when the date is cleared', async () => {
      const { appDb, daily, tasks, admin } = await setup()
      await daily.quickAddTask(admin, 'Call the bank')
      let agenda = await tasks.agenda(admin)
      const t = agenda[0]
      if (!t) throw new Error('missing task')

      // set a date and a time
      await tasks.edit(admin, t.task.id, 'Call the bank', '2026-08-01', '14:30')
      agenda = await tasks.agenda(admin)
      expect(agenda[0]?.task.due).toBe('2026-08-01')
      expect(agenda[0]?.task.dueTime).toBe('14:30')
      expect(agenda[0]?.task.text).toContain('@2026-08-01T14:30')

      // drop just the time, keep the date
      await tasks.edit(admin, t.task.id, 'Call the bank', '2026-08-01', null)
      agenda = await tasks.agenda(admin)
      expect(agenda[0]?.task.due).toBe('2026-08-01')
      expect(agenda[0]?.task.dueTime).toBeNull()
      expect(agenda[0]?.task.text).toBe('Call the bank @2026-08-01')

      // a time without a date is meaningless — clearing the date drops both
      await tasks.edit(admin, t.task.id, 'Call the bank', null, '14:30')
      agenda = await tasks.agenda(admin)
      expect(agenda[0]?.task.due).toBeNull()
      expect(agenda[0]?.task.dueTime).toBeNull()
      await appDb.close()
    })

    it('editing a memo rewrites it; a promoted memo refuses', async () => {
      const { appDb, daily, admin } = await setup()
      const memo = await daily.capture(admin, 'by milk')
      await daily.updateMemo(admin, memo.id, 'buy milk')
      expect((await daily.listMemos(admin))[0]?.content).toBe('buy milk')

      await daily.promoteToTask(admin, memo.id)
      await expect(daily.updateMemo(admin, memo.id, 'too late')).rejects.toThrow('already moved')
      await appDb.close()
    })
  })
}
