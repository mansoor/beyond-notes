/**
 * Reading a public repo's documentation, for the wiki importer.
 *
 * This is the one place the server fetches a URL the user typed, so it is
 * deliberately narrow: only github.com and its raw/API hosts are reachable, the
 * path is rebuilt from parsed owner/repo/branch rather than passed through, and
 * every response is size- and time-capped. A token, when given, is used for the
 * request and never stored.
 */

const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'
const TIMEOUT_MS = 15_000
const MAX_FILE_BYTES = 400_000
const MAX_FILES = 60

export class GithubError extends Error {}

export type RepoRef = { owner: string; repo: string; ref: string | null; path: string | null }

/**
 * Accepts what people actually paste: a repo URL, a URL deep inside a branch, a
 * link to one markdown file, or bare `owner/repo`.
 */
export function parseRepoUrl(input: string): RepoRef {
  const raw = input.trim().replace(/\.git$/, '')
  if (raw === '') throw new GithubError('Enter a GitHub repository URL.')

  let owner: string | undefined
  let repo: string | undefined
  let ref: string | null = null
  let path: string | null = null

  const bare = raw.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (bare) {
    owner = bare[1]
    repo = bare[2]
  } else {
    let url: URL
    try {
      url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    } catch {
      throw new GithubError('That does not look like a URL.')
    }
    const host = url.hostname.toLowerCase()
    if (
      host !== 'github.com' &&
      host !== 'www.github.com' &&
      host !== 'raw.githubusercontent.com'
    ) {
      throw new GithubError('Only github.com repositories can be imported.')
    }
    const parts = url.pathname.split('/').filter(Boolean)
    owner = parts[0]
    repo = parts[1]
    if (host === 'raw.githubusercontent.com') {
      // /owner/repo/ref/path...
      ref = parts[2] ?? null
      path = parts.slice(3).join('/') || null
    } else if (parts[2] === 'tree' || parts[2] === 'blob') {
      ref = parts[3] ?? null
      path = parts.slice(4).join('/') || null
    }
  }

  if (!owner || !repo) throw new GithubError('Could not read owner/repo from that URL.')
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new GithubError('That owner or repository name is not valid.')
  }
  return { owner, repo, ref, path }
}

export type Fetcher = typeof fetch

