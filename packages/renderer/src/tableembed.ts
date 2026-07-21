// Read-only presentation of a data table, embedded in published content via a
// [[table='id' ...]] token. Composed at serve time (like forms), so it reflects
// live table data. Everything user-authored is escaped.

import { escapeHtml } from './render'

export type TableEmbedInput = {
  columns: string[] // display names, in order
  rows: string[][] // each row's cell values, aligned to `columns`
  layout: 'table' | 'cards' | 'list'
  // client-side pagination page size; 0 = show everything on one page
  pageSize: number
}

export function tableEmbedHtml(input: TableEmbedInput): string {
  const { columns, rows, layout } = input
  const pageAttr = input.pageSize > 0 ? ` data-pagesize="${Math.floor(input.pageSize)}"` : ''
  const pager = input.pageSize > 0 ? '<div class="bn-embed-pager"></div>' : ''

  if (rows.length === 0) {
    return `<div class="bn-table-embed"><p class="bn-embed-empty">No rows to show.</p></div>`
  }

  let body: string
  if (layout === 'cards') {
    body = rows
      .map((row) => {
        const kvs = columns
          .map(
            (c, i) =>
              `<div class="bn-embed-kv"><span class="k">${escapeHtml(c)}</span><span class="v">${escapeHtml(
                row[i] ?? '',
              )}</span></div>`,
          )
          .join('')
        return `<div class="bn-embed-item bn-embed-card">${kvs}</div>`
      })
      .join('')
    return `<div class="bn-table-embed bn-embed-cards"${pageAttr}>${body}${pager}</div>`
  }

  if (layout === 'list') {
    body = rows
      .map((row) => {
        const cells = columns
          .map(
            (c, i) =>
              `<span class="bn-embed-cell"><b>${escapeHtml(c)}:</b> ${escapeHtml(row[i] ?? '')}</span>`,
          )
          .join('')
        return `<div class="bn-embed-item bn-embed-line">${cells}</div>`
      })
      .join('')
    return `<div class="bn-table-embed bn-embed-list"${pageAttr}>${body}${pager}</div>`
  }

  // default: a table
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
  body = rows
    .map((row) => {
      const tds = columns.map((_, i) => `<td>${escapeHtml(row[i] ?? '')}</td>`).join('')
      return `<tr class="bn-embed-item">${tds}</tr>`
    })
    .join('')
  return `<div class="bn-table-embed"${pageAttr}><table class="bn-embed-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${pager}</div>`
}

export const TABLE_EMBED_CSS = `
.bn-table-embed{margin:1.5rem 0;overflow-x:auto}
.bn-embed-table{border-collapse:collapse;width:100%;font-size:.92rem}
.bn-embed-table th,.bn-embed-table td{border:1px solid var(--border,#ddd);padding:.45rem .6rem;text-align:left;vertical-align:top}
.bn-embed-table thead th{background:var(--panel,#f6f6f6);font-weight:600}
.bn-embed-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.75rem;overflow:visible}
.bn-embed-card{border:1px solid var(--border,#ddd);border-radius:10px;padding:.75rem;display:flex;flex-direction:column;gap:.35rem}
.bn-embed-kv{display:flex;flex-direction:column;gap:.1rem;font-size:.9rem}
.bn-embed-kv .k{font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;color:var(--text-2,#666)}
.bn-embed-list{display:flex;flex-direction:column;gap:.4rem;overflow:visible}
.bn-embed-line{border-bottom:1px solid var(--border,#eee);padding-bottom:.4rem;display:flex;flex-wrap:wrap;gap:.75rem;font-size:.92rem}
.bn-embed-empty{color:var(--text-2,#666);font-size:.9rem;font-style:italic}
.bn-embed-pager{display:flex;align-items:center;gap:.5rem;margin-top:.6rem}
.bn-embed-pager button{border:1px solid var(--border,#ccc);background:var(--bg,#fff);color:inherit;border-radius:6px;width:1.8rem;height:1.8rem;cursor:pointer}
.bn-embed-pager button:disabled{opacity:.4;cursor:default}
.bn-embed-page{font-size:.85rem;color:var(--text-2,#666)}
`.trim()

/** Client-side pagination for embedded tables. Self-contained, self-guarded. */
export const TABLE_EMBED_JS = `
(function(){
  if(window.__bnTableEmbed)return;window.__bnTableEmbed=1;
  function setup(el){
    var size=parseInt(el.getAttribute('data-pagesize'),10);
    if(!size||size<1)return;
    var items=[].slice.call(el.querySelectorAll('.bn-embed-item'));
    var pager=el.querySelector('.bn-embed-pager');
    var pages=Math.ceil(items.length/size);
    if(pages<=1){if(pager)pager.style.display='none';return;}
    var cur=0;
    function render(){
      items.forEach(function(it,i){it.style.display=(i>=cur*size&&i<(cur+1)*size)?'':'none';});
      if(!pager)return;pager.innerHTML='';
      var prev=document.createElement('button');prev.type='button';prev.textContent='‹';prev.disabled=cur===0;prev.onclick=function(){cur--;render();};
      var lbl=document.createElement('span');lbl.className='bn-embed-page';lbl.textContent=(cur+1)+' / '+pages;
      var next=document.createElement('button');next.type='button';next.textContent='›';next.disabled=cur>=pages-1;next.onclick=function(){cur++;render();};
      pager.appendChild(prev);pager.appendChild(lbl);pager.appendChild(next);
    }
    render();
  }
  var els=document.querySelectorAll('.bn-table-embed[data-pagesize]');
  for(var i=0;i<els.length;i++)setup(els[i]);
})();
`.trim()
