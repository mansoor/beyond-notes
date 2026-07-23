// Public intake forms, composed at serve time from a table's form config.
// The markup is trusted (built here, not user block content), but every value
// that originates from user data — labels, choices, copy — is escaped.

import { escapeHtml } from './render'

export type FormFieldInput = {
  id: string
  name: string
  type: 'text' | 'longtext' | 'number' | 'checkbox' | 'date' | 'datetime' | 'select' | 'email' | 'url'
  required: boolean
  choices: string[]
  /** grid position; both default to 1 (a plain single-column stack) */
  col?: number
  width?: number
  /** shown instead of `name`; may carry [text](https://…) links */
  label?: string
  /** discriminator for the item union — absent means an ordinary field */
  item?: 'field'
}

/** Furniture between the questions: a rule, or a line of explanatory text. */
export type FormBlockInput = {
  item: 'divider' | 'text'
  id: string
  /** the copy for a text block; ignored by a divider */
  text?: string
  col?: number
  width?: number
}

export type FormItemInput = FormFieldInput | FormBlockInput

export type FormCaptchaInput =
  | { mode: 'basic'; question: string; token: string }
  | { mode: 'recaptcha'; siteKey: string }
  | null

export type FormRenderInput = {
  /** Where the form POSTs, e.g. /api/forms/<tableId>. */
  actionPath: string
  title: string
  description: string
  submitLabel: string
  successMessage: string
  /** fields and blocks, in render order */
  fields: FormItemInput[]
  captcha?: FormCaptchaInput
  /** columns to lay the fields out in; 1 (the default) emits no grid at all */
  columns?: number
}

/** Widest grid a form may declare. Mirrors FORM_MAX_COLUMNS in @bn/schema —
 *  the renderer clamps again because it also renders configs it did not save. */
const MAX_COLUMNS = 4

// Labels and notes are author-written, so they may carry a link — and nothing
// else. The text is escaped first and links are rebuilt from the parts, so a
// pasted <script>, an onclick=, or a javascript: href cannot survive: they are
// simply not shapes this produces.
const LINK = /\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)/g
const SAFE_HREF = /^(https?:\/\/|mailto:|\/)[^\s"'<>]*$/i

/** Escaped text with `[label](url)` turned into an anchor. Nothing else. */
export function richTextHtml(text: string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0
    out += escapeHtml(text.slice(last, at))
    const label = m[1] ?? ''
    const href = m[2] ?? ''
    out += SAFE_HREF.test(href)
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
      : // not a link we will emit — show the author what they typed
        escapeHtml(m[0])
    last = at + m[0].length
  }
  return out + escapeHtml(text.slice(last))
}

/** Google's widget loader — appended once by the serve-time expander when any
 *  form on the page uses reCAPTCHA. The single sanctioned CDN load, opt-in. */
export const RECAPTCHA_SCRIPT =
  '<script src="https://www.google.com/recaptcha/api.js" async defer></script>'

function captchaHtml(captcha: FormCaptchaInput): string {
  if (!captcha) return ''
  if (captcha.mode === 'recaptcha') {
    return `<div class="g-recaptcha" data-sitekey="${escapeHtml(captcha.siteKey)}"></div>`
  }
  return `<label class="bn-form-field"><span class="bn-form-label">${escapeHtml(
    captcha.question,
  )} <span class="bn-form-req">*</span></span><input type="text" name="_captcha_answer" inputmode="numeric" autocomplete="off" required></label><input type="hidden" name="_captcha" value="${escapeHtml(
    captcha.token,
  )}">`
}

/**
 * Grid placement, as custom properties rather than a `grid-column` shorthand:
 * the narrow-screen media query has to be able to force every field back to a
 * single column, and it cannot outrank an inline style.
 */
function placementStyle(field: { col?: number; width?: number }, columns: number): string {
  if (columns < 2) return ''
  const col = Math.min(Math.max(1, Math.round(field.col ?? 1)), columns)
  const width = Math.min(Math.max(1, Math.round(field.width ?? 1)), columns - col + 1)
  return ` style="--c:${col};--w:${width}"`
}

