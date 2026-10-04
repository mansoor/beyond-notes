import {
  APPEARANCE_CSS,
  APPEARANCE_JS,
  APPEARANCE_RESTORE_JS,
  CHROME_JS,
  CREDIT_HTML,
  GALLERY_CSS,
  type SocialLink,
  appearanceToggleHtml,
  socialLinksHtml,
} from './chrome'
import { escapeHtml } from './render'
import { slugify } from './slug'
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
  category?: string | null
}
/** A blog page shows its posts as a dated list or as cover-led cards. */
export type BlogLayout = 'list' | 'grid'
export type Crumb = { title: string; path: string }
/** SEO head block: emitted only for real content pages. Urls must be absolute. */
export type SiteMeta = {
  description?: string | null
  ogImage?: string | null
  url?: string | null
  type?: 'website' | 'article'
  noindex?: boolean
}
export type AlbumCard = {
  title: string
  path: string
  coverUrl: string | null
  count: number
  category?: string | null
}

/** Categories are matched in URLs by their slug, never by their raw name. */
export const categorySlug = (name: string): string => slugify(name)

const SITE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
/* one shared column so header, content and footer line up on both edges — the
   header and footer used to run ~260px wider than the 880px content and jut out */
:root{--site-w:960px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);font-size:16px;line-height:1.7}
/* The header is a band, closed by a hairline the way the footer is opened by
   one. Before this the rhythm ran 18 / 14 / 44: the nav sat closer to the
   tagline than to anything else, and then a large unexplained gap separated it
   from the page. Air above the brand, room under the nav, and a rule to say
   where the chrome stops. */
header{padding:26px 40px 15px;max-width:var(--site-w);margin:0 auto;
border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--text)}
/* the two branding sizes are variables so one <style> line per site sets them,
   and everything around them (tagline, gap) stays in proportion */
