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
