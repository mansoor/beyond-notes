// Public intake forms, composed at serve time from a table's form config.
// The markup is trusted (built here, not user block content), but every value
// that originates from user data — labels, choices, copy — is escaped.

import { escapeHtml } from './render'

export type FormFieldInput = {
  id: string
  name: string
  type: 'text' | 'longtext' | 'number' | 'checkbox' | 'date' | 'select' | 'email'
  required: boolean
  choices: string[]
  /** grid position; both default to 1 (a plain single-column stack) */
  col?: number
  width?: number
}

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
  fields: FormFieldInput[]
  captcha?: FormCaptchaInput
  /** columns to lay the fields out in; 1 (the default) emits no grid at all */
  columns?: number
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
function placementStyle(field: FormFieldInput, columns: number): string {
  if (columns < 2) return ''
  const col = Math.min(Math.max(1, Math.round(field.col ?? 1)), columns)
  const width = Math.min(Math.max(1, Math.round(field.width ?? 1)), columns - col + 1)
  return ` style="--c:${col};--w:${width}"`
}

function fieldHtml(field: FormFieldInput, columns: number): string {
  const label = escapeHtml(field.name)
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
          : field.type === 'email'
            ? 'email'
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
  const columns = Math.min(Math.max(1, Math.round(input.columns ?? 1)), 4)
  const cells = input.fields.map((f) => fieldHtml(f, columns)).join('')
  const fields =
    columns > 1 ? `<div class="bn-form-grid" style="--bn-cols:${columns}">${cells}</div>` : cells
  // honeypot: a real submitter never fills it; bots that fill every field do
  const honeypot =
    '<div class="bn-form-hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="_website" tabindex="-1" autocomplete="off"></label></div>'
  const action = escapeHtml(input.actionPath)
  const success = escapeHtml(input.successMessage)
  const submit = escapeHtml(input.submitLabel || 'Submit')
  const captcha = captchaHtml(input.captcha ?? null)
  const wide = columns > 1 ? ' bn-form-wide' : ''
  return `<div class="bn-form-wrap"><form class="bn-form${wide}" method="post" action="${action}" data-bn-form data-success="${success}">${honeypot}${title}${desc}${fields}${captcha}<button type="submit" class="bn-form-submit">${submit}</button><p class="bn-form-msg" role="status" hidden></p></form></div>`
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
.bn-form-wide{max-width:46rem}
.bn-form-grid{display:grid;grid-template-columns:repeat(var(--bn-cols,1),minmax(0,1fr));
gap:.85rem;align-items:start}
.bn-form-grid>*{grid-column:var(--c,auto)/span var(--w,1)}
@media(max-width:34rem){
.bn-form-grid{grid-template-columns:1fr}
.bn-form-grid>*{grid-column:1/-1}
}
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