async function get(
  url: string,
  token: string,
  fetcher: Fetcher,
  accept = 'application/vnd.github+json',
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetcher(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'beyond-notes-importer',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError')
      throw new GithubError('GitHub took too long to answer.')
    throw new GithubError(`Could not reach GitHub: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

function explain(status: number, what: string): GithubError {
  if (status === 404) {
    return new GithubError(`${what} not found. Private repositories need a token with read access.`)
  }
  if (status === 401 || status === 403) {
    return new GithubError(
      `GitHub refused the request (${status}) — the repository is private, or the rate limit is exhausted. A token fixes both.`,
    )
  }
  return new GithubError(`GitHub answered ${status} for ${what}.`)
}

/** Documentation-ish files that become their own page, in the order they appear. */
const POLICY_FILES = [
  'CONTRIBUTING',
  'CODE_OF_CONDUCT',
  'SECURITY',
  'SUPPORT',
  'CHANGELOG',
  'AUTHORS',
  'LICENSE',
  'LICENCE',
  'COPYING',
]

const README_NAMES = ['README.md', 'README.markdown', 'Readme.md', 'readme.md', 'README']

export type RepoDoc = { path: string; name: string; markdown: string }
export type RepoDocs = {
  owner: string
  repo: string
  ref: string
  readme: RepoDoc | null
  policies: RepoDoc[]
  docs: RepoDoc[]
  warnings: string[]
}

/** A LICENSE with no extension is still text; a .png in docs/ is not. */
function isTextDoc(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  if (/\.(md|markdown|txt|rst)$/i.test(name)) return true
  return !name.includes('.')
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'for', 'to', 'in', 'a', 'an'])

/**
 * Acronyms that repository and file names spell in lower case. Without this,
 * `cloudflare-ddns-plus` becomes "Cloudflare Ddns Plus", which reads as a typo
 * in a wiki title. The list is short and boring on purpose — anything not on it
 * is title-cased normally and the user can still edit the name.
 */
const ACRONYMS = new Set([
  'api',
  'aws',
  'cd',
  'ci',
  'cli',
  'cpu',
  'css',
  'db',
  'ddns',
  'dns',
  'gpu',
  'html',
  'http',
  'https',
  'id',
  'ip',
  'json',
  'jwt',
  'k8s',
  'oauth',
  'os',
  'pdf',
  'rss',
  's3',
  'sdk',
  'seo',
  'smtp',
  'sql',
  'ssh',
  'ssl',
  'tls',
  'ui',
  'url',
  'ux',
  'vpn',
  'xml',
  'yaml',
])

/** `cloudflare-ddns-plus` -> `Cloudflare DDNS Plus`; `CODE_OF_CONDUCT.md` -> `Code of Conduct`. */
export function titleCase(raw: string): string {
  const words = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
  // SHOUTING names are a filename convention, not emphasis — normalise them
  const shouty = /^[A-Z0-9 ]+$/.test(words.join(' '))
  return words
    .map((word, i) => {
      const w = shouty ? word.toLowerCase() : word
      const lower = w.toLowerCase()
      if (ACRONYMS.has(lower)) return lower.toUpperCase()
      if (i > 0 && SMALL_WORDS.has(lower)) return lower
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
}

function titleFromPath(path: string): string {
  return titleCase((path.split('/').pop() ?? path).replace(/\.(md|markdown|txt|rst)$/i, ''))
}

export { titleFromPath }

/**
 * Scan a repository for everything a wiki would want: the README, the policy
 * files at the root, and (optionally) the markdown under docs/.
 */
export async function fetchRepoDocs(
  input: { url: string; token?: string; includeDocs?: boolean },
  fetcher: Fetcher = fetch,
): Promise<RepoDocs> {
  const { owner, repo, ref: refFromUrl } = parseRepoUrl(input.url)
  const token = input.token ?? ''
  const warnings: string[] = []

  let ref = refFromUrl
  if (!ref) {
    const res = await get(`${API}/repos/${owner}/${repo}`, token, fetcher)
    if (!res.ok) throw explain(res.status, `${owner}/${repo}`)
    const meta = (await res.json()) as { default_branch?: string }
    ref = meta.default_branch || 'main'
  }

  const treeRes = await get(
    `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    token,
    fetcher,
  )
  if (!treeRes.ok) throw explain(treeRes.status, `the ${ref} branch`)
  const tree = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string; size?: number }>
    truncated?: boolean
  }
  const entries = (tree.tree ?? []).filter((e) => e.type === 'blob' && typeof e.path === 'string')
  if (tree.truncated)
    warnings.push('The repository is large — only part of its file list was read.')

  const paths = entries.map((e) => e.path as string)
  const rootFiles = paths.filter((p) => !p.includes('/'))

  const readmePath =
    README_NAMES.map((n) => rootFiles.find((p) => p.toLowerCase() === n.toLowerCase())).find(
      Boolean,
    ) ?? null

  const policyPaths = POLICY_FILES.map((base) =>
    rootFiles.find((p) => {
      const withoutExt = p.replace(/\.(md|markdown|txt|rst)$/i, '')
      return withoutExt.toLowerCase() === base.toLowerCase() && isTextDoc(p)
    }),
  ).filter((p): p is string => Boolean(p))

  const docPaths =
    (input.includeDocs ?? true)
      ? paths
          .filter((p) => /^(docs?|documentation)\//i.test(p) && /\.(md|markdown)$/i.test(p))
          .sort()
      : []

  const wanted = [readmePath, ...policyPaths, ...docPaths].filter((p): p is string => Boolean(p))
  const capped = wanted.slice(0, MAX_FILES)
  if (wanted.length > capped.length) {
    warnings.push(`Only the first ${MAX_FILES} files were read (${wanted.length} matched).`)
  }

  const read = async (path: string): Promise<RepoDoc | null> => {
    const res = await get(
      `${RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`,
      token,
      fetcher,
      'text/plain',
    )
    if (!res.ok) {
      warnings.push(`Skipped ${path} (GitHub answered ${res.status}).`)
      return null
    }
    const text = await res.text()
    if (text.length > MAX_FILE_BYTES) {
      warnings.push(`Skipped ${path} — larger than ${Math.round(MAX_FILE_BYTES / 1000)} kB.`)
      return null
    }
    return { path, name: titleFromPath(path), markdown: text }
  }

  const docsRead = await Promise.all(capped.map(read))
  const byPath = new Map<string, RepoDoc>()
  for (const doc of docsRead) if (doc) byPath.set(doc.path, doc)

  return {
    owner,
    repo,
    ref,
    readme: readmePath ? (byPath.get(readmePath) ?? null) : null,
    policies: policyPaths.map((p) => byPath.get(p)).filter((d): d is RepoDoc => Boolean(d)),
    docs: docPaths.map((p) => byPath.get(p)).filter((d): d is RepoDoc => Boolean(d)),
    warnings,
  }
}
