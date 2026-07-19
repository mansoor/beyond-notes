import { escapeHtml } from './render'
import { type ThemeName, themeCss } from './themes'

export type SiteNavItem = {
  title: string
  path: string
  active?: boolean
  children?: SiteNavItem[]
}
export type PostListItem = { title: string; path: string; date: string; snippet: string }
export type Crumb = { title: string; path: string }
export type AlbumCard = { title: string; path: string; coverUrl: string | null; count: number }

const SITE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);font-size:16px;line-height:1.7}
header{display:flex;align-items:baseline;gap:22px;padding:20px 40px;max-width:820px;margin:0 auto;flex-wrap:wrap}
header .logo{font-weight:700;font-size:17px;color:var(--text);text-decoration:none;margin-right:auto}
header nav{display:flex;gap:16px;flex-wrap:wrap;align-items:baseline}
header nav a{color:var(--text2);text-decoration:none;font-size:14px}
header nav a.active{color:var(--text);font-weight:600}
.navitem{position:relative;display:inline-flex;align-items:baseline}
.navitem>a .caret{font-size:10px;color:var(--text3);margin-left:3px}
.dropdown{display:none;position:absolute;top:100%;left:-10px;background:var(--bg);
border:1px solid var(--border);border-radius:10px;padding:7px;min-width:190px;z-index:20;
box-shadow:0 8px 24px rgba(0,0,0,.12)}
.navitem:hover .dropdown,.navitem:focus-within .dropdown{display:block}
.dropdown a{display:block;padding:5px 10px;border-radius:6px;white-space:nowrap;
overflow:hidden;text-overflow:ellipsis;max-width:280px}
.dropdown a:hover{background:var(--code);color:var(--text)}
.dropdown a.lvl2{padding-left:26px;font-size:13px}
@media(max-width:640px){
header{padding:16px 20px}
header nav{flex-direction:column;gap:4px;width:100%;padding-top:6px}
.navitem{position:static}
.navitem>a .caret{display:none}
.dropdown{display:block;position:static;border:0;box-shadow:none;padding:0 0 2px 16px;min-width:0}
main{padding:20px 20px 50px}
}
.crumbs{font-size:13px;color:var(--text3);margin-bottom:14px}
.crumbs a{color:var(--text3);text-decoration:none}
.crumbs a:hover{color:var(--accent)}
.crumbs .sep{margin:0 6px;opacity:.6}
.sectionlist{margin-top:30px;border-top:1px solid var(--border);padding-top:14px}
.sectionlist h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin:0 0 6px}
.sectionlist a{display:block;padding:5px 0;font-size:15px;color:var(--text);text-decoration:none;font-weight:500}
.sectionlist a:hover{color:var(--accent)}
.albums{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:20px 0}
.albums .album{display:block;text-decoration:none;color:var(--text)}
.albums .cover{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;display:block;
background:var(--code);border:1px solid var(--border)}
.albums .cover.empty{display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:24px}
.albums .name{font-weight:600;font-size:15px;margin-top:7px}
.albums .n{color:var(--text3);font-size:12px}
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
main figure{margin:14px 0}
main figure img{max-width:100%;border-radius:10px}
main figcaption{font-size:13px;color:var(--text3);margin-top:4px}
main .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:18px 0}
main .gallery .cell{display:block;text-decoration:none}
main .gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block}
main .gallery .cap{font-size:12px;color:var(--text3)}
footer{border-top:1px solid var(--border);padding:16px 40px;font-size:12px;color:var(--text3);
display:flex;justify-content:space-between;max-width:820px;margin:0 auto}
`

/** Dropdown panel body: the subtree as one indented list — no nested flyouts.
 *  Depth is capped at two levels inside the panel; deeper pages are reached
 *  via breadcrumbs and section lists. */
function dropdownLinks(items: SiteNavItem[], basePath: string, depth: number): string {
  if (depth > 2) return ''
  return items
    .map(
      (n) =>
        `<a class="lvl${depth}${n.active ? ' active' : ''}" href="${escapeHtml(basePath + n.path)}">${escapeHtml(n.title)}</a>${
          n.children?.length ? dropdownLinks(n.children, basePath, depth + 1) : ''
        }`,
    )
    .join('')
}

function navHtml(nav: SiteNavItem[], basePath: string): string {
  return nav
    .map((n) => {
      const link = `<a href="${escapeHtml(basePath + n.path)}"${n.active ? ' class="active"' : ''}>${escapeHtml(n.title)}${
        n.children?.length ? '<span class="caret">▾</span>' : ''
      }</a>`
      if (!n.children?.length) return link
      return `<div class="navitem">${link}<div class="dropdown">${dropdownLinks(n.children, basePath, 1)}</div></div>`
    })
    .join('')
}

/** Breadcrumb trail for pages below the root level. */
export function crumbsHtml(crumbs: Crumb[], basePath: string): string {
  if (crumbs.length === 0) return ''
  const parts = crumbs.map(
    (c) => `<a href="${escapeHtml(basePath + c.path)}">${escapeHtml(c.title)}</a>`,
  )
  return `<nav class="crumbs">${parts.join('<span class="sep">/</span>')}</nav>`
}

/** "In this section": structural children listed at the end of a page. */
export function sectionListHtml(children: Crumb[], basePath: string): string {
  if (children.length === 0) return ''
  const links = children
    .map((c) => `<a href="${escapeHtml(basePath + c.path)}">${escapeHtml(c.title)} →</a>`)
    .join('')
  return `<div class="sectionlist"><h2>In this section</h2>${links}</div>`
}

/** Album cards for a gallery's child galleries, covers from their published grids. */
export function albumCardsHtml(cards: AlbumCard[], basePath: string): string {
  if (cards.length === 0) return ''
  const cells = cards
    .map(
      (c) =>
        `<a class="album" href="${escapeHtml(basePath + c.path)}">${
          c.coverUrl
            ? `<img class="cover" src="${escapeHtml(c.coverUrl)}" alt="${escapeHtml(c.title)}" loading="lazy">`
            : '<span class="cover empty">🖼</span>'
        }<span class="name">${escapeHtml(c.title)}</span> <span class="n">${c.count} photo${c.count === 1 ? '' : 's'}</span></a>`,
    )
    .join('')
  return `<div class="albums">${cells}</div>`
}

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
  const nav = navHtml(input.nav, input.basePath)
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
  crumbs?: Crumb[]
  rssPath?: string
}): string {
  return shell({
    ...input,
    body: `${crumbsHtml(input.crumbs ?? [], input.basePath)}<h1>${escapeHtml(input.title)}</h1>${input.contentHtml}`,
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
  crumbs?: Crumb[]
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
  const body = `${crumbsHtml(input.crumbs ?? [], input.basePath)}<h1>${escapeHtml(input.title)}</h1>${input.introHtml}<div class="postlist">${list || '<p class="meta">No posts yet.</p>'}</div>`
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
