// Dependency-free syntax highlighting for the handful of languages that show
// up in self-hosting docs. Deliberately shallow: it tokenizes comments,
// strings, numbers, and keywords and gives up on anything ambiguous. Input is
// raw source; every emitted chunk is escaped here, so no unescaped text can
// reach the page even if the tokenizer is wrong.

import { escapeHtml } from './render'

type Rule = { re: RegExp; cls: string }

const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while class new await async import from export default try catch throw typeof of in null undefined true false'.split(
    ' ',
  ),
  ts: 'const let var function return if else for while class new await async import from export default try catch throw typeof of in interface type enum implements extends public private readonly null undefined true false'.split(
    ' ',
  ),
  py: 'def class return if elif else for while import from as try except raise with lambda None True False and or not in is pass yield async await'.split(
    ' ',
  ),
  sh: 'if then else elif fi for while do done case esac function return export local echo cd exit source set unset'.split(
    ' ',
  ),
  sql: 'select from where insert into values update set delete create table alter drop index join left right inner outer on group by order limit offset and or not null primary key foreign references distinct as'.split(
    ' ',
  ),
  yaml: 'true false null yes no on off'.split(' '),
}

const ALIASES: Record<string, string> = {
  javascript: 'js',
  jsx: 'js',
  typescript: 'ts',
  tsx: 'ts',
  python: 'py',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  console: 'sh',
  yml: 'yaml',
  json: 'json',
}

/** Ordered: the first rule that matches at the cursor wins. */
function rulesFor(lang: string): Rule[] {
  const common: Rule[] = [
    { re: /^"(?:[^"\\\n]|\\.)*"?/, cls: 'str' },
    { re: /^'(?:[^'\\\n]|\\.)*'?/, cls: 'str' },
    { re: /^`(?:[^`\\]|\\.)*`?/, cls: 'str' },
    { re: /^\b\d[\d_]*(?:\.\d+)?\b/, cls: 'num' },
  ]
  if (lang === 'json') {
    return [
      { re: /^"(?:[^"\\\n]|\\.)*"(?=\s*:)/, cls: 'key' },
      ...common,
      { re: /^\b(?:true|false|null)\b/, cls: 'kw' },
    ]
  }
  if (lang === 'sh') {
    return [{ re: /^#[^\n]*/, cls: 'com' }, ...common]
  }
  if (lang === 'py') {
    return [{ re: /^#[^\n]*/, cls: 'com' }, ...common]
  }
  if (lang === 'yaml') {
    return [{ re: /^#[^\n]*/, cls: 'com' }, { re: /^[\w.-]+(?=\s*:)/, cls: 'key' }, ...common]
  }
  if (lang === 'sql') {
    return [{ re: /^--[^\n]*/, cls: 'com' }, ...common]
  }
  // js/ts and the default
  return [
    { re: /^\/\/[^\n]*/, cls: 'com' },
    { re: /^\/\*[\s\S]*?(?:\*\/|$)/, cls: 'com' },
    ...common,
  ]
}

/**
 * Returns HTML for a code block's body. Unknown languages fall through to
 * plain escaped text — highlighting is a nicety, never a correctness risk.
 */
export function highlightCode(code: string, language: string): string {
  const lang = ALIASES[language.toLowerCase()] ?? language.toLowerCase()
  const keywords = new Set(KEYWORDS[lang] ?? [])
  if (keywords.size === 0 && lang !== 'json') return escapeHtml(code)

  const rules = rulesFor(lang)
  let out = ''
  let rest = code
  let guard = 0

  while (rest.length > 0 && guard++ < 20_000) {
    let matched = false
    for (const rule of rules) {
      const m = rule.re.exec(rest)
      if (m?.[0]) {
        out += `<span class="tok-${rule.cls}">${escapeHtml(m[0])}</span>`
        rest = rest.slice(m[0].length)
        matched = true
        break
      }
    }
    if (matched) continue

    // identifier: keyword or plain
    const word = /^[A-Za-z_][\w$]*/.exec(rest)
    if (word?.[0]) {
      out += keywords.has(word[0])
        ? `<span class="tok-kw">${escapeHtml(word[0])}</span>`
        : escapeHtml(word[0])
      rest = rest.slice(word[0].length)
      continue
    }

    // anything else advances one char so the loop always terminates
    out += escapeHtml(rest[0] as string)
    rest = rest.slice(1)
  }
  return out + escapeHtml(rest)
}