function blockHtml(block: FormBlockInput, columns: number): string {
  const place = placementStyle(block, columns)
  if (block.item === 'divider') return `<hr class="bn-form-sep"${place}>`
  const text = (block.text ?? '').trim()
  return text ? `<p class="bn-form-note"${place}>${richTextHtml(text)}</p>` : ''
}

function fieldHtml(field: FormFieldInput, columns: number): string {
  // an override may carry a link, so it is rich text; a bare column name is
  // escaped plain text either way
  const label = field.label?.trim() ? richTextHtml(field.label.trim()) : escapeHtml(field.name)
  const req = field.required ? ' required' : ''
  const reqMark = field.required ? ' <span class="bn-form-req">*</span>' : ''
  const name = escapeHtml(field.id)
  const place = placementStyle(field, columns)

  if (field.type === 'checkbox') {
    return `<label class="bn-form-check"${place}><input type="checkbox" name="${name}" value="true"${req}> ${label}${reqMark}</label>`
  }

  let control: string
  if (field.type === 'longtext') {
    control = `<textarea name="${name}" rows="4"${req}></textarea>`
  } else if (field.type === 'select') {
    const opts = ['<option value="">— choose —</option>']
      .concat(
        field.choices.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
      )
      .join('')
    control = `<select name="${name}"${req}>${opts}</select>`
  } else {
    const inputType =
      field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'datetime'
            ? 'datetime-local'
            : field.type === 'email'
              ? 'email'
              : field.type === 'url'
                ? 'url'
                : 'text'
    control = `<input type="${inputType}" name="${name}"${req}>`
  }
  return `<label class="bn-form-field"${place}><span class="bn-form-label">${label}${reqMark}</span>${control}</label>`
}

/** The <form> markup for one intake form. Pair with FORM_CSS + FORM_JS (emitted
 *  once per page by the serve-time expander). */
export function formHtml(input: FormRenderInput): string {
  const title = input.title.trim()
    ? `<h3 class="bn-form-title">${escapeHtml(input.title)}</h3>`
    : ''
  const desc = input.description.trim()
    ? `<p class="bn-form-desc">${escapeHtml(input.description)}</p>`
    : ''
  // one column is the old single-stack markup, byte for byte — a form that
  // never asked for a grid does not get one
  const columns = Math.min(Math.max(1, Math.round(input.columns ?? 1)), MAX_COLUMNS)
  const cells = input.fields
    .map((f) =>
      f.item === 'divider' || f.item === 'text'
        ? blockHtml(f, columns)
        : fieldHtml(f as FormFieldInput, columns),
    )
    .join('')
  // 3- and 4-wide grids are marked so a tablet can fall back to two columns
  // before the phone rule flattens them entirely
  const fields =
    columns > 1
      ? `<div class="bn-form-grid${columns > 2 ? ' bn-form-dense' : ''}">${cells}</div>`
      : cells
  // honeypot: a real submitter never fills it; bots that fill every field do
  const honeypot =
    '<div class="bn-form-hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="_website" tabindex="-1" autocomplete="off"></label></div>'
  const action = escapeHtml(input.actionPath)
  const success = escapeHtml(input.successMessage)
  const submit = escapeHtml(input.submitLabel || 'Submit')
  const captcha = captchaHtml(input.captcha ?? null)
  // the column count lives on the form, not the grid: the form's own width has
  // to grow with it, and the grid inherits the variable either way
  const formAttrs =
    columns > 1 ? ` class="bn-form bn-form-wide" style="--bn-cols:${columns}"` : ' class="bn-form"'
  return `<div class="bn-form-wrap"><form${formAttrs} method="post" action="${action}" data-bn-form data-success="${success}">${honeypot}${title}${desc}${fields}${captcha}<button type="submit" class="bn-form-submit">${submit}</button><p class="bn-form-msg" role="status" hidden></p></form></div>`
}

