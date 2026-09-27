import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createAuthService } from './auth'
import { loadConfig } from './config'
import { createDailyService } from './daily'
import { type AppDb, createDb } from './db'
import { detectKind, parseCsv, parseEvernote, parseNotion, parseObsidian } from './importers'
import { createRepo } from './repo'
import { buildServer } from './server'

let png: Uint8Array
beforeAll(async () => {
  png = new Uint8Array(
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#3355aa' } })
      .png()
      .toBuffer(),
  )
})

const ID = (n: number) => `${n}`.padStart(32, 'a')

function notionZip(): Uint8Array {
  const home = `Home ${ID(1)}`
  const inner = zipSync({
    [`Export-x/${home}.md`]: strToU8(
      `# Home\n\nSee [Recipes](${encodeURIComponent(home)}/Recipes%20${ID(2)}.md).\n\n![pic](${encodeURIComponent(home)}/pic.png)\n`,
    ),
    [`Export-x/${home}/Recipes ${ID(2)}.md`]: strToU8('# Recipes\n\nPasta with **garlic**.\n'),
    [`Export-x/${home}/pic.png`]: png,
    [`Export-x/${home}/Books ${ID(3)}.csv`]: strToU8('Name,Author\nDune,Herbert\n'),
    [`Export-x/${home}/Books ${ID(3)}_all.csv`]: strToU8(
      'Name,Author,Notes\nDune,Herbert,"Spice, sand"\n',
    ),
    [`Export-x/${home}/Books ${ID(3)}/Dune ${ID(4)}.md`]: strToU8('# Dune\n\nRead in 2025.\n'),
  })
  // big Notion exports arrive as a zip of zips
  return zipSync({ 'Part-1.zip': inner })
}

function obsidianZip(): Uint8Array {
  return zipSync({
    'My Vault/.obsidian/app.json': strToU8('{}'),
    'My Vault/Projects/Projects.md': strToU8('All my projects.'),
    'My Vault/Projects/Homelab.md': strToU8(
      '---\ntags: [infra, lab]\n---\nSee [[Ideas|my ideas]] and [[2026-09-20]].\n\n![[diagram.png]]\n\n```\n[[not a link]]\n```\n',
    ),
    'My Vault/Ideas.md': strToU8('- [ ] try Pocket ID\n'),
    'My Vault/attachments/diagram.png': png,
    'My Vault/Daily/2026-09-20.md': strToU8('Went hiking.\n'),
  })
}

