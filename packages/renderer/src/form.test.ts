import { describe, expect, it } from 'vitest'
import { FORM_CSS, FORM_JS, type FormRenderInput, formHtml, richTextHtml } from './form'

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

describe('richTextHtml', () => {
  it('turns [label](url) into a link and leaves the rest as plain text', () => {
    expect(richTextHtml('I accept the [terms](https://ex.com/t) and rules')).toBe(
      'I accept the <a href="https://ex.com/t" target="_blank" rel="noopener noreferrer">terms</a> and rules',
    )
    expect(richTextHtml('mail [us](mailto:hi@ex.com)')).toContain('href="mailto:hi@ex.com"')
    expect(richTextHtml('see [privacy](/privacy)')).toContain('href="/privacy"')
  })

  it('emits nothing but text and anchors, whatever it is fed', () => {
    // the shapes an author could try: raw markup, an event handler, a script
    expect(richTextHtml('<b>bold</b> & <script>x()</script>')).toBe(
      '&lt;b&gt;bold&lt;/b&gt; &amp; &lt;script&gt;x()&lt;/script&gt;',
    )
    expect(richTextHtml('<img src=x onerror=alert(1)>')).not.toContain('<img')
    // an unsafe scheme is not a link — it is shown as the text it was
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x']) {
      const html = richTextHtml(`[click](${bad})`)
      expect(html).not.toContain('<a ')
      expect(html).not.toContain('javascript:alert(1)"')
    }
    // a quote in the url cannot break out of the href attribute
    expect(richTextHtml('[x](https://ex.com/" onmouseover="y)')).not.toContain('onmouseover="y"')
  })
})

describe('form blocks and label overrides', () => {
  const field = (over: Record<string, unknown> = {}) => ({
    id: 'c_name',
    name: 'Name',
    type: 'text' as const,
    required: false,
    choices: [],
    ...over,
  })

  it('shows the override instead of the column name, links and all', () => {
    const html = formHtml({
      ...base,
      fields: [field({ label: 'I accept the [terms](https://ex.com/t)' })],
    })
    expect(html).toContain('<a href="https://ex.com/t" target="_blank" rel="noopener noreferrer">')
    expect(html).not.toContain('>Name<')
    // the field itself is untouched: the column id is still what is submitted
    expect(html).toContain('name="c_name"')
  })

  it('falls back to the column name when the override is blank', () => {
    expect(formHtml({ ...base, fields: [field({ label: '   ' })] })).toContain('Name')
  })

  it('renders a separator and a text block in place, and places them in the grid', () => {
    const html = formHtml({
      ...base,
      columns: 2,
      fields: [
        field({ col: 1, width: 1 }),
        { item: 'divider', id: 'b1', col: 1, width: 2 },
        {
          item: 'text',
          id: 'b2',
          text: 'Where to reach you — see [privacy](/p)',
          col: 1,
          width: 2,
        },
      ],
    })
    expect(html).toContain('<hr class="bn-form-sep" style="--c:1;--w:2">')
    expect(html).toContain('<p class="bn-form-note" style="--c:1;--w:2">')
    expect(html).toContain('href="/p"')
    // order is preserved: the rule sits between the field and the note
    expect(html.indexOf('name="c_name"')).toBeLessThan(html.indexOf('bn-form-sep'))
    expect(html.indexOf('bn-form-sep')).toBeLessThan(html.indexOf('bn-form-note'))
  })

  it('drops an empty text block rather than leaving a blank line', () => {
    const html = formHtml({ ...base, fields: [field(), { item: 'text', id: 'b', text: '  ' }] })
    expect(html).not.toContain('bn-form-note')
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
