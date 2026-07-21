import { CHROME_JS, GALLERY_CSS, type SocialLink, socialLinksHtml } from './chrome'
import { type TocEntry, escapeHtml } from './render'
import type { SiteMeta } from './site'
import { type ThemeAppearance, type ThemeName, themeCss } from './themes'

export type NavNode = {
  title: string
  path: string
  active?: boolean
  /** a single emoji shown before the title in the sidebar */
  icon?: string | null
  children: NavNode[]
}

export type ShellInput = {
  siteTitle: string
  footer: string
  pageTitle: string
  contentHtml: string
  nav: NavNode[]
  basePath: string // '' for host-routing, '/s/<host>' for the path-based dev escape
  prev?: { title: string; path: string }
  next?: { title: string; path: string }
  searchQuery?: string
  /** social links for the header; when present, search centers and these sit right */
  social?: SocialLink[]
  /** draft previews must never be indexed */
  noindex?: boolean
  /** "On this page" entries, from the snapshot's headings */
  toc?: TocEntry[]
  crumbs?: Array<{ title: string; path: string }>
  /** ISO date the live version was published */
  updatedAt?: string | null
  /** app URL for "Edit this page"; only rendered for signed-in visitors */
  editUrl?: string | null
  /** wikis pick a theme like websites do; defaults keep older sites unchanged */
  theme?: ThemeName
  appearance?: ThemeAppearance
  meta?: SiteMeta
  /** tags frozen into the snapshot, linked to /tags/<tag> */
  tags?: string[]
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);font-size:15px;line-height:1.65}
header{display:flex;align-items:center;gap:18px;padding:14px 28px;border-bottom:1px solid var(--border)}
header .logo{font-weight:700;text-decoration:none;color:var(--text);font-size:15px}
header form{margin-left:auto}
header input{border:1px solid var(--border);background:var(--panel);color:var(--text);
border-radius:6px;padding:4px 12px;font-size:13px;width:180px}
header.hassocial{display:grid;grid-template-columns:1fr auto 1fr;gap:18px}
header.hassocial .logo{justify-self:start}
header.hassocial form{margin:0;justify-self:center}
header.hassocial .socials{justify-self:end}
header .socials{display:flex;align-items:center;gap:13px}
header .socials a{color:var(--text3);display:inline-flex}
header .socials a:hover{color:var(--text)}
header .socials svg{width:18px;height:18px;fill:currentColor}
@media(max-width:640px){header.hassocial{grid-template-columns:1fr auto;row-gap:10px}
header.hassocial form{grid-column:1/-1;justify-self:stretch}header.hassocial form input{width:100%}}
.layout{display:flex;min-height:calc(100vh - 110px)}
nav.side{width:var(--sidew,240px);flex-shrink:0;border-right:1px solid var(--border);
padding:24px 10px 24px 16px;font-size:14px;text-align:left}
nav.side ul{list-style:none}
/* children sit under a subtle guide line and indent a touch from the parent */
nav.side li ul{margin-left:10px;padding-left:8px;border-left:1px solid var(--border)}
nav.side a{display:flex;align-items:center;gap:7px;padding:4px 10px;border-radius:5px;
color:var(--text2);text-decoration:none;overflow:hidden;white-space:nowrap}
nav.side a>*{overflow:hidden;text-overflow:ellipsis}
nav.side a.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
nav.side a:hover{color:var(--text)}
nav.side .ico{flex-shrink:0;font-size:14px;line-height:1;width:16px;text-align:center}
.dragbar{width:5px;flex-shrink:0;cursor:col-resize;margin-left:-3px}
.dragbar:hover,.dragbar.active{background:var(--accent-soft)}
main{flex:1;min-width:0;padding:30px 48px}
main .inner{max-width:940px;margin:0 auto}
main h1{font-size:27px;letter-spacing:-.02em;margin-bottom:12px}
main h2{font-size:20px;margin:24px 0 8px}
main h3{font-size:17px;margin:20px 0 6px}
main h4{font-size:15px;margin:16px 0 6px}
main p{margin:9px 0}
main ul,main ol{margin:8px 0 8px 22px}
main ul.checklist{list-style:none;margin-left:2px}
main li.check.done{color:var(--text3);text-decoration:line-through}
main pre{background:var(--code);border:1px solid var(--border);border-radius:8px;
padding:13px 15px;margin:12px 0;overflow-x:auto;font-size:13px}
main code{font-family:ui-monospace,Consolas,monospace;font-size:.92em}
main p code{background:var(--code);border-radius:4px;padding:1px 5px}
main blockquote{border-left:3px solid var(--border);padding-left:14px;color:var(--text2);margin:10px 0}
main a{color:var(--accent)}
main .indent{padding-left:18px}
main .table-wrap{overflow-x:auto;margin:14px 0}
main table{border-collapse:collapse;width:100%;font-size:14px}
main th,main td{border:1px solid var(--border);padding:7px 11px;text-align:left;vertical-align:top}
main thead th{background:var(--code);font-weight:600}
.prevnext{display:flex;justify-content:space-between;gap:10px;margin-top:38px}
.prevnext a{border:1px solid var(--border);border-radius:8px;padding:9px 15px;font-size:13px;
text-decoration:none;color:var(--text2);flex:1}
.prevnext a b{display:block;color:var(--accent)}
.prevnext a.next{text-align:right}
footer{border-top:1px solid var(--border);padding:14px 28px;font-size:12px;color:var(--text3);
display:flex;justify-content:space-between}
.results li{margin:10px 0}
main figure{margin:14px 0}
main figure img{max-width:100%;border-radius:8px}
main figcaption{font-size:12px;color:var(--text3);margin-top:4px}
.crumbs{font-size:12.5px;color:var(--text3);margin-bottom:10px}
.crumbs a{color:var(--text3);text-decoration:none}
.crumbs a:hover{color:var(--accent)}
.crumbs .sep{margin:0 6px;opacity:.6}
.pagemeta{font-size:12.5px;color:var(--text3);margin:-4px 0 18px;display:flex;gap:14px;flex-wrap:wrap}
.pagemeta a{color:var(--accent);text-decoration:none}
.tagrow{margin:-6px 0 16px;display:flex;gap:8px;flex-wrap:wrap}
.tagrow a{font-size:12px;color:var(--accent);text-decoration:none;background:var(--code);
border-radius:999px;padding:2px 10px}
main h2,main h3,main h4{scroll-margin-top:20px}
.hanchor{margin-left:8px;color:var(--text3);text-decoration:none;opacity:0;font-weight:400}
h2:hover .hanchor,h3:hover .hanchor,h4:hover .hanchor,.hanchor:focus{opacity:1}
.toc{width:200px;flex-shrink:0;padding:30px 16px;font-size:13px;position:sticky;top:0;
align-self:flex-start;max-height:100vh;overflow-y:auto}
.toc h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px}
.toc a{display:block;padding:3px 0;color:var(--text2);text-decoration:none;line-height:1.35}
.toc a:hover{color:var(--accent)}
.toc a.lvl3{padding-left:12px;font-size:12.5px}
.toc a.lvl4{padding-left:24px;font-size:12.5px}
.toc a.here{color:var(--accent);font-weight:600}
@media(max-width:1100px){.toc{display:none}}
nav.side .grp{display:flex;align-items:center}
nav.side .grp a{flex:1;min-width:0}
nav.side .tw{border:0;background:none;cursor:pointer;color:var(--text3);font-size:15px;
padding:4px 8px;line-height:1;border-radius:4px;flex-shrink:0}
nav.side .tw:hover{color:var(--text)}
nav.side li.collapsed>ul{display:none}
pre{position:relative}
pre .copy{position:absolute;top:6px;right:6px;border:1px solid var(--border);background:var(--panel);
color:var(--text2);border-radius:6px;font-size:11px;padding:2px 8px;cursor:pointer;opacity:0}
pre:hover .copy,pre .copy:focus{opacity:1}
.tok-com{color:var(--text3);font-style:italic}
.tok-str{color:#3f8f5f}
.tok-num{color:#a5682a}
.tok-kw{color:var(--accent);font-weight:600}
.tok-key{color:#8a5cd6}
@media(prefers-color-scheme:dark){.tok-str{color:#84c99b}.tok-num{color:#d9a066}.tok-key{color:#b69bec}}
`

/** Sections with children get a twisty; the active trail stays expanded. */
function hasActive(n: NavNode): boolean {
  return n.active === true || n.children.some(hasActive)
}

// a Material Symbols ligature name vs a literal emoji
const MATERIAL_NAME = /^[a-z0-9_]+$/

/** True if any node in the tree carries a Material Symbols icon name. */
export function navHasMaterialIcon(nodes: NavNode[]): boolean {
  return nodes.some((n) => (n.icon && MATERIAL_NAME.test(n.icon)) || navHasMaterialIcon(n.children))
}

/** The Material Symbols @font-face + class, injected only when a nav uses it. */
const MATERIAL_CSS = `
@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:100 700;
font-display:block;src:url('/api/assets/material-symbols.woff2') format('woff2')}
nav.side .ico.msym{font-family:'Material Symbols Outlined';font-weight:normal;font-size:18px;
line-height:1;font-feature-settings:'liga';-webkit-font-smoothing:antialiased}
`

function navHtml(nodes: NavNode[], basePath: string): string {
  if (nodes.length === 0) return ''
  const items = nodes
    .map((n) => {
      const ico = n.icon
        ? `<span class="ico${MATERIAL_NAME.test(n.icon) ? ' msym' : ''}">${escapeHtml(n.icon)}</span>`
        : ''
      const link = `<a href="${escapeHtml(basePath + n.path)}"${n.active ? ' class="active"' : ''}>${ico}${escapeHtml(n.title)}</a>`
      if (n.children.length === 0) return `<li>${link}</li>`
      const open = hasActive(n)
      // readme-style: the link stays left-aligned like a leaf; the twisty rides
      // the right edge; children indent under a guide line
      return `<li class="${open ? '' : 'collapsed'}" data-sec="${escapeHtml(n.path)}"><span class="grp">${link}<button class="tw" type="button" aria-label="Toggle section">${open ? '▾' : '▸'}</button></span>${navHtml(n.children, basePath)}</li>`
    })
    .join('')
  return `<ul>${items}</ul>`
}

function tocHtml(toc: TocEntry[]): string {
  // The column is ALWAYS rendered so the content never shifts left/right from
  // page to page; it just sits empty when there's nothing to list (a single
  // heading is not a table of contents).
  const inner =
    toc.length >= 2
      ? `<h4>On this page</h4><nav>${toc
          .map(
            (t) => `<a class="lvl${t.level}" href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a>`,
          )
          .join('')}</nav>`
      : ''
  return `<aside class="toc">${inner}</aside>`
}

function docsCrumbs(crumbs: Array<{ title: string; path: string }>, basePath: string): string {
  if (crumbs.length === 0) return ''
  return `<nav class="crumbs">${crumbs
    .map((c) => `<a href="${escapeHtml(basePath + c.path)}">${escapeHtml(c.title)}</a>`)
    .join('<span class="sep">/</span>')}</nav>`
}

// Sidebar drag-to-resize: width lives in --sidew, persisted per-browser. The
// restore runs from <head> so the bar never flashes at the default width.
const SIDEBAR_RESTORE_JS = `try{var w=localStorage.getItem('bn-docs-sidew');if(w)document.documentElement.style.setProperty('--sidew',w+'px')}catch(e){}`
const DOCS_JS = `(function(){
// collapsible nav sections, remembered per browser
var st={};try{st=JSON.parse(localStorage.getItem('bn-docs-nav')||'{}')}catch(e){}
document.querySelectorAll('nav.side li[data-sec]').forEach(function(li){
  var key=li.getAttribute('data-sec');
  if(st[key]===true)li.classList.remove('collapsed');
  if(st[key]===false&&!li.querySelector('a.active'))li.classList.add('collapsed');
  var b=li.querySelector('.tw');if(!b)return;
  b.textContent=li.classList.contains('collapsed')?'\\u25B8':'\\u25BE';
  b.addEventListener('click',function(){
    var now=li.classList.toggle('collapsed');
    b.textContent=now?'\\u25B8':'\\u25BE';
    st[key]=!now;try{localStorage.setItem('bn-docs-nav',JSON.stringify(st))}catch(e){}
  });
});
// clipboard with a fallback: navigator.clipboard is undefined on plain HTTP,
// which plenty of self-hosted instances run on
function bnCopy(text){
  if(navigator.clipboard&&window.isSecureContext){
    return navigator.clipboard.writeText(text).catch(function(){return bnCopyFallback(text)});
  }
  return bnCopyFallback(text);
}
function bnCopyFallback(text){
  return new Promise(function(res,rej){
    try{
      var ta=document.createElement('textarea');
      ta.value=text;ta.setAttribute('readonly','');
      ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();
      var ok=document.execCommand('copy');
      document.body.removeChild(ta);
      ok?res():rej(new Error('copy refused'));
    }catch(e){rej(e)}
  });
}
// copy button on code blocks — never on mermaid diagrams: the button's text
// would land inside the diagram source that the renderer reads back
document.querySelectorAll('main pre:not(.mermaid)').forEach(function(pre){
  var b=document.createElement('button');b.className='copy';b.type='button';b.textContent='copy';
  b.addEventListener('click',function(){
    var code=pre.querySelector('code');
    bnCopy(code?code.innerText:pre.innerText).then(function(){
      b.textContent='copied';setTimeout(function(){b.textContent='copy'},1200);
    },function(){
      b.textContent='copy failed';setTimeout(function(){b.textContent='copy'},1600);
    });
  });
  pre.appendChild(b);
});
// heading anchors copy their link instead of only jumping
document.querySelectorAll('.hanchor').forEach(function(a){
  a.addEventListener('click',function(e){
    e.preventDefault();
    var url=location.origin+location.pathname+a.getAttribute('href');
    history.replaceState(null,'',a.getAttribute('href'));
    document.querySelector(a.getAttribute('href')).scrollIntoView();
    bnCopy(url).catch(function(){});
  });
});
// scrollspy: highlight the TOC entry for the heading nearest the top
var links=[].slice.call(document.querySelectorAll('.toc a'));
if(links.length){
  var heads=links.map(function(l){return document.getElementById(l.getAttribute('href').slice(1))});
  var tick=function(){
    var best=0;
    for(var i=0;i<heads.length;i++){if(heads[i]&&heads[i].getBoundingClientRect().top<=90)best=i}
    // at the very bottom the last heading can never reach the top — claim it,
    // otherwise the final section is unreachable in the TOC
    if(window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-2)best=heads.length-1;
    links.forEach(function(l,i){l.classList.toggle('here',i===best)});
  };
  document.addEventListener('scroll',tick,{passive:true});tick();
}
})();`

const SIDEBAR_DRAG_JS = `(function(){
var bar=document.querySelector('.dragbar');if(!bar)return;
var root=document.documentElement,on=false;
bar.addEventListener('pointerdown',function(e){on=true;bar.classList.add('active');bar.setPointerCapture(e.pointerId);e.preventDefault()});
bar.addEventListener('pointermove',function(e){if(!on)return;
var w=Math.min(480,Math.max(160,e.clientX));
root.style.setProperty('--sidew',w+'px');
try{localStorage.setItem('bn-docs-sidew',w)}catch(err){}});
bar.addEventListener('pointerup',function(){on=false;bar.classList.remove('active')});
})();`

function docsMetaHtml(title: string, siteTitle: string, meta?: SiteMeta): string {
  if (!meta) return ''
  const lines: string[] = []
  if (meta.description) {
    lines.push(`<meta name="description" content="${escapeHtml(meta.description)}">`)
    lines.push(`<meta property="og:description" content="${escapeHtml(meta.description)}">`)
  }
  lines.push(`<meta property="og:title" content="${escapeHtml(title)}">`)
  lines.push(`<meta property="og:site_name" content="${escapeHtml(siteTitle)}">`)
  lines.push('<meta property="og:type" content="article">')
  if (meta.url) {
    lines.push(`<meta property="og:url" content="${escapeHtml(meta.url)}">`)
    lines.push(`<link rel="canonical" href="${escapeHtml(meta.url)}">`)
  }
  if (meta.ogImage) {
    lines.push(`<meta property="og:image" content="${escapeHtml(meta.ogImage)}">`)
    lines.push('<meta name="twitter:card" content="summary_large_image">')
  }
  return `${lines.join('\n')}\n`
}

function page(
  siteTitle: string,
  footer: string,
  basePath: string,
  body: string,
  title: string,
  noindex = false,
  theme: ThemeName = 'paper',
  appearance: ThemeAppearance = 'auto',
  meta?: SiteMeta,
  extraCss = '',
) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
${docsMetaHtml(title, siteTitle, meta)}
<script>${SIDEBAR_RESTORE_JS}</script>
<style>${themeCss(theme, appearance)}${CSS}${GALLERY_CSS}${extraCss}</style>
</head>
<body data-appearance="${appearance}">
${body}
<footer><span>${escapeHtml(footer)}</span><span>Built with Beyond Notes</span></footer>
<script>${CHROME_JS}${SIDEBAR_DRAG_JS}${DOCS_JS}</script>
</body>
</html>`
}

function headerHtml(
  siteTitle: string,
  basePath: string,
  searchQuery = '',
  social: SocialLink[] = [],
) {
  const logo = `<a class="logo" href="${escapeHtml(basePath || '/')}">${escapeHtml(siteTitle)}</a>`
  const search = `<form action="${escapeHtml(`${basePath}/_search`)}" method="get">
<input type="search" name="q" placeholder="Search docs" value="${escapeHtml(searchQuery)}">
</form>`
  const socials = socialLinksHtml(social)
  // with socials the header is a three-track grid: logo left, search centered,
  // socials right. Without, the search keeps its right-aligned place.
  return socials
    ? `<header class="hassocial">${logo}${search}${socials}</header>`
    : `<header>${logo}${search}</header>`
}

export function docsShell(input: ShellInput): string {
  const prev = input.prev
    ? `<a href="${escapeHtml(input.basePath + input.prev.path)}">‹ Previous<b>${escapeHtml(input.prev.title)}</b></a>`
    : '<span></span>'
  const next = input.next
    ? `<a class="next" href="${escapeHtml(input.basePath + input.next.path)}">Next ›<b>${escapeHtml(input.next.title)}</b></a>`
    : '<span></span>'
  const meta: string[] = []
  if (input.updatedAt) {
    meta.push(
      `<span>Last updated ${escapeHtml(new Date(input.updatedAt).toISOString().slice(0, 10))}</span>`,
    )
  }
  if (input.editUrl) {
    meta.push(`<a href="${escapeHtml(input.editUrl)}">Edit this page ↗</a>`)
  }
  const tagRow = input.tags?.length
    ? `<div class="tagrow">${input.tags
        .map((t) => `<a href="${escapeHtml(`${input.basePath}/tags/${t}`)}">#${escapeHtml(t)}</a>`)
        .join('')}</div>`
    : ''
  const body = `${headerHtml(input.siteTitle, input.basePath, '', input.social)}
<div class="layout">
<nav class="side">${navHtml(input.nav, input.basePath)}</nav>
<div class="dragbar" title="Drag to resize"></div>
<main><div class="inner">
${docsCrumbs(input.crumbs ?? [], input.basePath)}
<h1>${escapeHtml(input.pageTitle)}</h1>
${meta.length > 0 ? `<div class="pagemeta">${meta.join('')}</div>` : ''}
${tagRow}
${input.contentHtml}
<div class="prevnext">${prev}${next}</div>
</div></main>
${tocHtml(input.toc ?? [])}
</div>`
  return page(
    input.siteTitle,
    input.footer,
    input.basePath,
    body,
    input.pageTitle,
    input.noindex,
    input.theme,
    input.appearance,
    input.meta,
    navHasMaterialIcon(input.nav) ? MATERIAL_CSS : '',
  )
}

export function docsSearchResults(input: {
  siteTitle: string
  footer: string
  basePath: string
  nav: NavNode[]
  query: string
  results: Array<{ title: string; path: string; snippet: string }>
  theme?: ThemeName
  appearance?: ThemeAppearance
  social?: SocialLink[]
}): string {
  const list =
    input.results.length === 0
      ? '<p>No results.</p>'
      : `<ul class="results">${input.results
          .map(
            (r) =>
              `<li><a href="${escapeHtml(input.basePath + r.path)}">${escapeHtml(r.title)}</a><br><small>${escapeHtml(r.snippet)}</small></li>`,
          )
          .join('')}</ul>`
  const body = `${headerHtml(input.siteTitle, input.basePath, input.query, input.social)}
<div class="layout">
<nav class="side">${navHtml(input.nav, input.basePath)}</nav>
<div class="dragbar" title="Drag to resize"></div>
<main><div class="inner"><h1>Search: ${escapeHtml(input.query)}</h1>${list}</div></main>
</div>`
  return page(
    input.siteTitle,
    input.footer,
    input.basePath,
    body,
    `Search: ${input.query}`,
    false,
    input.theme,
    input.appearance,
    undefined,
    navHasMaterialIcon(input.nav) ? MATERIAL_CSS : '',
  )
}

export function docs404(
  siteTitle: string,
  footer: string,
  basePath: string,
  theme: ThemeName = 'paper',
  appearance: ThemeAppearance = 'auto',
): string {
  const body = `${headerHtml(siteTitle, basePath)}
<div class="layout"><main><div class="inner"><h1>Not found</h1><p>This page does not exist or is not published.</p></div></main></div>`
  return page(siteTitle, footer, basePath, body, 'Not found', false, theme, appearance)
}

/** /tags/<tag> for wikis — same idea as the website's tag page. */
export function docsTagPage(input: {
  siteTitle: string
  footer: string
  basePath: string
  nav: NavNode[]
  tag: string
  theme?: ThemeName
  appearance?: ThemeAppearance
  social?: SocialLink[]
  items: Array<{ title: string; path: string; snippet: string }>
}): string {
  const list =
    input.items.length === 0
      ? '<p>Nothing carries this tag.</p>'
      : `<ul class="results">${input.items
          .map(
            (r) =>
              `<li><a href="${escapeHtml(input.basePath + r.path)}">${escapeHtml(r.title)}</a><br><small>${escapeHtml(r.snippet)}</small></li>`,
          )
          .join('')}</ul>`
  const body = `${headerHtml(input.siteTitle, input.basePath, '', input.social)}
<div class="layout">
<nav class="side">${navHtml(input.nav, input.basePath)}</nav>
<div class="dragbar" title="Drag to resize"></div>
<main><div class="inner"><h1>#${escapeHtml(input.tag)}</h1>${list}</div></main>
</div>`
  return page(
    input.siteTitle,
    input.footer,
    input.basePath,
    body,
    `#${input.tag}`,
    false,
    input.theme,
    input.appearance,
    undefined,
    navHasMaterialIcon(input.nav) ? MATERIAL_CSS : '',
  )
}
