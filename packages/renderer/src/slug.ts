const COMBINING_MARKS = /\p{M}/gu

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '') // strip diacritics left over from NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'page'
}
