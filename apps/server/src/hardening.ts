/**
 * Security headers, security.txt and the Prometheus metrics endpoint.
 *
 * The app itself gets a strict Content-Security-Policy: it loads nothing from
 * other origins except images and media people put in their pages. Published
 * sites are left out of that policy on purpose. They can carry analytics,
 * reCAPTCHA and embeds the site owner chose, so they get only the headers
 * that can't break anything (nosniff, referrer policy).
 */
import type { FastifyInstance } from 'fastify'
import type { Config } from './config'
import type { Repo } from './repo'

export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React and the editor set style attributes inline
  "style-src 'self' 'unsafe-inline'",
  // pages can show images, audio and video from anywhere their author linked
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' https:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export function registerHardening(
  server: FastifyInstance,
  deps: { config: Config; repo: Repo; version: string },
) {
  const { config } = deps
  const appHost = new URL(config.BASE_URL).host.toLowerCase()
  const https = config.BASE_URL.startsWith('https://')

  if (config.SECURITY_HEADERS) {
    server.addHook('onSend', async (req, reply, payload) => {
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
      const host = (req.headers.host ?? '').toLowerCase()
      const isSite = (host && host !== appHost) || req.url.startsWith('/s/')
      if (!isSite) {
        reply.header('Content-Security-Policy', APP_CSP)
        reply.header('X-Frame-Options', 'DENY')
        reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
        if (https) reply.header('Strict-Transport-Security', 'max-age=15552000')
      }
      return payload
    })
  }

  // how to report a vulnerability (RFC 9116)
  server.get('/.well-known/security.txt', async (_req, reply) => {
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    reply.type('text/plain; charset=utf-8')
    return [
      `Contact: ${config.SECURITY_CONTACT}`,
      `Expires: ${expires}`,
      'Preferred-Languages: en',
      `Policy: ${config.SECURITY_CONTACT.startsWith('http') ? config.SECURITY_CONTACT : 'https://github.com/mansoor/beyond-notes/security/policy'}`,
      '',
    ].join('\n')
  })

  // ---- metrics (off unless METRICS_TOKEN is set) ----
  const requests = new Map<string, number>()
  const started = Date.now()
  server.addHook('onResponse', async (req, reply) => {
    const key = `${req.method}|${Math.floor(reply.statusCode / 100)}xx`
    requests.set(key, (requests.get(key) ?? 0) + 1)
  })

  server.get('/metrics', async (req, reply) => {
    if (!config.METRICS_TOKEN) return reply.code(404).send({ error: 'not found' })
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${config.METRICS_TOKEN}`) {
      reply.header('www-authenticate', 'Bearer')
      return reply.code(401).send({ error: 'metrics need the METRICS_TOKEN as a Bearer token' })
    }
    const counts = await deps.repo.instanceCounts()
    const mem = process.memoryUsage()
    const lines = [
      '# HELP bn_info Build information.',
      '# TYPE bn_info gauge',
      `bn_info{version="${deps.version}"} 1`,
      '# HELP bn_uptime_seconds Seconds since the server started.',
      '# TYPE bn_uptime_seconds gauge',
      `bn_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`,
      '# HELP bn_memory_rss_bytes Resident memory of the server process.',
      '# TYPE bn_memory_rss_bytes gauge',
      `bn_memory_rss_bytes ${mem.rss}`,
      '# HELP bn_memory_heap_used_bytes V8 heap in use.',
      '# TYPE bn_memory_heap_used_bytes gauge',
      `bn_memory_heap_used_bytes ${mem.heapUsed}`,
      '# HELP bn_users Accounts on this instance.',
      '# TYPE bn_users gauge',
      `bn_users ${counts.users}`,
      '# HELP bn_spaces Spaces (notebooks, wikis, sites).',
      '# TYPE bn_spaces gauge',
      `bn_spaces ${counts.spaces}`,
      '# HELP bn_pages Pages, not counting trashed ones.',
      '# TYPE bn_pages gauge',
      `bn_pages ${counts.pages}`,
      '# HELP bn_attachments Uploaded files.',
      '# TYPE bn_attachments gauge',
      `bn_attachments ${counts.attachments}`,
      '# HELP bn_attachments_bytes Total size of uploaded files.',
      '# TYPE bn_attachments_bytes gauge',
      `bn_attachments_bytes ${counts.attachmentBytes}`,
      '# HELP bn_http_requests_total HTTP requests answered, by method and status class.',
      '# TYPE bn_http_requests_total counter',
      ...[...requests.entries()].map(([k, v]) => {
        const [method, status] = k.split('|')
        return `bn_http_requests_total{method="${method}",status="${status}"} ${v}`
      }),
      '',
    ]
    reply.type('text/plain; version=0.0.4; charset=utf-8')
    return lines.join('\n')
  })
}