function enex(): string {
  const b64 = Buffer.from(png).toString('base64')
  const hash = createHash('md5').update(png).digest('hex')
  const content = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div><b>Shopping</b></div><div><en-todo checked="true"/>Buy milk</div><div><en-todo/>Call plumber</div><div><en-media type="image/png" hash="${hash}"/></div></en-note>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260926T000000Z" application="Evernote">
  <note>
    <title>Weekend</title>
    <content><![CDATA[${content}]]></content>
    <tag>shopping</tag>
    <resource><data encoding="base64">${b64}</data><mime>image/png</mime><resource-attributes><file-name>receipt.png</file-name></resource-attributes></resource>
  </note>
  <note><title>Empty</title><content><![CDATA[<en-note><div>Just text &amp; more</div></en-note>]]></content></note>
</en-export>`
}

describe('importers', () => {
  it('reads a Notion export: hierarchy, links, images, and databases as tables', () => {
    const plan = parseNotion(notionZip(), 'Export.zip')
    expect(plan.nodes.map((n) => [n.title, n.level])).toEqual([
      ['Home', 0],
      ['Books', 1],
      ['Dune', 2],
      ['Recipes', 1],
    ])
    const [home, books] = plan.nodes
    const recipesKey = plan.nodes.find((n) => n.title === 'Recipes')?.key
    expect(home?.markdown).toContain(`[Recipes](bn-page:${recipesKey})`)
    expect(home?.markdown).toMatch(/!\[pic\]\(bn-file:f\d+\)/)
    expect(home?.markdown).not.toMatch(/^# Home/)
    // the _all view wins, quoted commas survive
    expect(books?.markdown).toContain('| Dune | Herbert | Spice, sand |')
    expect(plan.files.size).toBe(1)
    expect(detectKind('Export.zip', notionZip())).toBe('notion')
  })

  it('reads an Obsidian vault: folders, wikilinks, embeds, tags, daily notes', () => {
    const plan = parseObsidian(obsidianZip(), 'vault.zip')
    expect(plan.suggestedName).toBe('My Vault')
    expect(plan.nodes.map((n) => [n.title, n.level, n.journalDate ?? null])).toEqual([
      ['Projects', 0, null],
      ['Homelab', 1, null],
      ['Ideas', 0, null],
      ['2026-09-20', 0, '2026-09-20'],
    ])
    const projects = plan.nodes[0]
    const homelab = plan.nodes[1]
    const ideasKey = plan.nodes[2]?.key
    expect(projects?.markdown).toBe('All my projects.') // the folder note
    expect(homelab?.markdown).toContain('#infra #lab')
    expect(homelab?.markdown).toContain(`[my ideas](bn-page:${ideasKey})`)
    expect(homelab?.markdown).toContain('[2026-09-20](/day/2026-09-20)')
    expect(homelab?.markdown).toMatch(/!\[\]\(bn-file:f\d+\)/)
    expect(homelab?.markdown).toContain('[[not a link]]') // code is left alone
    expect(detectKind('vault.zip', obsidianZip())).toBe('obsidian')
  })

  it('reads Evernote .enex: checkboxes, images by hash, tags', () => {
    const plan = parseEvernote(new TextEncoder().encode(enex()), 'Personal.enex')
    expect(plan.suggestedName).toBe('Personal')
    expect(plan.nodes.map((n) => n.title)).toEqual(['Weekend', 'Empty'])
    const md = plan.nodes[0]?.markdown ?? ''
    expect(md).toContain('#shopping')
    expect(md).toContain('**Shopping**')
    expect(md).toContain('- [x] Buy milk')
    expect(md).toContain('- [ ] Call plumber')
    expect(md).toMatch(/!\[\]\(bn-file:r[0-9a-f]{32}\)/)
    expect(plan.files.size).toBe(1)
    expect(plan.nodes[1]?.markdown).toContain('Just text & more')
    expect(detectKind('Personal.enex', new TextEncoder().encode(enex()))).toBe('evernote')
  })

  it('parses CSV with quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ])
  })
})

describe('importing an upload through the real server', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await appDb?.close()
  })

  it('previews without content, then creates pages, links, files and journal days', async () => {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'http://app.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-import-')),
      }),
      appDb,
    )
    const repo = createRepo(appDb)
    const { user, session } = await createAuthService(repo).setup({
      name: 'Owner',
      email: 'owner@home.lan',
      password: 'longpassword1',
    })
    const cookie = `bn_session=${session.token}`

    // multipart upload, as the browser sends it
    const boundary = '----bn-test-boundary'
    const zip = Buffer.from(obsidianZip())
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="vault.zip"\r\nContent-Type: application/zip\r\n\r\n`,
      ),
      zip,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const preview = await server.inject({
      method: 'POST',
      url: '/api/import/archive?kind=auto',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(preview.statusCode).toBe(200)
    const plan = preview.json()
    expect(plan.stashId).toBeTruthy()
    expect(plan.nodes.every((n: { markdown: string }) => n.markdown === '')).toBe(true)

    // the reviewer merges "Ideas" into "Homelab" (links to Ideas must follow)
    const ideas = plan.nodes.find((n: { title: string }) => n.title === 'Ideas')
    const homelab = plan.nodes.find((n: { title: string }) => n.title === 'Homelab')
    const apply = async () =>
      server?.inject({
        method: 'POST',
        url: '/api/trpc/imports.create',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({
          newSpaceName: 'Vault',
          category: 'notebook',
          stashId: plan.stashId,
          merges: { [ideas.key]: homelab.key },
          nodes: plan.nodes,
        }),
      })
    const res = await apply()
    expect(res?.statusCode).toBe(200)
    const result = res?.json().result.data
    expect(result).toMatchObject({ pages: 2, journal: 1, images: 1 })

    const pages = await repo.listPagesInSpace(result.spaceId)
    const byTitle = new Map(pages.map((p) => [p.title, p]))
    expect([...byTitle.keys()].sort()).toEqual(['Homelab', 'Projects'])
    const homelabPage = byTitle.get('Homelab')
    if (!homelabPage) throw new Error('unreachable')
    const doc = await repo.getDocument(homelabPage.id)
    const content = doc?.content ?? ''
    expect(content).toContain(`/p/${homelabPage.id}`) // the merged link now points home
    expect(content).toContain('/api/files/')
    expect(content).toContain('try Pocket ID') // Ideas' content was merged in
    expect(content).toContain('/day/2026-09-20')

    const day = await createDailyService(repo).day(user, '2026-09-20')
    expect(day.doc.content).toContain('Went hiking.')

    // the upload is used up
    const again = await apply()
    expect(again?.statusCode).toBe(400)
    expect(again?.json().error.message).toMatch(/expired/)
  })
})
