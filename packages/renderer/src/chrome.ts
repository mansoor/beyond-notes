// Shared "chrome" for published pages: gallery layout CSS, the one inline
// script (lightbox, carousel arrows, copy-link), social icons, share bar.
// Published sites stay dependency-free — everything here is inlined.

import { escapeHtml } from './render'

export const GALLERY_CSS = `
.gallery{margin:18px 0}
.gallery .cell{display:block;text-decoration:none;cursor:zoom-in}
.gallery .cap{font-size:12px;color:var(--text3)}
.gallery:not(.mosaic):not(.carousel):not(.filmstrip){display:grid;
grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.gallery:not(.mosaic):not(.carousel):not(.filmstrip) img{width:100%;aspect-ratio:1;
object-fit:cover;border-radius:10px;display:block}
.gallery.mosaic{columns:3 180px;column-gap:12px}
.gallery.mosaic .cell{break-inside:avoid;margin-bottom:12px}
.gallery.mosaic img{width:100%;border-radius:10px;display:block}
.gallery.carousel,.gallery.filmstrip{position:relative}
.gallery.carousel .track,.gallery.filmstrip .track{display:flex;gap:14px;overflow-x:auto;
scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:12px}
.gallery.carousel .track::-webkit-scrollbar,.gallery.filmstrip .track::-webkit-scrollbar{display:none}
.gallery.carousel .cell{flex:0 0 100%;scroll-snap-align:center}
.gallery.carousel img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:12px;display:block}
.gallery.filmstrip .cell{flex:0 0 72%;scroll-snap-align:center}
.gallery.filmstrip img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:12px;display:block}
.gallery .gnav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;
border-radius:50%;border:0;background:rgba(0,0,0,.45);color:#fff;font-size:20px;cursor:pointer;
display:flex;align-items:center;justify-content:center;z-index:5}
.gallery .gnav:hover{background:rgba(0,0,0,.65)}
.gallery .gnav.prev{left:10px}.gallery .gnav.next{right:10px}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:100;display:none;
align-items:center;justify-content:center}
.lightbox.open{display:flex}
.lightbox img{max-width:92vw;max-height:88vh;object-fit:contain;border-radius:6px}
.lightbox .lb-cap{position:absolute;bottom:18px;left:0;right:0;text-align:center;color:#ddd;font-size:14px}
.lightbox .lb-btn{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:46px;
border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;font-size:24px;cursor:pointer}
.lightbox .lb-btn:hover{background:rgba(255,255,255,.25)}
.lightbox .lb-prev{left:16px}.lightbox .lb-next{right:16px}
.lightbox .lb-close{position:absolute;top:14px;right:16px;width:40px;height:40px;border-radius:50%;
border:0;background:rgba(255,255,255,.12);color:#fff;font-size:18px;cursor:pointer}
.socials{display:flex;gap:10px;align-items:center;margin-left:14px}
.socials a{display:flex;color:var(--text3)}
.socials a:hover{color:var(--accent)}
.socials svg{width:17px;height:17px;fill:currentColor}
.sharebar{display:flex;gap:8px;align-items:center;margin-top:34px;padding-top:14px;
border-top:1px solid var(--border);flex-wrap:wrap}
.sharebar .lbl{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)}
.sharebar a,.sharebar button{display:flex;align-items:center;gap:5px;border:1px solid var(--border);
border-radius:999px;padding:4px 12px;font-size:12.5px;color:var(--text2);text-decoration:none;
background:none;cursor:pointer;font-family:inherit}
.sharebar a:hover,.sharebar button:hover{color:var(--accent);border-color:var(--accent)}
.sharebar svg{width:13px;height:13px;fill:currentColor}
`

