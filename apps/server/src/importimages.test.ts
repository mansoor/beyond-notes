import { describe, expect, it } from 'vitest'
import { collectImageUrls, importImages, resolveImageUrl, rewriteImageUrls } from './importimages'

const RAW_BASE = 'https://raw.githubusercontent.com/acme/widgets/main'

describe('collectImageUrls', () => {
  it('finds every distinct image across the documents', () => {
    const urls = collectImageUrls([
      '# Hi\n\n![logo](docs/logo.png)\n![again](docs/logo.png)',
      'text ![shot](https://example.com/a.png) more',
      'no images here',
    ])
    expect(urls).toEqual(['docs/logo.png', 'https://example.com/a.png'])
  })
})

describe('resolveImageUrl', () => {
  const source = { rawBase: RAW_BASE }

  it('resolves the relative paths a README actually uses', () => {
    expect(resolveImageUrl('docs/logo.png', source)).toBe(`${RAW_BASE}/docs/logo.png`)
    expect(resolveImageUrl('./logo.png', source)).toBe(`${RAW_BASE}/logo.png`)
    expect(resolveImageUrl('/logo.png', source)).toBe(`${RAW_BASE}/logo.png`)
  })

  it('rewrites github blob links, which serve a web page rather than bytes', () => {
    expect(
      resolveImageUrl('https://github.com/acme/widgets/blob/main/docs/a.png?raw=true', source),
    ).toBe('https://raw.githubusercontent.com/acme/widgets/main/docs/a.png')
  })

  it('leaves a plain absolute url alone', () => {
    expect(resolveImageUrl('https://cdn.example.com/x.png', source)).toBe(
      'https://cdn.example.com/x.png',
    )
  })

  it('gives up on a relative path with nothing to resolve against', () => {
    // pasted markdown has no repo — better to leave the link than invent a host
    expect(resolveImageUrl('docs/logo.png', { rawBase: null })).toBeNull()
    expect(resolveImageUrl('data:image/png;base64,AAA', source)).toBeNull()
  })
})

/** A tiny attachments double: records what it was asked to store. */
function fakeAttachments() {
  const stored: Array<{ filename: string; mime: string; bytes: number }> = []
  let n = 0
  return {
    stored,
    service: {
      upload: async (_user: unknown, input: { filename: string; mime: string; data: Buffer }) => {
        stored.push({ filename: input.filename, mime: input.mime, bytes: input.data.byteLength })
        return { id: `att${++n}` }
      },
    } as never,
  }
}

const png = (bytes = 8) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'image/png' }),
  arrayBuffer: async () => new ArrayBuffer(bytes),
})

describe('importImages', () => {
  const user = { id: 'u1' } as never

  it('stores each image once and hands back the rewrite', async () => {
    const attachments = fakeAttachments()
    const fetcher = (async () => png()) as unknown as typeof fetch
    const result = await importImages(
      { attachments: attachments.service, fetcher },
      user,
      ['![a](docs/one.png) ![b](docs/one.png) ![c](https://x.test/two.png)'],
      { rawBase: RAW_BASE },
    )
    expect(attachments.stored.map((s) => s.filename)).toEqual(['one.png', 'two.png'])
    expect(result.rewrites.get('docs/one.png')).toBe('/api/files/att1')
    expect(result.warnings).toEqual([])
  })

  it('leaves a link alone and says why when the fetch fails', async () => {
    const attachments = fakeAttachments()
    const fetcher = (async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch
    const result = await importImages(
      { attachments: attachments.service, fetcher },
      user,
      ['![gone](docs/missing.png)'],
      { rawBase: RAW_BASE },
    )
    expect(result.rewrites.size).toBe(0)
    expect(result.warnings[0]).toMatch(/404/)
    // one dead image must not take the import down with it
    expect(attachments.stored).toHaveLength(0)
  })

  it('refuses anything that is not an image, whatever the url said', async () => {
    const attachments = fakeAttachments()
    const fetcher = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new ArrayBuffer(50),
    })) as unknown as typeof fetch
    const result = await importImages(
      { attachments: attachments.service, fetcher },
      user,
      ['![trap](https://x.test/looks-like.png)'],
      { rawBase: RAW_BASE },
    )
    expect(attachments.stored).toHaveLength(0)
    expect(result.warnings[0]).toMatch(/text\/html/)
  })
})

describe('rewriteImageUrls', () => {
  it('repoints what was stored and leaves the rest untouched', () => {
    const md = '![a](docs/one.png) and ![b](https://x.test/keep.png)'
    const out = rewriteImageUrls(md, new Map([['docs/one.png', '/api/files/att1']]))
    expect(out).toBe('![a](/api/files/att1) and ![b](https://x.test/keep.png)')
  })

  it('is a no-op with nothing to rewrite', () => {
    expect(rewriteImageUrls('![a](x.png)', new Map())).toBe('![a](x.png)')
  })
})