/** Styling that leans on the published theme's CSS variables. */
export const FORM_CSS = `
.bn-form-wrap{margin:1.5rem 0}
.bn-form{display:flex;flex-direction:column;gap:.85rem;max-width:32rem;padding:1.25rem;border:1px solid var(--border,#ddd);border-radius:12px;background:var(--panel,transparent)}
.bn-form-title{margin:0;font-size:1.1rem}
.bn-form-desc{margin:0;color:var(--text-2,#555);font-size:.9rem}
.bn-form-field{display:flex;flex-direction:column;gap:.3rem;font-size:.9rem}
.bn-form-label{font-weight:600}
.bn-form-req{color:var(--danger,#c0392b)}
.bn-form input,.bn-form textarea,.bn-form select{padding:.5rem .65rem;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--bg,#fff);color:inherit;font:inherit;width:100%;box-sizing:border-box}
.bn-form textarea{resize:vertical}
/* multi-column layout. Placement rides on --c/--w so this media query can
   collapse everything back to one column on a phone — an inline grid-column
   would outrank it and leave fields squeezed into a sliver. */
/* the form widens with the grid it declares: 2 cols ~46rem … 4 cols ~70rem */
.bn-form-wide{max-width:calc(34rem + (var(--bn-cols,1) - 1) * 12rem)}
.bn-form-grid{display:grid;grid-template-columns:repeat(var(--bn-cols,1),minmax(0,1fr));
gap:.85rem;align-items:start}
.bn-form-grid>*{grid-column:var(--c,auto)/span var(--w,1)}
/* a 3- or 4-wide form is unusable on a tablet long before it is on a phone:
   halve it there, then flatten everything below phone width */
@media(max-width:52rem){
.bn-form-grid.bn-form-dense{grid-template-columns:repeat(2,minmax(0,1fr))}
.bn-form-grid.bn-form-dense>*{grid-column:auto/span 1}
}
/* the phone rule has to match the dense selector too: .bn-form-grid alone is
   less specific than .bn-form-grid.bn-form-dense above, so a 4-column form
   would stop halfway and stay two columns on a phone */
@media(max-width:34rem){
.bn-form-grid,.bn-form-grid.bn-form-dense{grid-template-columns:1fr}
.bn-form-grid>*,.bn-form-grid.bn-form-dense>*{grid-column:1/-1}
}
/* furniture: a rule between groups, and a line of copy among the questions */
.bn-form-sep{border:0;border-top:1px solid var(--border,#ddd);margin:.4rem 0;width:100%}
.bn-form-note{margin:0;font-size:.85rem;color:var(--text-2,#555);line-height:1.5}
.bn-form-note a,.bn-form-label a{color:var(--accent,#2b6cb0)}
.bn-form-check{display:flex;align-items:center;gap:.5rem;font-size:.9rem}
.bn-form-check input{width:auto}
.bn-form-submit{align-self:flex-start;padding:.55rem 1.1rem;border:0;border-radius:8px;background:var(--accent,#2b6cb0);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.bn-form-submit:disabled{opacity:.6;cursor:default}
.bn-form-msg{margin:0;font-size:.9rem;color:var(--text-2,#555)}
.bn-form-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
`.trim()

/** Progressive enhancement: intercept submits, POST as JSON, swap in the success
 *  message. With JS off, the native POST falls back to a themed success page.
 *  Self-guarded and delegated, so emitting it more than once is harmless. */
export const FORM_JS = `
(function(){
  if(window.__bnFormInit)return;window.__bnFormInit=1;
  document.addEventListener('submit',function(e){
    var f=e.target;
    if(!f||!f.matches||!f.matches('form[data-bn-form]'))return;
    e.preventDefault();
    var msg=f.querySelector('.bn-form-msg'),btn=f.querySelector('button[type=submit]');
    if(btn)btn.disabled=true;
    fetch(f.action,{method:'POST',headers:{accept:'application/json'},body:new URLSearchParams(new FormData(f))})
      .then(function(r){return r.json().catch(function(){return{ok:false,error:'Something went wrong.'};});})
      .then(function(d){
        if(d&&d.ok){f.reset();f.style.display='none';if(msg){msg.textContent=f.getAttribute('data-success')||'Thanks.';msg.hidden=false;}}
        else{if(msg){msg.textContent=(d&&d.error)||'Something went wrong.';msg.hidden=false;}if(btn)btn.disabled=false;}
      })
      .catch(function(){if(msg){msg.textContent='Network error — please try again.';msg.hidden=false;}if(btn)btn.disabled=false;});
  });
})();
`.trim()
