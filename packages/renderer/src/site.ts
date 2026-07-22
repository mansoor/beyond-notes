import { CHROME_JS, GALLERY_CSS, type SocialLink, socialLinksHtml } from './chrome'
import { escapeHtml } from './render'
import { type ThemeAppearance, type ThemeName, themeCss } from './themes'

export type SiteNavItem = {
  title: string
  path: string
  active?: boolean
  /** a Material Symbols name or emoji, shown before the title in the menu */
  icon?: string | null
  children?: SiteNavItem[]
}

// a Material Symbols ligature name vs a literal emoji
const MATERIAL_NAME = /^[a-z0-9_]+$/
const iconSpan = (icon?: string | null): string =>
  icon
    ? `<span class="ico${MATERIAL_NAME.test(icon) ? ' msym' : ''}">${escapeHtml(icon)}</span>`
    : ''

function siteNavHasMaterialIcon(nav: SiteNavItem[]): boolean {
  return nav.some(
    (n) => (n.icon && MATERIAL_NAME.test(n.icon)) || siteNavHasMaterialIcon(n.children ?? []),
  )
}

/** Material Symbols @font-face, injected only when the nav uses a named icon. */
const MATERIAL_CSS = `
@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:100 700;
font-display:block;src:url('/api/assets/material-symbols.woff2') format('woff2')}
.ico.msym{font-family:'Material Symbols Outlined';font-weight:normal;font-size:1.1em;
line-height:1;font-feature-settings:'liga';-webkit-font-smoothing:antialiased}
`
export type PostListItem = {
  title: string
  path: string
  date: string
  snippet: string
  cover?: string | null
}
export type Crumb = { title: string; path: string }
/** SEO head block: emitted only for real content pages. Urls must be absolute. */
export type SiteMeta = {
  description?: string | null
  ogImage?: string | null
  url?: string | null
  type?: 'website' | 'article'
  noindex?: boolean
}
export type AlbumCard = { title: string; path: string; coverUrl: string | null; count: number }

const SITE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
/* one shared column so header, content and footer line up on both edges — the
   header and footer used to run ~260px wider than the 880px content and jut out */