.brand img{height:var(--logo-h,44px);width:auto;border-radius:8px;display:block}
.brand .bt{display:flex;flex-direction:column}
.brand .title{font-weight:700;font-size:var(--title-size,17px);line-height:1.25}
.brand .tagline{font-size:12.5px;color:var(--text3)}
header nav{display:flex;gap:16px;flex-wrap:wrap;align-items:baseline}
.hl-classic{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.hl-classic .brand{margin-right:auto}
.hl-split{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.hl-split nav{margin-left:auto;margin-right:auto}
/* the nav is its own row here, so it needs to sit clear of the tagline rather
   than tucked under it */
.hl-centered .brand{justify-content:center;text-align:center;margin-bottom:20px}
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
.albums .cat{margin-top:7px}
main{max-width:var(--site-w);margin:0 auto;padding:32px 40px 60px}
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
/* category: a label on the item, and a filter row above the list. The chips
   are the only way to reach ?category= — nothing else links to a filtered
   view, so a category with no chip would be unreachable. */
.cat{display:inline-block;font-size:11.5px;letter-spacing:.03em;text-transform:uppercase;
color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:1px 9px;
text-decoration:none}
.postlist .cat{margin-bottom:3px}
.cfilter{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 4px}
.cfilter a{font-size:13px;color:var(--text2);text-decoration:none;border:1px solid var(--border);
border-radius:999px;padding:3px 12px}
.cfilter a:hover{color:var(--text)}
.cfilter a.on{background:var(--accent);border-color:var(--accent);color:#fff}
.postgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:22px;margin-top:20px}
.postgrid .pcard{display:flex;flex-direction:column;gap:5px;text-decoration:none;color:var(--text)}
.postgrid .pcover{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:12px;display:block;
background:var(--code);border:1px solid var(--border)}
.postgrid .pcover.empty{display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:22px}
/* the card is a flex column, so the chip would stretch edge to edge without this */
.postgrid .cat{align-self:flex-start}
.postgrid .ptitle{font-size:16.5px;font-weight:600;line-height:1.35}
.postgrid .pcard:hover .ptitle{color:var(--accent)}
.postgrid .pdate{color:var(--text3);font-size:12.5px;font-family:ui-monospace,Consolas,monospace}
.postgrid .psnip{color:var(--text2);font-size:13.5px;margin:0}
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
/* the two mobile controls — a search icon and a hamburger — are desktop-hidden
   and only surface under the media query below */
.navtoggle,.searchtoggle{display:none;border:0;background:none;color:var(--text2);
cursor:pointer;font-size:22px;line-height:1;padding:2px 6px;align-items:center}
.navtoggle:hover,.searchtoggle:hover{color:var(--text)}
/* Last, so it actually overrides. This block used to sit above the main rule
   and lost to it on equal specificity: phones kept main's 40px side padding
   while the header dropped to 20px, so the content hung past the chrome. */
@media(max-width:640px){
/* One row for every configured layout: hamburger far left, the brand (kept in
   its style's own alignment), search icon on the right. The menu opens as a
   left drawer; the search field hides behind its icon and expands across the
   middle of the header when tapped. Targeting the .hl-* classes (not the bare
   header element) so the grid beats the base per-layout flex rules on specificity. */
.hl-classic,.hl-split,.hl-minimal,.hl-centered{display:grid;
grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:12px 14px;position:relative}
.hl-centered .navrow{display:contents}
.navtoggle{display:inline-flex;grid-column:1;justify-self:start}
.brand{grid-column:2;min-width:0;margin:0}
.brand .title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hl-classic .brand,.hl-split .brand{justify-self:start}
.hl-centered .brand,.hl-minimal .brand{justify-self:center;flex-direction:row;
justify-content:center;text-align:center;margin-bottom:0}
.tail{grid-column:3;justify-self:end;gap:6px}
.searchtoggle{display:inline-flex}
/* nav → off-canvas left drawer */
header nav{display:flex;flex-direction:column;gap:2px;align-items:stretch;
position:fixed;top:0;left:0;bottom:0;width:82vw;max-width:300px;z-index:50;
background:var(--bg);border-right:1px solid var(--border);padding:56px 16px 22px;
overflow-y:auto;transform:translateX(-100%);transition:transform .2s ease}
header nav a{padding:8px 4px}
body.bn-nav-open header nav{transform:translateX(0);box-shadow:0 0 40px rgba(0,0,0,.35)}
body.bn-nav-open::after{content:'';position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.4)}
.navitem{position:static}
.navitem>a .caret{display:none}
.dropdown{display:block;position:static;border:0;box-shadow:none;padding:2px 0 2px 16px;
min-width:0;background:none}
/* search → icon; the field expands across the middle of the header row */
.sitesearch{display:none}
body.bn-search-open .sitesearch{display:block;position:absolute;left:48px;right:44px;
top:50%;transform:translateY(-50%);z-index:26}
body.bn-search-open .sitesearch input{width:100%}
body.bn-search-open .brand{visibility:hidden}
main{padding:24px 18px 50px}
footer{padding:16px 18px}
}
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
        }<span class="name">${escapeHtml(c.title)}</span> <span class="n">${c.count} photo${c.count === 1 ? '' : 's'}</span>${
          c.category ? `<span class="cat">${escapeHtml(c.category)}</span>` : ''
        }</a>`,
    )
    .join('')
  return `<div class="albums">${cells}</div>`
}

/**
 * The chips that narrow a blog index or a gallery to one category. `active` is
 * a slug (what the URL carries); the names keep their original spelling.
 */
export function categoryFilterHtml(input: {
  categories: string[]
  active: string | null
  basePath: string
  path: string
}): string {
  if (input.categories.length === 0) return ''
  const href = (slug: string | null) =>
    `${input.basePath}${input.path}${slug ? `?category=${encodeURIComponent(slug)}` : ''}`
  const chip = (label: string, slug: string | null) =>
    `<a class="${slug === input.active ? 'on' : ''}" href="${escapeHtml(href(slug))}">${escapeHtml(label)}</a>`
  return `<div class="cfilter">${chip('All', null)}${input.categories
    .map((c) => chip(c, categorySlug(c)))
    .join('')}</div>`
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

/**
 * One line of CSS for the site's own branding sizes. Emitted only when a site
 * asked for something other than the defaults, so an untouched site keeps the
 * exact stylesheet it had. Both are clamped: a "logo" 400px tall is a banner,
 * and the header has no answer for it.
 */
function brandingCss(titlePx?: number, logoPx?: number): string {
  const parts: string[] = []
  if (titlePx) parts.push(`--title-size:${Math.min(Math.max(Math.round(titlePx), 12), 40)}px`)
  if (logoPx) parts.push(`--logo-h:${Math.min(Math.max(Math.round(logoPx), 16), 96)}px`)
  return parts.length ? `\n:root{${parts.join(';')}}` : ''
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
  /** wordmark size and logo height in px; see SITE_TITLE_PX / SITE_LOGO_PX */
  titlePx?: number
  logoPx?: number
  rssPath?: string
  meta?: SiteMeta
  faviconUrl?: string | null
  /** a full-width bar rendered above the header (e.g. the draft-preview notice) */
  banner?: string
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
  const toggle = (input.appearance ?? 'auto') === 'toggle' ? appearanceToggleHtml() : ''
  // mobile-only affordances (CSS hides them on desktop): a search icon that
  // expands the field, and — when there's a menu — a hamburger for the nav. The
  // hamburger leads the header (far left); the search icon rides the tail.
  const searchToggle = '<button type="button" class="searchtoggle" aria-label="Search">⌕</button>'
  const navToggle = input.nav.length
    ? '<button type="button" class="navtoggle" aria-label="Menu">☰</button>'
    : ''
  const tail = `<span class="tail">${searchToggle}${socials}${search}${toggle}</span>`
  const layout = input.headerLayout ?? 'classic'
  const header =
    layout === 'centered'
      ? `<header class="hl-centered">${navToggle}${brand}<div class="navrow"><nav>${nav}</nav>${tail}</div></header>`
      : layout === 'split'
        ? `<header class="hl-split">${navToggle}${brand}<nav>${nav}</nav>${tail}</header>`
        : layout === 'minimal'
          ? `<header class="hl-minimal">${navToggle}${brand}<nav>${nav}</nav>${tail}</header>`
          : `<header class="hl-classic">${navToggle}${brand}<nav>${nav}</nav>${tail}</header>`
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
<style>${themeCss(input.theme, input.appearance ?? 'auto')}${SITE_CSS}${GALLERY_CSS}${brandingCss(input.titlePx, input.logoPx)}${(input.appearance ?? 'auto') === 'toggle' ? APPEARANCE_CSS : ''}${siteNavHasMaterialIcon(input.nav) ? MATERIAL_CSS : ''}</style>
${(input.appearance ?? 'auto') === 'toggle' ? `<script>${APPEARANCE_RESTORE_JS}</script>` : ''}
</head>
<body data-appearance="${input.appearance ?? 'auto'}">
${input.banner ?? ''}
${header}
<main>
${input.body}
</main>
<footer><span>${escapeHtml(input.footer)}</span>${CREDIT_HTML}</footer>
<script>${CHROME_JS}${(input.appearance ?? 'auto') === 'toggle' ? APPEARANCE_JS : ''}</script>
</body>
</html>`
}

