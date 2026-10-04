/**
 * Editions: the one seam between this (AGPL) core and an add-on build.
 *
 * The core is complete on its own; it runs as the Community edition and never
 * checks a licence. A separately distributed edition module can be named with
 * EDITION_MODULE (a package name or a file path). It is imported once at boot,
 * gets the core services it may use, and adds its own HTTP routes under
 * /api/ee/. The core asks it what to call itself and whether a named feature
 * is on, and offers it a few optional hooks into published sites (a gate,
 * visit counts, its own pages under /_bn/, markup on blog pages).
 *
 * Nothing here depends on an edition existing, and nothing in the core imports
 * one statically, so the public build and images contain no edition code.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AccessService } from './access'
import type { AuditService } from './audit'
import type { AuthService } from './auth'
import type { Config } from './config'
import type { Mailer } from './mailer'
import type { PublishedEvent } from './publishing'
import type { Repo, SpaceRow, UserRow } from './repo'
import type { SettingsService } from './settings'

/** What the web app shows about the running edition (About, Settings). */
export type EditionInfo = {
  /** machine name, e.g. 'community', 'pro' */
  name: string
  /** display name, e.g. 'Community', 'Pro' */
  label: string
  /** features switched on right now */
  features: string[]
  /** a short status line for admins, e.g. 'Licensed to Acme until 2027-09-01' */
  status: string | null
  /** true when something needs an admin's attention (expired, invalid key) */
  attention: boolean
}

/** The core services an edition may use. Kept deliberately small. */
export type EditionDeps = {
  config: Config
  repo: Repo
  auth: AuthService
  settings: SettingsService
  audit: AuditService
  /** spaces, shares and groups (access.ts); an edition manages sharing through it */
  access: AccessService
  version: string
  /** who a request is signed in as (proxy header or session cookie) */
  resolveSession: (req: {
    cookies?: Record<string, string | undefined>
    headers: any
    socket?: any
  }) => Promise<{ user: UserRow | null; token: string | null }>
  /** Sign this person in on this response (the session cookie), e.g. after SAML. */
  startSession: (reply: FastifyReply, user: UserRow) => Promise<void>
  /** outgoing email, as configured in Settings (check `configured` first) */
  mailer: Mailer
  /** published sites, for features that work with them (a newsletter) */
  sites: SiteTools
  log: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (err: unknown, msg?: string) => void
  }
}

/**
 * Who may read a published space. The core serves every site openly unless an
 * edition's gate says a space is protected; then every page, feed, sitemap and
 * search of it, and its files, go through the gate first.
 */
export type SiteGate = {
  /** this space is protected: its files leave the public set, its pages go out private + noindex */
  isGated(spaceId: string): boolean
  /**
   * Before anything of a gated space is served. Return true when the gate
   * answered the request itself (a sign-in page, a redirect); false lets the
   * page through.
   */
  check(
    space: SpaceRow,
    req: FastifyRequest,
    reply: FastifyReply,
    ctx: { basePath: string; path: string },
  ): Promise<boolean>
  /** may this request read the files (images, attachments) of this gated space? */
  allowsFiles(spaceId: string, req: FastifyRequest): boolean | Promise<boolean>
}

/** Where on a published page an edition may add markup. */
export type SiteSlot = 'blog' | 'post'

/** A GET under /_bn/ on a published site, offered to the edition first. */
export type SiteRouteContext = {
  /** '' on the site's own host, '/s/<host>' on the app's */
  basePath: string
  path: string
  query: Record<string, unknown>
}

export type SiteTools = {
  /** where a published space is reached from outside: its pages, and its files (/api/files) */
  urls(space: SpaceRow): { site: string; origin: string }
  /** a small page in the site's look; `html` is trusted (escape what goes in it) */
  noticePage(space: SpaceRow, basePath: string, heading: string, html: string): string
  /** a published page as an email: the live version, every link absolute; null = not live */
  emailFor(
    space: SpaceRow,
    pageId: string,
  ): Promise<{ title: string; html: string; text: string; url: string; date: Date } | null>
  /** be told when a page goes live; returns a function that stops it */
  onPublished(listener: (e: PublishedEvent) => void | Promise<void>): () => void
}

/** The shape an edition module's default export must have. */
export type ServerEdition = {
  name: string
  /** called once at boot, after the core services exist and before routes are served */
  register(app: FastifyInstance, deps: EditionDeps): Promise<void> | void
  /** current status; cheap, called per request by the web app */
  info(): EditionInfo
  /** optional: protect published sites */
  siteGate?: SiteGate
  /** optional: count visits to this published space (visits.ts) */
  countVisits?(spaceId: string): boolean
  /** optional: answer a GET under /_bn/ on a published site; true = answered */
  siteRoutes?(
    space: SpaceRow,
    req: FastifyRequest,
    reply: FastifyReply,
    ctx: SiteRouteContext,
  ): Promise<boolean>
  /** optional: markup for a slot on published pages (a subscribe box), '' for none */
  siteHtml?(space: SpaceRow, slot: SiteSlot, ctx: { basePath: string; pageId: string }): string
}

export const COMMUNITY: ServerEdition = {
  name: 'community',
  register() {},
  info: () => ({
    name: 'community',
    label: 'Community',
    features: [],
    status: null,
    attention: false,
  }),
}

/** The running edition plus a feature check the core can call anywhere. */
export type Edition = {
  info(): EditionInfo
  has(feature: string): boolean
}

export function editionHandle(edition: ServerEdition): Edition {
  return {
    info: () => edition.info(),
    has: (feature) => edition.info().features.includes(feature),
  }
}

/** A file path becomes a file: URL (import() needs one for absolute Windows
 *  paths); anything else is a package name, resolved as usual. */
export function toImportSpecifier(spec: string): string {
  if (/^(\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])/.test(spec)) return pathToFileURL(resolve(spec)).href
  return spec
}

function isServerEdition(v: unknown): v is ServerEdition {
  const e = v as ServerEdition | null
  return (
    !!e &&
    typeof e.name === 'string' &&
    typeof e.register === 'function' &&
    typeof e.info === 'function'
  )
}

/**
 * Import the edition module named by EDITION_MODULE, or run as Community.
 * A named module that fails to load stops the server: someone who installed a
 * paid build should hear about it, not silently get the free one.
 */
export async function loadEdition(
  spec: string,
  importer: (spec: string) => Promise<unknown> = (s) => import(toImportSpecifier(s)),
): Promise<ServerEdition> {
  if (!spec) return COMMUNITY
  let mod: unknown
  try {
    mod = await importer(spec)
  } catch (err) {
    throw new Error(`EDITION_MODULE "${spec}" could not be loaded: ${(err as Error).message}`)
  }
  const edition = (mod as { default?: unknown })?.default ?? mod
  if (!isServerEdition(edition)) {
    throw new Error(`EDITION_MODULE "${spec}" does not export an edition (name, register, info)`)
  }
  return edition
}