// One small script, no dependencies: lightbox with arrow traversal, carousel/
// filmstrip nav buttons, and the copy-link button of the share bar.
export const CHROME_JS = `
(function(){
var cells=[].slice.call(document.querySelectorAll('.gallery .cell'));
if(cells.length){
var lb=document.createElement('div');lb.className='lightbox';
lb.innerHTML='<button class="lb-close" aria-label="Close">\\u2715</button>'+
'<button class="lb-btn lb-prev" aria-label="Previous">\\u2039</button>'+
'<img alt=""><div class="lb-cap"></div>'+
'<button class="lb-btn lb-next" aria-label="Next">\\u203a</button>';
document.body.appendChild(lb);
var img=lb.querySelector('img'),cap=lb.querySelector('.lb-cap'),idx=0;
function show(i){idx=(i+cells.length)%cells.length;var c=cells[idx];
img.src=c.getAttribute('href');var t=c.querySelector('.cap');
cap.textContent=t?t.textContent:(c.querySelector('img')&&c.querySelector('img').alt)||'';}
function open(i){show(i);lb.classList.add('open');document.body.style.overflow='hidden';}
function close(){lb.classList.remove('open');document.body.style.overflow='';}
cells.forEach(function(c,i){c.addEventListener('click',function(e){e.preventDefault();open(i);});});
lb.querySelector('.lb-close').addEventListener('click',close);
lb.querySelector('.lb-prev').addEventListener('click',function(){show(idx-1);});
lb.querySelector('.lb-next').addEventListener('click',function(){show(idx+1);});
lb.addEventListener('click',function(e){if(e.target===lb)close();});
document.addEventListener('keydown',function(e){
if(!lb.classList.contains('open'))return;
if(e.key==='Escape')close();
if(e.key==='ArrowLeft')show(idx-1);
if(e.key==='ArrowRight')show(idx+1);});
}
[].slice.call(document.querySelectorAll('.gallery.carousel,.gallery.filmstrip')).forEach(function(g){
var track=g.querySelector('.track');if(!track)return;
function step(dir){var c=track.querySelector('.cell');if(!c)return;
track.scrollBy({left:dir*(c.offsetWidth+14),behavior:'smooth'});}
var prev=g.querySelector('.gnav.prev'),next=g.querySelector('.gnav.next');
if(prev)prev.addEventListener('click',function(e){e.stopPropagation();step(-1);});
if(next)next.addEventListener('click',function(e){e.stopPropagation();step(1);});});
var copy=document.querySelector('.sharebar .copylink');
if(copy)copy.addEventListener('click',function(){
navigator.clipboard.writeText(copy.getAttribute('data-url')).then(function(){
var t=copy.querySelector('span');var was=t.textContent;t.textContent='Copied!';
setTimeout(function(){t.textContent=was;},1500);});});
})();
`

// ---- social links ----

export type SocialPlatform =
  | 'github'
  | 'x'
  | 'instagram'
  | 'youtube'
  | 'linkedin'
  | 'facebook'
  | 'mastodon'
  | 'bluesky'
  | 'email'
  | 'website'

export type SocialLink = { platform: SocialPlatform; url: string }

