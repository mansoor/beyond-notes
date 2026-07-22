import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { type PagesService, createPagesService } from './pages'
import { type PublishingService, createPublishingService } from './publishing'
import { createRepo } from './repo'
import type { UserRow } from './repo'
import { buildServer } from './server'
import { type TablesService, createTablesService } from './tables'

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

function doc(text: string) {
  return JSON.stringify([
    {
      id: 'b1',
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    },
  ])
}

for (const dialect of dialects) {
  describe(`public forms (${dialect.name})`, () => {
    let appDb: AppDb
    let server: Awaited<ReturnType<typeof buildServer>>
    let repo: ReturnType<typeof createRepo>
    let tables: TablesService
    let pages: PagesService
    let publishing: PublishingService
    let user: UserRow
    const HOST = 'forms.example.test'
    let tableId: string
    let nameId: string
    let emailId: string

    const post = (id: string, fields: Record<string, string>, ip = '1.1.1.1') =>
      server.inject({
        method: 'POST',
        url: `/api/forms/${id}`,
        headers: {
          host: HOST,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams(fields).toString(),
        remoteAddress: ip,
      })

    beforeAll(async () => {
      appDb = await dialect.make()
      const config = loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.example.test',
        DATABASE_URL: 'unused',
      } as never)
      server = await buildServer(config, appDb)
      repo = createRepo(appDb)
      const auth = createAuthService(repo)
      pages = createPagesService(repo)
      publishing = createPublishingService(repo)
      tables = createTablesService(repo)
      user = (await auth.setup({ name: 'M', email: 'm@x.dev', password: 'longpassword1' })).user

      // a database + a table with a form exposing Name (required) and Email
      const database = await tables.createDatabase(user, { name: 'CRM', personal: false })
      const table = await tables.createTable(user, { databaseId: database.id, name: 'Contact' })
      tableId = table.id
      const cols = await tables.updateColumns(user, {
        tableId,
        columns: [
          { name: 'Name', type: 'text', required: true, choices: [] },
          { name: 'Email', type: 'email', required: true, choices: [] },
        ],
      })
      nameId = cols[0]?.id as string
      emailId = cols[1]?.id as string
      await tables.updateForm(user, {
        tableId,
        form: {
          enabled: true,
          fields: [nameId, emailId],
          columns: 1,
          layout: {},
          labels: {},
          blocks: [],
          order: [],
          title: 'Contact me',
          description: '',
          submitLabel: 'Send',
          successMessage: 'Got it, thanks.',
          notify: false,
          captcha: 'none',
        },
      })

      // a published site page that embeds the form
      const site = await pages.createSpace(user, { name: 'me', category: 'site', personal: false })
      const contact = await pages.createPage(user, {
        spaceId: site.id,
        parentId: null,
        title: 'Contact',
      })
      const { doc: d } = await pages.getPage(user, contact.id)
      await pages.saveDocument(user, {
        pageId: contact.id,
        content: doc(`[[form:${tableId}]]`),
        baseUpdatedAt: d.updatedAt.toISOString(),
      })
      await publishing.updateSpacePublishing(user, {
        spaceId: site.id,
        enabled: true,
        host: HOST,
        title: 'Me',
        footer: '',
        theme: 'paper',
      })
      await publishing.publish(user, contact.id)
    }, 30000)

    afterAll(async () => {
      await server.close()
      await appDb.close()
    })

    it('expands [[form:id]] into a live form on the published page', async () => {
      const res = await server.inject({ method: 'GET', url: '/contact', headers: { host: HOST } })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain(`action="/api/forms/${tableId}"`)
      expect(res.body).toContain('class="bn-form"')
      expect(res.body).toContain(`name="${nameId}"`)
      expect(res.body).toContain('name="_website"') // honeypot present
      expect(res.body).toContain('data-bn-form') // the enhancement script hook
      // the raw token must not survive into the page
      expect(res.body).not.toContain(`[[form:${tableId}]]`)
    })

    it('accepts a valid submission and stores it as a form row', async () => {
      const res = await post(tableId, { [nameId]: 'Ann', [emailId]: 'ann@example.com' }, '2.2.2.2')
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true })
      const rows = await repo.listDbRows(tableId)
      const formRows = rows.filter((r) => r.source === 'form')
      expect(formRows.length).toBe(1)
      expect(JSON.parse(formRows[0]?.cells ?? '{}')[nameId]).toBe('Ann')
    })

    it('rejects a submission missing a required field', async () => {
      const res = await post(tableId, { [emailId]: 'x@y.com' }, '3.3.3.3')
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ ok: false })
    })

    it('silently ignores a honeypot-tripped submission (no row written)', async () => {
      const before = (await repo.listDbRows(tableId)).length
      const res = await post(
        tableId,
        { [nameId]: 'Bot', [emailId]: 'bot@spam.com', _website: 'http://spam' },
        '4.4.4.4',
      )
      expect(res.statusCode).toBe(200) // looks like success to the bot
      expect((await repo.listDbRows(tableId)).length).toBe(before) // but nothing stored
    })

    it('404s a submission to a table that has no form', async () => {
      const res = await post('nonexistent-table-id', { x: 'y' }, '5.5.5.5')
      expect(res.statusCode).toBe(404)
    })

    it('rate-limits a flood of submissions from one IP', async () => {
      let sawLimit = false
      for (let i = 0; i < 12; i++) {
        const res = await post(tableId, { [nameId]: `n${i}`, [emailId]: `n${i}@x.com` }, '9.9.9.9')
        if (res.statusCode === 429) {
          sawLimit = true
          break
        }
      }
      expect(sawLimit).toBe(true)
    })

    it('embeds a shared table read-only and hides a personal one', async () => {
      // a shared (household) table with a row
      const shared = await tables.createDatabase(user, { name: 'Facts', personal: false })
      const fruit = await tables.createTable(user, { databaseId: shared.id, name: 'Fruit' })
      const cols = await tables.updateColumns(user, {
        tableId: fruit.id,
        columns: [{ name: 'Item', type: 'text', required: false, choices: [] }],
      })
      const itemId = cols[0]?.id as string
      await tables.insertRow(user, { tableId: fruit.id, cells: { [itemId]: 'Mango' } })

      // a personal table
      const priv = await tables.createDatabase(user, { name: 'Priv', personal: true })
      const secret = await tables.createTable(user, { databaseId: priv.id, name: 'Secret' })

      // a published site embedding both
      const site = await pages.createSpace(user, { name: 'f', category: 'site', personal: false })
      const p1 = await pages.createPage(user, { spaceId: site.id, parentId: null, title: 'Fruit' })
      const p2 = await pages.createPage(user, { spaceId: site.id, parentId: null, title: 'Secret' })
      const save = async (id: string, body: string) => {
        const { doc: d } = await pages.getPage(user, id)
        await pages.saveDocument(user, {
          pageId: id,
          content: doc(body),
          baseUpdatedAt: d.updatedAt.toISOString(),
        })
      }
      await save(p1.id, `[[table='${fruit.id}' layout=table]]`)
      await save(p2.id, `[[table='${secret.id}']]`)
      await publishing.updateSpacePublishing(user, {
        spaceId: site.id,
        enabled: true,
        host: 'facts.example.test',
        title: 'F',
        footer: '',
        theme: 'paper',
      })
      await publishing.publish(user, p1.id)
      await publishing.publish(user, p2.id)

      const get = (path: string) =>
        server.inject({ method: 'GET', url: path, headers: { host: 'facts.example.test' } })

      const shownRes = await get('/fruit')
      expect(shownRes.body).toContain('bn-embed-table')
      expect(shownRes.body).toContain('Mango')
      expect(shownRes.body).not.toContain(`[[table='${fruit.id}'`) // token consumed

      const hiddenRes = await get('/secret')
      expect(hiddenRes.body).toContain('private') // personal table not exposed
      expect(hiddenRes.body).not.toContain(`[[table='${secret.id}'`)
    })

    // runs last: it switches the form to the basic captcha
    it('renders and enforces the basic captcha challenge', async () => {
      await tables.updateForm(user, {
        tableId,
        form: {
          enabled: true,
          fields: [nameId, emailId],
          columns: 1,
          layout: {},
          labels: {},
          blocks: [],
          order: [],
          title: 'Contact me',
          description: '',
          submitLabel: 'Send',
          successMessage: 'Got it.',
          notify: false,
          captcha: 'basic',
        },
      })
      const page = await server.inject({ method: 'GET', url: '/contact', headers: { host: HOST } })
      expect(page.body).toContain('name="_captcha"')
      const q = page.body.match(/What is (\d+) \+ (\d+)/)
      const token = page.body.match(/name="_captcha" value="([^"]+)"/)?.[1]
      expect(q).toBeTruthy()
      expect(token).toBeTruthy()
      const answer = String(Number(q?.[1]) + Number(q?.[2]))

      const wrong = await post(
        tableId,
        { [nameId]: 'Ann', [emailId]: 'a@b.com', _captcha: token ?? '', _captcha_answer: '0' },
        '11.11.11.11',
      )
      expect(wrong.statusCode).toBe(400)

      const right = await post(
        tableId,
        { [nameId]: 'Ann', [emailId]: 'a@b.com', _captcha: token ?? '', _captcha_answer: answer },
        '12.12.12.12',
      )
      expect(right.statusCode).toBe(200)
    })
  })
}