export function sitePage(input: {
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  /** wordmark size and logo height in px; see SITE_TITLE_PX / SITE_LOGO_PX */
  titlePx?: number
  logoPx?: number
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
  banner?: string
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
  /** wordmark size and logo height in px; see SITE_TITLE_PX / SITE_LOGO_PX */
  titlePx?: number
  logoPx?: number
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
  layout?: BlogLayout
  /** every category used by the blog's posts — the chips, unfiltered */
  categories?: string[]
  /** the slug currently filtered on, or null for everything */
  activeCategory?: string | null
  /** present when the list spans multiple pages; blogPath builds ?page= links */
  pagination?: { page: number; totalPages: number; blogPath: string }
}): string {
  const catTag = (p: PostListItem) =>
    p.category ? `<span class="cat">${escapeHtml(p.category)}</span>` : ''
  const rows = input.posts
    .map(
      (p) =>
        `<div class="post">${
          p.cover
            ? `<a class="postcover" href="${escapeHtml(input.basePath + p.path)}"><img src="${escapeHtml(p.cover)}" alt="" loading="lazy"></a>`
            : ''
        }<span>${catTag(p)}<a href="${escapeHtml(input.basePath + p.path)}">${escapeHtml(p.title)}</a>${
          p.snippet ? `<p class="snippet">${escapeHtml(p.snippet)}</p>` : ''
        }</span><span class="date">${escapeHtml(p.date)}</span></div>`,
    )
    .join('')
  const cards = input.posts
    .map(
      (p) =>
        `<a class="pcard" href="${escapeHtml(input.basePath + p.path)}">${
          p.cover
            ? `<img class="pcover" src="${escapeHtml(p.cover)}" alt="" loading="lazy">`
            : '<span class="pcover empty">✎</span>'
        }${catTag(p)}<span class="ptitle">${escapeHtml(p.title)}</span><span class="pdate">${escapeHtml(
          p.date,
        )}</span>${p.snippet ? `<p class="psnip">${escapeHtml(p.snippet)}</p>` : ''}</a>`,
    )
    .join('')
  const list =
    input.posts.length === 0
      ? `<div class="postlist"><p class="meta">${
          input.activeCategory ? 'No posts in this category.' : 'No posts yet.'
        }</p></div>`
      : input.layout === 'grid'
        ? `<div class="postgrid">${cards}</div>`
        : `<div class="postlist">${rows}</div>`
  const filter = categoryFilterHtml({
    categories: input.categories ?? [],
    active: input.activeCategory ?? null,
    basePath: input.basePath,
    path: input.pagination?.blogPath ?? '',
  })
  const pg = input.pagination
  // page links have to carry the filter, or paging past page 1 silently drops
  // back to every post
  const pageHref = (n: number) => {
    const params = new URLSearchParams()
    if (input.activeCategory) params.set('category', input.activeCategory)
    if (n > 1) params.set('page', String(n))
    const qs = params.toString()
    return `${input.basePath}${pg?.blogPath ?? ''}${qs ? `?${qs}` : ''}`
  }
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
  const body = `${crumbsHtml(input.crumbs ?? [], input.basePath)}<h1>${escapeHtml(input.title)}</h1>${input.introHtml}${filter}${list}${pager}`
  return shell({ ...input, body })
}