// Compact 24x24 single-path glyphs (simple-icons geometry).
const ICON_PATHS: Record<SocialPlatform, string> = {
  github:
    'M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.1 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3',
  x: 'M18.9 1.2h3.7l-8.1 9.3L24 22.8h-7.5l-5.9-7.7-6.7 7.7H.2l8.7-9.9L0 1.2h7.7l5.3 7 6-7Zm-1.3 19.4h2L6.6 3.3H4.4l13.2 17.3Z',
  instagram:
    'M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.1-4.8-1.7-4.9-4.9-.1-1.3-.1-1.6-.1-4.8 0-3.2 0-3.6.1-4.8.1-3.2 1.7-4.8 4.9-4.9 1.2-.1 1.6-.1 4.8-.1ZM12 0C8.7 0 8.3 0 7 .1 2.7.3.3 2.7.1 7 0 8.3 0 8.7 0 12s0 3.7.1 5c.2 4.3 2.6 6.7 6.9 6.9 1.3.1 1.7.1 5 .1s3.7 0 5-.1c4.3-.2 6.7-2.6 6.9-6.9.1-1.3.1-1.7.1-5s0-3.7-.1-5C23.7 2.7 21.3.3 17 .1 15.7 0 15.3 0 12 0Zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.4-11.8a1.44 1.44 0 1 0 0 2.9 1.44 1.44 0 0 0 0-2.9Z',
  youtube:
    'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8ZM9.5 15.6V8.4L15.8 12l-6.3 3.6Z',
  linkedin:
    'M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1a3.7 3.7 0 0 1 3.4-1.9c3.6 0 4.3 2.4 4.3 5.5v6.3ZM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2Zm1.8 13.1H3.5V9h3.6v11.5ZM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 1 .8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7c0-1-.8-1.7-1.8-1.7Z',
  facebook:
    'M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12Z',
  mastodon:
    'M23.2 7.9c0-5.2-3.4-6.7-3.4-6.7C18 .4 15.1 0 12.1 0h-.2C8.9 0 6 .4 4.3 1.2c0 0-3.4 1.5-3.4 6.7l-.1 2c0 5 .9 10 5.6 11.2 2.1.6 4 .7 5.5.6 2.7-.2 4.2-1 4.2-1l-.1-2s-2 .6-4.1.6c-2.1-.1-4.4-.3-4.7-2.9v-.8s2.1.5 4.7.6c1.6.1 3.1-.1 4.7-.3 2.9-.4 5.5-2.2 5.8-3.9.5-2.6.5-6.1.5-6.1Zm-4 6.4h-2.5V8.2c0-1.3-.5-1.9-1.6-1.9-1.2 0-1.8.7-1.8 2.2v3.3H10.9V8.5c0-1.5-.6-2.2-1.8-2.2-1.1 0-1.6.6-1.6 1.9v6.1H5V8c0-1.3.3-2.3 1-3 .7-.8 1.6-1.2 2.7-1.2 1.3 0 2.3.5 2.9 1.5l.7 1 .6-1c.7-1 1.7-1.5 3-1.5 1.1 0 2 .4 2.7 1.2.6.7 1 1.7 1 3v6.3Z',
  bluesky:
    'M5.2 1.6C8 3.7 11 8 12 10.3c1-2.3 4-6.6 6.8-8.7C20.8.1 24-1 24 2.6c0 .7-.4 6-.7 6.8-.8 3-3.9 3.7-6.6 3.3 4.8.8 6 3.5 3.4 6.2-5 5.1-7.2-1.3-8-2.9-.1-.3-.2-.5-.2-.3 0-.2-.1 0-.2.3-.7 1.6-2.9 8-8 2.9-2.6-2.7-1.4-5.4 3.4-6.2-2.7.4-5.8-.3-6.6-3.3C.4 8.6 0 3.3 0 2.6 0-1 3.2.1 5.2 1.6Z',
  email:
    'M24 5.5v13c0 .8-.7 1.5-1.5 1.5h-21C.7 20 0 19.3 0 18.5v-13C0 4.7.7 4 1.5 4h21c.8 0 1.5.7 1.5 1.5Zm-2.6 1.2-8.5 6.1a1.5 1.5 0 0 1-1.8 0L2.6 6.7v11.7h18.8V6.7Zm-1.6-1.1H4.2L12 11l7.8-5.4Z',
  website:
    'M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm8.6 7.5h-3.4a15 15 0 0 0-1.8-4.6 9.7 9.7 0 0 1 5.2 4.6ZM12 2.4c1 1.2 2 3 2.6 5.1H9.4c.6-2.1 1.6-3.9 2.6-5.1ZM2.8 14.4a10 10 0 0 1 0-4.8h4a24 24 0 0 0 0 4.8h-4Zm1.8 2.5h3.3c.4 1.7 1 3.2 1.7 4.5a9.7 9.7 0 0 1-5-4.5Zm3.3-9.4H4.6a9.7 9.7 0 0 1 5-4.5c-.7 1.3-1.3 2.8-1.7 4.5ZM12 21.6c-1-1.2-2-3-2.6-5.1h5.2c-.6 2.1-1.6 3.9-2.6 5.1Zm3-7.2H9a21.7 21.7 0 0 1 0-4.8h6a21.7 21.7 0 0 1 0 4.8Zm.4 6.9c.7-1.4 1.4-2.9 1.8-4.6h3.4a9.7 9.7 0 0 1-5.2 4.6Zm2-7a24 24 0 0 0 0-4.8h4a10 10 0 0 1 0 4.8h-4Z',
}

export const SOCIAL_PLATFORMS = Object.keys(ICON_PATHS) as SocialPlatform[]

function icon(platform: SocialPlatform): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[platform]}"/></svg>`
}

export function socialLinksHtml(links: SocialLink[]): string {
  const valid = links.filter((l) => ICON_PATHS[l.platform] && l.url)
  if (valid.length === 0) return ''
  return `<div class="socials">${valid
    .map(
      (l) =>
        `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(l.platform)}" title="${escapeHtml(l.platform)}">${icon(l.platform)}</a>`,
    )
    .join('')}</div>`
}

// ---- share bar ----

export function shareBarHtml(input: { url: string; title: string }): string {
  const u = encodeURIComponent(input.url)
  const t = encodeURIComponent(input.title)
  const links = [
    {
      label: 'X',
      platform: 'x' as const,
      href: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    },
    {
      label: 'Facebook',
      platform: 'facebook' as const,
      href: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    },
    {
      label: 'LinkedIn',
      platform: 'linkedin' as const,
      href: `https://www.linkedin.com/shareArticle?mini=true&url=${u}&title=${t}`,
    },
    { label: 'Email', platform: 'email' as const, href: `mailto:?subject=${t}&body=${u}` },
  ]
  const anchors = links
    .map(
      (l) =>
        `<a href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${icon(l.platform)}<span>${l.label}</span></a>`,
    )
    .join('')
  return `<div class="sharebar"><span class="lbl">Share</span>${anchors}<button type="button" class="copylink" data-url="${escapeHtml(input.url)}">${icon('website')}<span>Copy link</span></button></div>`
}
