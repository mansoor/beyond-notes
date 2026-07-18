import { escapeHtml } from './render'

export type NavNode = {
  title: string
  path: string
  active?: boolean
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
}

const CSS = `
:root{--bg:#faf9f7;--panel:#fff;--text:#1f1e1b;--text2:#6f6b62;--text3:#a09a8e;
--border:#e7e3da;--accent:#5b4fc7;--accent-soft:#eeecfa;--code:#f4f2ee}
@media(prefers-color-scheme:dark){:root{--bg:#191817;--panel:#201f1d;--text:#e8e5df;
--text2:#a39e93;--text3:#736e64;--border:#34322e;--accent:#8478e0;--accent-soft:#2a2740;--code:#262523}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);font-size:15px;line-height:1.65}
header{display:flex;align-items:center;gap:18px;padding:14px 28px;border-bottom:1px solid var(--border)}
header .logo{font-weight:700;text-decoration:none;color:var(--text);font-size:15px}
header form{margin-left:auto}
header input{border:1px solid var(--border);background:var(--panel);color:var(--text);
border-radius:6px;padding:4px 12px;font-size:13px;width:180px}
.layout{display:flex;max-width:1100px;margin:0 auto;min-height:calc(100vh - 110px)}
nav.side{width:230px;flex-shrink:0;border-right:1px solid var(--border);padding:24px 16px;font-size:14px}
nav.side ul{list-style:none}
nav.side li ul{padding-left:14px}
nav.side a{display:block;padding:3px 10px;border-radius:5px;color:var(--text2);text-decoration:none}
nav.side a.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
nav.side a:hover{color:var(--text)}
main{flex:1;min-width:0;padding:30px 40px;max-width:720px}
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
main .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:16px 0}
main .gallery .cell{display:block;text-decoration:none}
main .gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block}
main .gallery .cap{font-size:12px;color:var(--text3)}
`

function navHtml(nodes: NavNode[], basePath: string): string {
  if (nodes.length === 0) return ''
  const items = nodes
    .map(
      (n) =>
        `<li><a href="${escapeHtml(basePath + n.path)}"${n.active ? ' class="active"' : ''}>${escapeHtml(n.title)}</a>${navHtml(n.children, basePath)}</li>`,
    )
    .join('')
  return `<ul>${items}</ul>`
}

function page(siteTitle: string, footer: string, basePath: string, body: string, title: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
<footer><span>${escapeHtml(footer)}</span><span>Built with Beyond Notes</span></footer>
</body>
</html>`
}

function headerHtml(siteTitle: string, basePath: string, searchQuery = '') {
  return `<header>
<a class="logo" href="${escapeHtml(basePath || '/')}">${escapeHtml(siteTitle)}</a>
<form action="${escapeHtml(`${basePath}/_search`)}" method="get">
<input type="search" name="q" placeholder="Search docs" value="${escapeHtml(searchQuery)}">
</form>
</header>`
}

export function docsShell(input: ShellInput): string {
  const prev = input.prev
    ? `<a href="${escapeHtml(input.basePath + input.prev.path)}">‹ Previous<b>${escapeHtml(input.prev.title)}</b></a>`
    : '<span></span>'
  const next = input.next
    ? `<a class="next" href="${escapeHtml(input.basePath + input.next.path)}">Next ›<b>${escapeHtml(input.next.title)}</b></a>`
    : '<span></span>'
  const body = `${headerHtml(input.siteTitle, input.basePath)}
<div class="layout">
<nav class="side">${navHtml(input.nav, input.basePath)}</nav>
<main>
<h1>${escapeHtml(input.pageTitle)}</h1>
${input.contentHtml}
<div class="prevnext">${prev}${next}</div>
</main>
</div>`
  return page(input.siteTitle, input.footer, input.basePath, body, input.pageTitle)
}

export function docsSearchResults(input: {
  siteTitle: string
  footer: string
  basePath: string
  nav: NavNode[]
  query: string
  results: Array<{ title: string; path: string; snippet: string }>
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
  const body = `${headerHtml(input.siteTitle, input.basePath, input.query)}
<div class="layout">
<nav class="side">${navHtml(input.nav, input.basePath)}</nav>
<main><h1>Search: ${escapeHtml(input.query)}</h1>${list}</main>
</div>`
  return page(input.siteTitle, input.footer, input.basePath, body, `Search: ${input.query}`)
}

export function docs404(siteTitle: string, footer: string, basePath: string): string {
  const body = `${headerHtml(siteTitle, basePath)}
<div class="layout"><main><h1>Not found</h1><p>This page does not exist or is not published.</p></main></div>`
  return page(siteTitle, footer, basePath, body, 'Not found')
}