export function sitePost(input: {
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  /** wordmark size and logo height in px; see SITE_TITLE_PX / SITE_LOGO_PX */
  titlePx?: number
  logoPx?: number
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
  category?: string | null
}): string {
  const tagRow = input.tags?.length
    ? `<div class="tagrow">${input.tags
        .map((t) => `<a href="${escapeHtml(`${input.basePath}/tags/${t}`)}">#${escapeHtml(t)}</a>`)
        .join('')}</div>`
    : ''
  // the category leads back to the index filtered on it — the sibling posts
  const catLink = input.category
    ? `<a class="cat" href="${escapeHtml(
        `${input.basePath}${input.blogPath}?category=${encodeURIComponent(categorySlug(input.category))}`,
      )}">${escapeHtml(input.category)}</a> `
    : ''
  const body = `<a class="backlink" href="${escapeHtml(input.basePath + input.blogPath)}">← ${escapeHtml(input.blogTitle)}</a>
<h1>${escapeHtml(input.title)}</h1><p class="meta">${catLink}${escapeHtml(input.date)}</p>${tagRow}${input.contentHtml}`
  return shell({ ...input, body })
}

/** /tags/<tag>: every live page carrying the tag. */
export function siteTagPage(input: {
  socials?: SocialLink[]
  logoUrl?: string | null
  tagline?: string | null
  headerLayout?: 'classic' | 'centered' | 'split' | 'minimal'
  /** wordmark size and logo height in px; see SITE_TITLE_PX / SITE_LOGO_PX */
  titlePx?: number
  logoPx?: number
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
  /** wordmark size and logo height in px; see SITE_TITLE_PX / SITE_LOGO_PX */
  titlePx?: number
  logoPx?: number
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

/**
 * The holding page a published site shows while it is in maintenance mode.
 * Deliberately standalone — no header, no nav, no links — so it leaks none of
 * the site's structure while it is closed. Themed with the site's own palette
 * so it still looks like the site, and served with a 503 so crawlers know to
 * come back rather than drop the URL.
 */
export function maintenancePage(input: {
  siteTitle: string
  message?: string | null
  theme: ThemeName
  appearance?: ThemeAppearance
  faviconUrl?: string | null
  socials?: SocialLink[]
}): string {
  const message =
    input.message?.trim() ||
    'This site is undergoing maintenance and will be back shortly. Please check back later.'
  // the same social row the site header uses; its .socials CSS is inlined below
  // because this page is standalone and does not pull in the site stylesheet
  const socials = socialLinksHtml(input.socials ?? [])
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(input.siteTitle)} — under maintenance</title>${
    input.faviconUrl ? `\n<link rel="icon" href="${escapeHtml(input.faviconUrl)}">` : ''
  }
<style>${themeCss(input.theme, input.appearance ?? 'auto')}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);margin:0;min-height:100vh;
display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.card{max-width:30rem;text-align:center}
.icon{font-size:44px;line-height:1;margin-bottom:14px}
h1{font-size:22px;margin:0 0 10px}
p{font-size:16px;line-height:1.7;color:var(--text2);margin:0}
.site{font-size:13px;color:var(--text3);margin-top:22px}
.socials{display:flex;gap:14px;align-items:center;justify-content:center;margin-top:16px}
.socials a{display:flex;color:var(--text3)}
.socials a:hover{color:var(--accent)}
.socials svg{width:19px;height:19px;fill:currentColor}</style>
</head>
<body>
<div class="card">
<div class="icon">🛠️</div>
<h1>Back soon</h1>
<p>${escapeHtml(message)}</p>
<div class="site">${escapeHtml(input.siteTitle)}</div>
${socials}
</div>
</body>
</html>`
}

/**
 * A small standalone page in a site's theme, for answers that aren't content:
 * "you're subscribed", "you're unsubscribed". `html` is trusted markup; the
 * caller escapes anything it puts there.
 */
export function noticePage(input: {
  siteTitle: string
  theme: ThemeName
  appearance?: ThemeAppearance
  faviconUrl?: string | null
  heading: string
  html: string
  /** "Back to <site>" link target, when there is a site to go back to */
  homeUrl?: string | null
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(input.heading)} — ${escapeHtml(input.siteTitle)}</title>${
    input.faviconUrl ? `\n<link rel="icon" href="${escapeHtml(input.faviconUrl)}">` : ''
  }
<style>${themeCss(input.theme, input.appearance === 'toggle' ? 'auto' : (input.appearance ?? 'auto'))}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);margin:0;min-height:100vh;
display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
.card{width:100%;max-width:28rem;background:var(--panel);border:1px solid var(--border);
border-radius:14px;padding:28px 24px;box-sizing:border-box}
h1{font-size:21px;margin:0 0 10px}
p{font-size:15px;line-height:1.65;color:var(--text2);margin:0 0 14px}
form{margin:0}
button{font:inherit;font-weight:600;padding:10px 18px;border:0;border-radius:8px;
background:var(--accent);color:#fff;cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
a{color:var(--accent)}
.site{font-size:13px;color:var(--text3);margin:18px 0 0}</style>
</head>
<body>
<main class="card">
<h1>${escapeHtml(input.heading)}</h1>
${input.html}
<p class="site">${
    input.homeUrl
      ? `<a href="${escapeHtml(input.homeUrl)}">${escapeHtml(input.siteTitle)}</a>`
      : escapeHtml(input.siteTitle)
  }</p>
</main>
</body>
</html>`
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
