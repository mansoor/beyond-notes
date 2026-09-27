import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config'
import { type AppDb, createDb } from './db'
import { buildServer } from './server'
import { createUpdateChecker, newerThan } from './updates'

describe('security headers, security.txt and metrics', () => {
  let appDb: AppDb
  let server: Awaited<ReturnType<typeof buildServer>> | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await appDb?.close()
  })

  async function boot(env: Record<string, string> = {}) {
    appDb = createDb('file::memory:')
    await appDb.migrate('./drizzle')
    server = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        BASE_URL: 'https://notes.example.test',
        UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'bn-hard-')),
        ...env,
      }),
      appDb,
    )
    return server
  }

  it('gives the app a strict CSP and published sites only the harmless headers', async () => {
    const s = await boot()
    const app = await s.inject({
      method: 'GET',
      url: '/healthz',
      headers: { host: 'notes.example.test' },
    })
    expect(app.headers['content-security-policy']).toContain("script-src 'self'")
    expect(app.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(app.headers['x-frame-options']).toBe('DENY')
    expect(app.headers['strict-transport-security']).toContain('max-age=')
    expect(app.headers['x-content-type-options']).toBe('nosniff')

    const site = await s.inject({
      method: 'GET',
      url: '/healthz',
      headers: { host: 'blog.example.org' },
    })
    expect(site.headers['content-security-policy']).toBeUndefined()
    expect(site.headers['x-content-type-options']).toBe('nosniff')
    const draft = await s.inject({
      method: 'GET',
      url: '/s/blog.example.org/',
      headers: { host: 'notes.example.test' },
    })
    expect(draft.headers['content-security-policy']).toBeUndefined()
  })

  it('can be switched off for a proxy that sets its own', async () => {
    const s = await boot({ SECURITY_HEADERS: 'false' })
    const res = await s.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['content-security-policy']).toBeUndefined()
  })

  it('serves security.txt', async () => {
    const s = await boot()
    const res = await s.inject({ method: 'GET', url: '/.well-known/security.txt' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/^Contact: https:\/\//m)
    expect(res.body).toMatch(/^Expires: \d{4}-/m)
  })

  it('keeps metrics off without a token and behind it with one', async () => {
    const off = await boot()
    expect((await off.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(404)
    await off.close()
    await appDb.close()

    const on = await boot({ METRICS_TOKEN: 'scrape-me' })
    expect((await on.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401)
    const res = await on.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer scrape-me' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/^bn_info\{version="[\d.]+"\} 1$/m)
    expect(res.body).toMatch(/^bn_users 0$/m)
    expect(res.body).toMatch(/^bn_http_requests_total\{method="GET",status="4xx"\} \d+$/m)
  })
})

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(newerThan('0.9.0', '0.8.24')).toBe(true)
    expect(newerThan('v0.8.24', '0.8.24')).toBe(false)
    expect(newerThan('0.8.3', '0.8.24')).toBe(false)
    expect(newerThan('1.0.0', '0.99.99')).toBe(true)
  })

  it('reports a newer release, caches it, and stays quiet when the feed fails', async () => {
    let calls = 0
    const feed = (async () => {
      calls++
      return new Response(
        JSON.stringify({
          tag_name: 'v0.9.0',
          html_url: 'https://github.com/x/y/releases/tag/v0.9.0',
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const checker = createUpdateChecker({
      current: '0.8.24',
      feedUrl: 'https://feed',
      enabled: true,
      fetch: feed,
    })
    expect(await checker.check()).toMatchObject({ latest: '0.9.0', available: true })
    await checker.check()
    expect(calls).toBe(1)

    const broken = createUpdateChecker({
      current: '0.8.24',
      feedUrl: 'https://feed',
      enabled: true,
      fetch: (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
    })
    expect(await broken.check()).toMatchObject({ latest: null, available: false })
    const off = createUpdateChecker({
      current: '0.8.24',
      feedUrl: 'x',
      enabled: false,
      fetch: feed,
    })
    expect((await off.check()).available).toBe(false)
  })
})

describe('pre-upgrade snapshot (SQLite)', () => {
  it('copies the database before applying new migrations, and only then', async () => {
    const work = mkdtempSync(join(tmpdir(), 'bn-snap-'))
    // an "older build": the same migrations minus the newest one
    const older = join(work, 'older')
    cpSync('./drizzle', older, { recursive: true })
    const journalPath = join(older, 'sqlite', 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.entries = journal.entries.slice(0, -1)
    writeFileSync(journalPath, JSON.stringify(journal))

    const dbFile = join(work, 'beyond.db')
    const snaps = join(work, 'backups')
    const logs: string[] = []

    const first = createDb(`file:${dbFile}`)
    await first.migrate(older, { snapshotDir: snaps, log: (m) => logs.push(m) })
    await first.close()
    expect(existsSync(snaps)).toBe(false) // brand-new database: nothing to protect

    const upgraded = createDb(`file:${dbFile}`)
    await upgraded.migrate('./drizzle', { snapshotDir: snaps, log: (m) => logs.push(m) })
    const copies = readdirSync(snaps).filter((f) => f.startsWith('pre-upgrade-'))
    expect(copies).toHaveLength(1)
    expect(logs.join('\n')).toMatch(/Applying 1 database migration/)

    // already current: no new copy
    await upgraded.migrate('./drizzle', { snapshotDir: snaps })
    expect(readdirSync(snaps).filter((f) => f.startsWith('pre-upgrade-'))).toHaveLength(1)
    await upgraded.close()

    // the copy is a working database at the older schema
    const restored = createDb(`file:${join(snaps, copies[0] as string)}`)
    await restored.migrate(older)
    await restored.close()
  })
})
