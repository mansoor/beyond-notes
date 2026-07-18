import { escapeHtml } from './render'
import { type ThemeName, themeCss } from './themes'

export type SiteNavItem = { title: string; path: string; active?: boolean }
export type PostListItem = { title: string; path: string; date: string; snippet: string }

const SITE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);font-size:16px;line-height:1.7}
header{display:flex;align-items:baseline;gap:22px;padding:20px 40px;max-width:820px;margin:0 auto;flex-wrap:wrap}
header .logo{font-weight:700;font-size:17px;color:var(--text);text-decoration:none;margin-right:auto}
header nav a{color:var(--text2);text-decoration:none;font-size:14px;margin-left:16px}
header nav a.active{color:var(--text);font-weight:600}
main{max-width:680px;margin:0 auto;padding:26px 40px 60px}
main h1{font-size:30px;letter-spacing:-.02em;line-height:1.2;margin-bottom:10px}
main h2{font-size:21px;margin:26px 0 8px}
main h3{font-size:18px;margin:20px 0 6px}
main p{margin:10px 0}
main ul,main ol{margin:8px 0 8px 22px}
main ul.checklist{list-style:none;margin-left:2px}
main pre{background:var(--code);border:1px solid var(--border);border-radius:8px;
padding:13px 15px;margin:12px 0;overflow-x:auto;font-size:13px}
main code{font-family:ui-monospace,Consolas,monospace;font-size:.92em}
main p code{background:var(--code);border-radius:4px;padding:1px 5px}
main blockquote{border-left:3px solid var(--border);padding-left:14px;color:var(--text2);margin:10px 0}
main a{color:var(--accent)}
.meta{color:var(--text3);font-size:13px;margin-bottom:18px}
.postlist{margin-top:18px}
.postlist .post{display:flex;justify-content:space-between;align-items:baseline;gap:16px;
padding:13px 0;border-top:1px solid var(--border)}
.postlist .post a{font-size:17px;font-weight:600;color:var(--text);text-decoration:none}
.postlist .post a:hover{color:var(--accent)}
.postlist .date{color:var(--text3);font-size:13px;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}
.postlist .snippet{color:var(--text2);font-size:14px;margin:2px 0 0}
.backlink{display:inline-block;margin-bottom:14px;font-size:13px;color:var(--text3);text-decoration:none}
footer{border-top:1px solid var(--border);padding:16px 40px;font-size:12px;color:var(--text3);
display:flex;justify-content:space-between;max-width:820px;margin:0 auto}
`

function shell(input: {
  siteTitle: string
  footer: string
  title: string
  theme: ThemeName
  nav: SiteNavItem[]
  basePath: string
  body: string
  rssPath?: string
}): string {
  const nav = input.nav
    .map(
      (n) =>
        `<a href="${escapeHtml(input.basePath + n.path)}"${n.active ? ' class="active"' : ''}>${escapeHtml(n.title)}</a>`,
    )
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} — ${escapeHtml(input.siteTitle)}</title>
${input.rssPath ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(input.siteTitle)}" href="${escapeHtml(input.basePath + input.rssPath)}">` : ''}
<style>${themeCss(input.theme)}${SITE_CSS}</style>
</head>
<body>
<header><a class="logo" href="${escapeHtml(input.basePath || '/')}">${escapeHtml(input.siteTitle)}</a><nav>${nav}</nav></header>
<main>
${input.body}
</main>
<footer><span>${escapeHtml(input.footer)}</span><span>Built with Beyond Notes</span></footer>
</body>
</html>`
}

export function sitePage(input: {
  siteTitle: string
  footer: string
  theme: ThemeName
  nav: SiteNavItem[]
  basePath: string
  title: string
  contentHtml: string
  rssPath?: string
}): string {
  return shell({
    ...input,
    body: `<h1>${escapeHtml(input.title)}</h1>${input.contentHtml}`,
  })
}

export function siteBlogIndex(input: {
  siteTitle: string
  footer: string
  theme: ThemeName
  nav: SiteNavItem[]
  basePath: string
  title: string
  introHtml: string
  posts: PostListItem[]
  rssPath: string
}): string {
  const list = input.posts
    .map(
      (p) =>
        `<div class="post"><span><a href="${escapeHtml(input.basePath + p.path)}">${escapeHtml(p.title)}</a>${
          p.snippet ? `<p class="snippet">${escapeHtml(p.snippet)}</p>` : ''
        }</span><span class="date">${escapeHtml(p.date)}</span></div>`,
    )
    .join('')
  const body = `<h1>${escapeHtml(input.title)}</h1>${input.introHtml}<div class="postlist">${list || '<p class="meta">No posts yet.</p>'}</div>`
  return shell({ ...input, body })
}

export function sitePost(input: {
  siteTitle: string
  footer: string
  theme: ThemeName
  nav: SiteNavItem[]
  basePath: string
  title: string
  date: string
  contentHtml: string
  blogPath: string
  blogTitle: string
  rssPath?: string
}): string {
  const body = `<a class="backlink" href="${escapeHtml(input.basePath + input.blogPath)}">← ${escapeHtml(input.blogTitle)}</a>
<h1>${escapeHtml(input.title)}</h1><p class="meta">${escapeHtml(input.date)}</p>${input.contentHtml}`
  return shell({ ...input, body })
}

export function site404(input: {
  siteTitle: string
  footer: string
  theme: ThemeName
  basePath: string
}): string {
  return shell({
    ...input,
    nav: [],
    title: 'Not found',
    body: '<h1>Not found</h1><p>This page does not exist or is not published.</p>',
  })
}

// ---- feeds ----

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function buildRss(input: {
  siteTitle: string
  siteUrl: string // absolute, no trailing slash
  description: string
  items: Array<{ title: string; path: string; date: Date; snippet: string }>
}): string {
  const items = input.items
    .map(
      (i) => `<item>
<title>${escapeXml(i.title)}</title>
<link>${escapeXml(input.siteUrl + i.path)}</link>
<guid>${escapeXml(input.siteUrl + i.path)}</guid>
<pubDate>${i.date.toUTCString()}</pubDate>
<description>${escapeXml(i.snippet)}</description>
</item>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escapeXml(input.siteTitle)}</title>
<link>${escapeXml(input.siteUrl)}</link>
<description>${escapeXml(input.description)}</description>
${items}
</channel></rss>`
}

export function buildSitemap(urls: string[]): string {
  const entries = urls.map((u) => `<url><loc>${escapeXml(u)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`
}
