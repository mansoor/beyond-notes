import { describe, expect, it } from 'vitest'
import { FORM_CSS, FORM_JS, type FormRenderInput, formHtml } from './form'

const base: FormRenderInput = {
  actionPath: '/api/forms/tbl_123',
  title: 'Contact us',
  description: 'Drop a line',
  submitLabel: 'Send',
  successMessage: 'Thanks!',
  fields: [
    { id: 'c_name', name: 'Name', type: 'text', required: true, choices: [] },
    { id: 'c_msg', name: 'Message', type: 'longtext', required: false, choices: [] },
    { id: 'c_prio', name: 'Priority', type: 'select', required: false, choices: ['Low', 'High'] },
  ],
}

describe('formHtml', () => {
  it('renders the fields, action, and honeypot', () => {
    const html = formHtml(base)
    expect(html).toContain('action="/api/forms/tbl_123"')
    expect(html).toContain('data-bn-form')
    // honeypot is present for bots to trip on
    expect(html).toContain('name="_website"')
    // required carried through
    expect(html).toContain('<input type="text" name="c_name" required>')
    // longtext -> textarea, select -> options
    expect(html).toContain('<textarea name="c_msg"')
    expect(html).toContain('<option value="Low">Low</option>')
    expect(html).toContain('data-success="Thanks!"')
    expect(html).toContain('Send</button>')
  })

  it('escapes user-authored labels and choices', () => {
    const html = formHtml({
      ...base,
      title: '<script>bad()</script>',
      fields: [{ id: 'c', name: 'A & B', type: 'select', required: false, choices: ['<x>'] }],
    })
    expect(html).not.toContain('<script>bad()')
    expect(html).toContain('&lt;script&gt;bad()')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('<option value="&lt;x&gt;">&lt;x&gt;</option>')
  })

  it('ships self-contained CSS and JS (no external refs)', () => {
    expect(FORM_CSS).toContain('.bn-form')
    expect(FORM_JS).toContain('data-bn-form')
    expect(FORM_JS).not.toMatch(/https?:\/\//)
  })
})

describe('formHtml column layout', () => {
  it('emits no grid at all for a single-column form', () => {
    const html = formHtml({ ...base, columns: 1 })
    expect(html).not.toContain('bn-form-grid')
    expect(html).not.toContain('--c:')
    // and the same markup as a form that never mentioned columns
    expect(html).toBe(formHtml(base))
  })

  it('wraps the fields in a grid and carries each placement', () => {
    const html = formHtml({
      ...base,
      columns: 2,
      fields: [
        { id: 'c_name', name: 'Name', type: 'text', required: true, choices: [], col: 1, width: 1 },
        { id: 'c_ph', name: 'Phone', type: 'text', required: false, choices: [], col: 2, width: 1 },
        {
          id: 'c_msg',
          name: 'Message',
          type: 'longtext',
          required: false,
          choices: [],
          col: 1,
          width: 2,
        },
      ],
    })
    expect(html).toContain('<div class="bn-form-grid">')
    expect(html).toContain('style="--c:1;--w:1"')
    expect(html).toContain('style="--c:2;--w:1"')
    // the full-width message row
    expect(html).toContain('style="--c:1;--w:2"')
    // a multi-column form is allowed to be wider than the 32rem stack, and the
    // count sits on the form so its width can grow with it
    expect(html).toContain('class="bn-form bn-form-wide" style="--bn-cols:2"')
    // two columns still fit a tablet — no halving class
    expect(html).not.toContain('bn-form-dense')
  })

  it('marks a 3- or 4-wide grid so a tablet can halve it', () => {
    const wide = (columns: number) =>
      formHtml({
        ...base,
        columns,
        fields: [{ id: 'c', name: 'C', type: 'text', required: false, choices: [], col: 1 }],
      })
    expect(wide(3)).toContain('class="bn-form-grid bn-form-dense"')
    expect(wide(4)).toContain('--bn-cols:4')
    // 4 is the cap: asking for more does not widen the grid past it
    expect(wide(9)).toContain('--bn-cols:4')
    expect(FORM_CSS).toContain('.bn-form-grid.bn-form-dense{grid-template-columns:repeat(2')
  })

  it('will not let a field spill past the last column', () => {
    const html = formHtml({
      ...base,
      columns: 2,
      fields: [
        { id: 'c', name: 'C', type: 'text', required: false, choices: [], col: 2, width: 2 },
        { id: 'd', name: 'D', type: 'checkbox', required: false, choices: [], col: 9, width: 9 },
      ],
    })
    expect(html).toContain('style="--c:2;--w:1"')
    expect(html).not.toContain('--w:2')
    // checkboxes are placed too — they are fields like any other
    expect(html).toContain('class="bn-form-check" style="--c:2;--w:1"')
  })

  it('lets a narrow screen override the placement (custom props, not inline grid-column)', () => {
    // an inline `grid-column` would beat the media query and leave two columns
    // squeezed onto a phone; the placement has to arrive as variables
    expect(FORM_CSS).toContain('grid-column:var(--c,auto)/span var(--w,1)')
    expect(FORM_CSS).toMatch(/@media\(max-width:34rem\)/)
    // the phone rule must out-specify the tablet halving rule, or a 4-column
    // form stops at two columns on a phone (it did, until it was measured)
    expect(FORM_CSS).toContain(
      '.bn-form-grid,.bn-form-grid.bn-form-dense{grid-template-columns:1fr}',
    )
    expect(FORM_CSS).toContain('.bn-form-grid>*,.bn-form-grid.bn-form-dense>*{grid-column:1/-1}')
  })
})