:root{--site-w:960px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);font-size:16px;line-height:1.7}
header{padding:18px 40px;max-width:var(--site-w);margin:0 auto}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--text)}
.brand img{height:44px;width:auto;border-radius:8px;display:block}
.brand .bt{display:flex;flex-direction:column}
.brand .title{font-weight:700;font-size:17px;line-height:1.25}
.brand .tagline{font-size:12.5px;color:var(--text3)}
header nav{display:flex;gap:16px;flex-wrap:wrap;align-items:baseline}
.hl-classic{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.hl-classic .brand{margin-right:auto}
.hl-split{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.hl-split nav{margin-left:auto;margin-right:auto}
.hl-centered .brand{justify-content:center;text-align:center;margin-bottom:14px}
.hl-centered .navrow{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.hl-centered .navrow .tail{margin-left:auto;display:flex;align-items:center;gap:14px}
.hl-minimal{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.tail{display:flex;align-items:center;gap:14px}
header nav a{color:var(--text2);text-decoration:none;font-size:14px}
header nav a.active{color:var(--text);font-weight:600}
.ico{display:inline-flex;align-items:center;vertical-align:-.15em;margin-right:5px}
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
footer{padding:16px 20px}
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
main{max-width:var(--site-w);margin:0 auto;padding:26px 40px 60px}
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
main .table-wrap{overflow-x:auto;margin:14px 0}
main table{border-collapse:collapse;width:100%;font-size:14px}
main th,main td{border:1px solid var(--border);padding:7px 11px;text-align:left;vertical-align:top}
main thead th{background:var(--code);font-weight:600}
main a{color:var(--accent)}
.meta{color:var(--text3);font-size:13px;margin-bottom:18px}
.postlist{margin-top:18px}
.postlist .post{display:flex;justify-content:space-between;align-items:center;gap:16px;
padding:13px 0;border-top:1px solid var(--border)}
.postlist .postcover{flex:0 0 92px}
.postlist .postcover img{width:92px;height:64px;object-fit:cover;border-radius:8px;display:block}
.postlist .post>span:not(.date){flex:1;min-width:0}
.postlist .post a{font-size:17px;font-weight:600;color:var(--text);text-decoration:none}
.postlist .post a:hover{color:var(--accent)}
.postlist .date{color:var(--text3);font-size:13px;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}
.postlist .snippet{color:var(--text2);font-size:14px;margin:2px 0 0}
.backlink{display:inline-block;margin-bottom:14px;font-size:13px;color:var(--text3);text-decoration:none}
.tagrow{margin:6px 0 14px;display:flex;gap:8px;flex-wrap:wrap}
.tagrow a{font-size:12.5px;color:var(--accent);text-decoration:none;background:var(--code);
border-radius:999px;padding:2px 10px}
.pagenav{display:flex;justify-content:space-between;margin-top:22px;font-size:14px}
.pagenav a{color:var(--accent);text-decoration:none}
.pagenav .pn{color:var(--text3)}
main figure{margin:14px 0}
main figure img{max-width:100%;border-radius:10px}
main figcaption{font-size:13px;color:var(--text3);margin-top:4px}
footer{border-top:1px solid var(--border);padding:16px 40px;font-size:12px;color:var(--text3);
display:flex;justify-content:space-between;max-width:var(--site-w);margin:0 auto}
`

/** Dropdown panel body: the subtree as one indented list — no nested flyouts.
 *  Depth is capped at two levels inside the panel; deeper pages are reached
 *  via breadcrumbs and section lists. */
function dropdownLinks(items: SiteNavItem[], basePath: string, depth: number): string {
  if (depth > 2) return ''
  return items
    .map(
      (n) =>
        `<a class="lvl${depth}${n.active ? ' active' : ''}" href="${escapeHtml(basePath + n.path)}">${iconSpan(n.icon)}${escapeHtml(n.title)}</a>${
          n.children?.length ? dropdownLinks(n.children, basePath, depth + 1) : ''
        }`,
    )
    .join('')
}

function navHtml(nav: SiteNavItem[], basePath: string): string {
  return nav
    .map((n) => {
      const link = `<a href="${escapeHtml(basePath + n.path)}"${n.active ? ' class="active"' : ''}>${iconSpan(n.icon)}${escapeHtml(n.title)}${
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

function metaHtml(title: string, siteTitle: string, meta?: SiteMeta): string {
  if (!meta) return ''
  const lines: string[] = []
  if (meta.noindex) lines.push('<meta name="robots" content="noindex">')
  if (meta.description) {
    lines.push(`<meta name="description" content="${escapeHtml(meta.description)}">`)
    lines.push(`<meta property="og:description" content="${escapeHtml(meta.description)}">`)
  }
  lines.push(`<meta property="og:title" content="${escapeHtml(title)}">`)
  lines.push(`<meta property="og:site_name" content="${escapeHtml(siteTitle)}">`)
  lines.push(`<meta property="og:type" content="${meta.type ?? 'website'}">`)
  if (meta.url) {
    lines.push(`<meta property="og:url" content="${escapeHtml(meta.url)}">`)
    lines.push(`<link rel="canonical" href="${escapeHtml(meta.url)}">`)
  }
  if (meta.ogImage) {
    lines.push(`<meta property="og:image" content="${escapeHtml(meta.ogImage)}">`)
    lines.push('<meta name="twitter:card" content="summary_large_image">')
  }
  return lines.join('\n')
}

function shell(input: {
  siteTitle: string
  footer: string
  title: string
  theme: ThemeName
  appearance?: ThemeAppearance
  nav: SiteNavItem[]
  basePath: string
  body: string
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  rssPath?: string
  meta?: SiteMeta
  faviconUrl?: string | null
}): string {
  const nav = navHtml(input.nav, input.basePath)
  const socials = socialLinksHtml(input.socials ?? [])
  const brand = `<a class="brand" href="${escapeHtml(input.basePath || '/')}">${
    input.logoUrl
      ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(input.siteTitle)}">`
      : ''
  }<span class="bt"><span class="title">${escapeHtml(input.siteTitle)}</span>${
    input.tagline ? `<span class="tagline">${escapeHtml(input.tagline)}</span>` : ''
  }</span></a>`
  const search = `<form class="sitesearch" action="${escapeHtml(`${input.basePath}/_search`)}" method="get"><input type="search" name="q" placeholder="Search"></form>`
  const tail = `<span class="tail">${socials}${search}</span>`
  const layout = input.headerLayout ?? 'classic'
  const header =
    layout === 'centered'
      ? `<header class="hl-centered">${brand}<div class="navrow"><nav>${nav}</nav>${tail}</div></header>`
      : layout === 'split'
        ? `<header class="hl-split">${brand}<nav>${nav}</nav>${tail}</header>`
        : layout === 'minimal'
          ? `<header class="hl-minimal">${brand}<nav>${nav}</nav>${tail}</header>`
          : `<header class="hl-classic">${brand}<nav>${nav}</nav>${tail}</header>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} — ${escapeHtml(input.siteTitle)}</title>
${metaHtml(input.title, input.siteTitle, input.meta)}${
  input.faviconUrl ? `<link rel="icon" href="${escapeHtml(input.faviconUrl)}">` : ''
}
${input.rssPath ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(input.siteTitle)}" href="${escapeHtml(input.basePath + input.rssPath)}">` : ''}
<style>${themeCss(input.theme, input.appearance ?? 'auto')}${SITE_CSS}${GALLERY_CSS}${siteNavHasMaterialIcon(input.nav) ? MATERIAL_CSS : ''}</style>
</head>
<body data-appearance="${input.appearance ?? 'auto'}">
${header}
<main>
${input.body}
</main>
<footer><span>${escapeHtml(input.footer)}</span><span>Built with Beyond Notes</span></footer>
<script>${CHROME_JS}</script>
</body>
</html>`
}

export function sitePage(input: {
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  siteTitle: string
  footer: string
  theme: ThemeName
  appearance?: ThemeAppearance
  nav: SiteNavItem[]
  basePath: string
  title: string
  contentHtml: string
  crumbs?: Crumb[]
  rssPath?: string
  meta?: SiteMeta
  faviconUrl?: string | null
}): string {
  return shell({
    ...input,
    body: `${crumbsHtml(input.crumbs ?? [], input.basePath)}<h1>${escapeHtml(input.title)}</h1>${input.contentHtml}`,
  })
}

export function siteBlogIndex(input: {
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  siteTitle: string
  footer: string
  theme: ThemeName
  appearance?: ThemeAppearance
  nav: SiteNavItem[]
  basePath: string
  title: string
  introHtml: string
  posts: PostListItem[]
  crumbs?: Crumb[]
  rssPath: string
  meta?: SiteMeta
  faviconUrl?: string | null
  /** present when the list spans multiple pages; blogPath builds ?page= links */
  pagination?: { page: number; totalPages: number; blogPath: string }
}): string {
  const list = input.posts
    .map(
      (p) =>
        `<div class="post">${
          p.cover
            ? `<a class="postcover" href="${escapeHtml(input.basePath + p.path)}"><img src="${escapeHtml(p.cover)}" alt="" loading="lazy"></a>`
            : ''
        }<span><a href="${escapeHtml(input.basePath + p.path)}">${escapeHtml(p.title)}</a>${
          p.snippet ? `<p class="snippet">${escapeHtml(p.snippet)}</p>` : ''
        }</span><span class="date">${escapeHtml(p.date)}</span></div>`,
    )
    .join('')
  const pg = input.pagination
  const pageHref = (n: number) =>
    `${input.basePath}${pg?.blogPath ?? ''}${n > 1 ? `?page=${n}` : ''}`
  const pager =
    pg && pg.totalPages > 1
      ? `<div class="pagenav"><span>${
          pg.page > 1 ? `<a href="${escapeHtml(pageHref(pg.page - 1))}">← Newer</a>` : ''
        }</span><span class="pn">Page ${pg.page} of ${pg.totalPages}</span><span>${
          pg.page < pg.totalPages
            ? `<a href="${escapeHtml(pageHref(pg.page + 1))}">Older →</a>`
            : ''
        }</span></div>`
      : ''
  const body = `${crumbsHtml(input.crumbs ?? [], input.basePath)}<h1>${escapeHtml(input.title)}</h1>${input.introHtml}<div class="postlist">${list || '<p class="meta">No posts yet.</p>'}</div>${pager}`
  return shell({ ...input, body })
}

export function sitePost(input: {
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  siteTitle: string
  footer: string
  theme: ThemeName
  appearance?: ThemeAppearance
  nav: SiteNavItem[]
  basePath: string
  title: string
  date: string
  contentHtml: string
  blogPath: string
  blogTitle: string
  rssPath?: string
  meta?: SiteMeta
  faviconUrl?: string | null
  tags?: string[]
}): string {
  const tagRow = input.tags?.length
    ? `<div class="tagrow">${input.tags
        .map((t) => `<a href="${escapeHtml(`${input.basePath}/tags/${t}`)}">#${escapeHtml(t)}</a>`)
        .join('')}</div>`
    : ''
  const body = `<a class="backlink" href="${escapeHtml(input.basePath + input.blogPath)}">← ${escapeHtml(input.blogTitle)}</a>
<h1>${escapeHtml(input.title)}</h1><p class="meta">${escapeHtml(input.date)}</p>${tagRow}${input.contentHtml}`
  return shell({ ...input, body })
}

/** /tags/<tag>: every live page carrying the tag. */
export function siteTagPage(input: {
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  siteTitle: string
  footer: string
  theme: ThemeName
  appearance?: ThemeAppearance
  nav: SiteNavItem[]
  basePath: string
  faviconUrl?: string | null
  tag: string
  items: Array<{ title: string; path: string; snippet: string }>
}): string {
  const list =
    input.items.length === 0
      ? '<p class="meta">Nothing carries this tag.</p>'
      : `<div class="postlist">${input.items
          .map(
            (r) =>
              `<div class="post"><span><a href="${escapeHtml(input.basePath + r.path)}">${escapeHtml(r.title)}</a>${
                r.snippet ? `<p class="snippet">${escapeHtml(r.snippet)}</p>` : ''
              }</span></div>`,
          )
          .join('')}</div>`
  return shell({
    ...input,
    title: `#${input.tag}`,
    body: `<h1>#${escapeHtml(input.tag)}</h1>${list}`,
  })
}

export function siteSearchResults(input: {
  siteTitle: string
  footer: string
  theme: ThemeName
  appearance?: ThemeAppearance
  nav: SiteNavItem[]
  basePath: string
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  query: string
  results: Array<{ title: string; path: string; snippet: string }>
}): string {
  const list =
    input.results.length === 0
      ? `<p class="meta">${input.query ? 'No results.' : 'Type something to search.'}</p>`
      : `<div class="postlist">${input.results
          .map(
            (r) =>
              `<div class="post"><span><a href="${escapeHtml(input.basePath + r.path)}">${escapeHtml(r.title)}</a><p class="snippet">${escapeHtml(r.snippet)}</p></span></div>`,
          )
          .join('')}</div>`
  return shell({
    ...input,
    title: `Search: ${input.query}`,
    body: `<h1>Search${input.query ? `: ${escapeHtml(input.query)}` : ''}</h1>${list}`,
  })
}

export function site404(input: {
  siteTitle: string
  footer: string
  theme: ThemeName
  appearance?: ThemeAppearance
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
