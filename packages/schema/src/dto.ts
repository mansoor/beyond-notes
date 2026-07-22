import { z } from 'zod'

export const emailSchema = z.string().trim().toLowerCase().email().max(254)
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200)
export const nameSchema = z.string().trim().min(1).max(80)

export const setupInput = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
})
export type SetupInput = z.infer<typeof setupInput>

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  totpCode: z.string().trim().max(20).optional(),
})

export const changePasswordInput = z.object({
  current: z.string().min(1).max(200),
  next: passwordSchema,
})

export const totpConfirmInput = z.object({ code: z.string().trim().min(6).max(20) })

export const requestPasswordResetInput = z.object({ email: emailSchema })

export const updateProfileInput = z.object({ name: nameSchema, email: emailSchema })

export const resetPasswordInput = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})

export type SessionView = {
  id: string
  createdAt: string
  expiresAt: string
  current: boolean
}

export type SearchResult = {
  kind: 'page' | 'memo'
  id: string
  title: string
  context: string
  snippet: string
}
export type LoginInput = z.infer<typeof loginInput>

export const createInviteInput = z.object({
  suggestedEmail: emailSchema.optional(),
  role: z.enum(['admin', 'member']).default('member'),
  // email the link to suggestedEmail (requires SMTP; ignored without it)
  sendEmail: z.boolean().default(false),
})
export type CreateInviteInput = z.infer<typeof createInviteInput>

export const acceptInviteInput = z.object({
  token: z.string().min(20).max(200),
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
})
export type AcceptInviteInput = z.infer<typeof acceptInviteInput>

export type UserView = {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
  emailNotifications: boolean
  /** sidebar sections/spaces this user has hidden — see sidebarTokenPattern */
  sidebarHidden: string[]
  /** how many days ahead "Coming up" reaches for tasks */
  taskDays: number
  /** …and for reminders, which are usually set much further out */
  reminderDays: number
  /** ask "are you sure?" before a page goes to the Trash */
  confirmDelete: boolean
  createdAt: string
}

export type InviteView = {
  id: string
  suggestedEmail: string | null
  role: 'admin' | 'member'
  createdAt: string
  expiresAt: string
  status: 'pending' | 'used' | 'revoked' | 'expired'
}

export type AuthStatus = {
  needsSetup: boolean
  me: UserView | null
  // SMTP present on this deployment: gates "Forgot password?" and emailed invites
  mailConfigured: boolean
}

// ---- spaces & pages (M1) ----

export const spaceCategory = z.enum(['notebook', 'wiki', 'site'])
export type SpaceCategory = z.infer<typeof spaceCategory>

export const createSpaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  category: spaceCategory.default('notebook'),
  personal: z.boolean().default(false),
})
export type CreateSpaceInput = z.infer<typeof createSpaceInput>

export type SpaceView = {
  id: string
  name: string
  category: SpaceCategory
  personal: boolean
  publicEnabled: boolean
  publicHost: string | null
  publicTitle: string | null
  publicFooter: string | null
  publicTheme: SiteTheme
  publicAppearance: SiteAppearance
  publicSocial: SocialLinkValue[]
  publicLogoAttachmentId: string | null
  publicTagline: string | null
  publicHeaderLayout: SiteHeaderLayoutName
  publicTitleSize: SiteTitleSize
  publicLogoSize: SiteLogoSize
  publicFaviconAttachmentId: string | null
  analyticsProvider: AnalyticsProviderName
  analyticsSiteId: string | null
  analyticsHost: string | null
  createdAt: string
}

export const createPageInput = z.object({
  spaceId: z.string(),
  parentId: z.string().nullable().default(null),
  title: z.string().trim().max(300).default(''),
  /**
   * Drop the new page directly after this sibling instead of at the end of the
   * group — what "Add sibling" on a page's ＋ means. Omit to append, which is
   * what the notebook/site/wiki-level ＋ wants.
   */
  afterPageId: z.string().nullable().default(null),
})
export type CreatePageInput = z.infer<typeof createPageInput>

export const renamePageInput = z.object({
  pageId: z.string(),
  title: z.string().trim().min(1).max(300),
})

export const movePageInput = z.object({
  pageId: z.string(),
  parentId: z.string().nullable(),
  index: z.number().int().min(0),
  // set to another tree space to move the whole subtree across spaces
  // (this is how a note becomes a blog post)
  spaceId: z.string().optional(),
})
export type MovePageInput = z.infer<typeof movePageInput>

export const saveDocumentInput = z.object({
  pageId: z.string(),
  // BlockNote block array, JSON-stringified by the client
  content: z.string().max(2_000_000),
  baseUpdatedAt: z.string(),
})
export type SaveDocumentInput = z.infer<typeof saveDocumentInput>

export type PageMeta = {
  id: string
  spaceId: string
  parentId: string | null
  title: string
  position: number
  pageType: 'doc' | 'blog' | 'gallery'
  galleryLayout: GalleryLayoutName
  galleryAutoplaySecs: number | null
  blogLayout: BlogLayoutName
  category: string | null
  shareEnabled: boolean
  coverAttachmentId: string | null
  metaDescription: string | null
  icon: string | null
}

/** The minimum shape the tree walkers below need: an id and its parent. */
type TreeNode = { id: string; parentId: string | null }

/**
 * A page id plus every descendant's, walked over one space's page list.
 *
 * Archive, trash, and restore all act on a whole subtree, so both sides need
 * the same answer to "what goes with it": the server to write the rows, the
 * browser to know whether the page it is showing was one of them.
 */
export function pageSubtreeIds<T extends TreeNode>(all: T[], rootId: string): string[] {
  const ids = [rootId]
  const queue = [rootId]
  while (queue.length > 0) {
    const parentId = queue.shift()
    for (const child of all.filter((p) => p.parentId === parentId)) {
      ids.push(child.id)
      queue.push(child.id)
    }
  }
  return ids
}

/**
 * Where the editor should go when `removedId` and its subtree are taken away:
 * the next sibling, else the previous one, else the parent. Null means the
 * space has no pages left and the caller should show its empty state.
 *
 * Callers must pass the list as it was *before* the removal — the point is to
 * find the neighbour, which needs the departing page still in place to measure
 * from.
 */
export function pageAfterRemoval<T extends TreeNode & { position: number }>(
  all: T[],
  removedId: string,
): string | null {
  const removed = all.find((p) => p.id === removedId)
  if (!removed) return null
  const gone = new Set(pageSubtreeIds(all, removedId))
  const siblings = all
    .filter((p) => p.parentId === removed.parentId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const self = siblings.findIndex((p) => p.id === removedId)
  for (let i = self + 1; i < siblings.length; i++) {
    const next = siblings[i]
    if (next && !gone.has(next.id)) return next.id
  }
  for (let i = self - 1; i >= 0; i--) {
    const prev = siblings[i]
    if (prev && !gone.has(prev.id)) return prev.id
  }
  return removed.parentId && !gone.has(removed.parentId) ? removed.parentId : null
}

export const galleryLayoutName = z.enum(['grid', 'carousel', 'filmstrip', 'mosaic'])
export type GalleryLayoutName = z.infer<typeof galleryLayoutName>

/** How a blog page arranges its posts: a dated list, or cards in a grid. */
export const blogLayoutName = z.enum(['list', 'grid'])
export type BlogLayoutName = z.infer<typeof blogLayoutName>

/**
 * Categories are free text, not rows: a page holds the name it was given and
 * the set of choices is whatever the pages of that space already use. No
 * table to keep in sync, and renaming is "type it again" — the cost is that
 * two spellings are two categories, which is why the picker offers the
 * existing ones first.
 */
export const pageCategory = z.string().trim().max(60)

/**
 * The sections share one tree but are different products: wikis are plain
 * docs, notebooks add galleries, only sites publish blogs. Single source of
 * truth for the server-side rule and both UI menus.
 */
export const pageTypesByCategory: Record<
  SpaceCategory,
  ReadonlyArray<'doc' | 'blog' | 'gallery'>
> = {
  wiki: ['doc'],
  notebook: ['doc', 'gallery'],
  site: ['doc', 'blog', 'gallery'],
}

export const updatePageOptionsInput = z.object({
  pageId: z.string(),
  galleryLayout: galleryLayoutName.optional(),
  // null = autoplay off; only meaningful for carousel/filmstrip layouts
  galleryAutoplaySecs: z.number().int().min(2).max(60).nullable().optional(),
  blogLayout: blogLayoutName.optional(),
  // null clears the category; undefined leaves it unchanged
  category: pageCategory.nullable().optional(),
  shareEnabled: z.boolean().optional(),
  // null clears the cover; undefined leaves it unchanged
  coverAttachmentId: z.string().nullable().optional(),
  // SEO description for published sites; null clears
  metaDescription: z.string().trim().max(300).nullable().optional(),
  // a Material Symbols name (or a legacy emoji) shown in the sidebar and
  // published nav; null clears
  icon: z.string().trim().min(1).max(48).nullable().optional(),
})

export type ArchivedPageView = {
  id: string
  title: string
  pageType: 'doc' | 'blog' | 'gallery'
  spaceName: string
  archivedAt: string
  archivedByName: string
}

export type TrashedPageView = {
  id: string
  title: string
  pageType: 'doc' | 'blog' | 'gallery'
  spaceName: string
  trashedAt: string
  trashedByName: string
  /** ISO date when the purge job will hard-delete it */
  purgeAt: string
}

// ---- backlinks ----

export type BacklinkView = { id: string; title: string; spaceName: string }

// ---- templates ----

export const createTemplateInput = z.object({
  name: z.string().trim().min(1).max(80),
  pageId: z.string(),
})

export type TemplateView = { id: string; name: string; createdAt: string }

export const setPageTypeInput = z.object({
  pageId: z.string(),
  pageType: z.enum(['doc', 'blog', 'gallery']),
})

export type GalleryItemView = {
  id: string
  attachmentId: string
  caption: string
  position: number
  url: string
  thumbUrl: string
}

export type DocumentView = {
  content: string
  schemaVersion: number
  updatedAt: string
}

// ---- journal, inbox, tasks (M2) ----

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
export const timeKey = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM')

export const journalDayInput = z.object({ date: dateKey })
export const journalMonthInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM'),
})

export const captureMemoInput = z.object({
  content: z.string().trim().min(1).max(5000),
})

export const promoteToNoteInput = z.object({
  memoId: z.string(),
  spaceId: z.string(),
})

// no date: the journal day is derived from the memo's own capture time, so the
// caller cannot file it under a day that disagrees with its timestamp
export const promoteToJournalInput = z.object({
  memoId: z.string(),
})

export const promoteToTaskInput = z.object({
  memoId: z.string(),
})

export const quickAddTaskInput = z.object({
  // free text; a trailing @YYYY-MM-DD token becomes the due date
  text: z.string().trim().min(1).max(500),
})

export const toggleTaskInput = z.object({
  taskId: z.string(),
  checked: z.boolean(),
})

export type MemoView = {
  id: string
  content: string
  createdAt: string
  promotedTo: 'note' | 'journal' | 'task' | null
}

// ---- publishing (M3) ----

export const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+(:\d+)?$/, 'Host names only, e.g. docs.example.com')
  .max(255)

export const siteTheme = z.enum(['paper', 'ink', 'mist', 'sand', 'bloom'])
export type SiteTheme = z.infer<typeof siteTheme>

export const siteAppearance = z.enum(['auto', 'light', 'dark', 'toggle'])
export type SiteAppearance = z.infer<typeof siteAppearance>

export const siteHeaderLayout = z.enum(['classic', 'centered', 'split', 'minimal'])
export type SiteHeaderLayoutName = z.infer<typeof siteHeaderLayout>

/**
 * How loud the wordmark is, and how much room the logo takes. Sizes rather
 * than pixels: a site picks a weight for its own name, and the header keeps
 * its proportions at every one of them. 'md' is what sites rendered before
 * these settings existed.
 */
export const siteTitleSize = z.enum(['sm', 'md', 'lg', 'xl'])
export type SiteTitleSize = z.infer<typeof siteTitleSize>
export const siteLogoSize = z.enum(['sm', 'md', 'lg'])
export type SiteLogoSize = z.infer<typeof siteLogoSize>

/** Both in one place, so the renderer and the settings preview cannot drift. */
export const SITE_TITLE_PX: Record<SiteTitleSize, number> = { sm: 15, md: 17, lg: 21, xl: 26 }
export const SITE_LOGO_PX: Record<SiteLogoSize, number> = { sm: 30, md: 44, lg: 60 }

export const socialPlatform = z.enum([
  'github',
  'x',
  'instagram',
  'youtube',
  'linkedin',
  'facebook',
  'mastodon',
  'bluesky',
  'email',
  'website',
])
export type SocialPlatformName = z.infer<typeof socialPlatform>

export const socialLinkInput = z.object({
  platform: socialPlatform,
  url: z.string().trim().min(1).max(500),
})
export type SocialLinkValue = z.infer<typeof socialLinkInput>

export const analyticsProvider = z.enum(['none', 'plausible', 'umami', 'ga4'])
export type AnalyticsProviderName = z.infer<typeof analyticsProvider>

/** Ids and hosts are validated again in the renderer before they reach a script
 *  tag; this is the friendly first pass, not the security boundary. */
export const updateAnalyticsInput = z.object({
  spaceId: z.string(),
  provider: analyticsProvider,
  siteId: z.string().trim().max(64).nullable().default(null),
  host: z.string().trim().max(120).nullable().default(null),
})

export const updatePublishingInput = z.object({
  spaceId: z.string(),
  enabled: z.boolean(),
  host: hostSchema.nullable(),
  title: z.string().trim().max(120).nullable(),
  footer: z.string().trim().max(300).nullable(),
  theme: siteTheme.default('paper'),
  appearance: siteAppearance.default('auto'),
  social: z.array(socialLinkInput).max(10).default([]),
  logoAttachmentId: z.string().nullable().default(null),
  faviconAttachmentId: z.string().nullable().default(null),
  tagline: z.string().trim().max(160).nullable().default(null),
  headerLayout: siteHeaderLayout.default('classic'),
  titleSize: siteTitleSize.default('md'),
  logoSize: siteLogoSize.default('md'),
})
export type UpdatePublishingInput = z.infer<typeof updatePublishingInput>

export type PublishingView = {
  spaceEnabled: boolean
  host: string | null
  live: { versionId: string; version: number; publishedAt: string } | null
  pending: boolean
  slugPath: string | null
  /** ISO time of a pending scheduled publish, if one is set */
  scheduledAt: string | null
}

// ---- draft previews + scheduled publishing ----

export type PreviewView = { id: string; createdAt: string }

export const schedulePublishInput = z.object({
  pageId: z.string(),
  /** ISO datetime, must be in the future */
  at: z.string().datetime({ offset: true }).or(z.string().datetime()),
})

export type VersionView = {
  id: string
  version: number
  title: string
  createdAt: string
  isLive: boolean
  /** plain text of the snapshot — the History dialog diffs consecutive versions */
  textPlain: string
}

// ---- reminders (M5) ----

export const reminderFreq = z.enum(['daily', 'weekly', 'monthly', 'yearly'])
export type ReminderFreq = z.infer<typeof reminderFreq>

/** One emoji, or null for the default bell. Kept short so it stays an icon. */
export const reminderIcon = z.string().trim().min(1).max(8).nullable()

export const createReminderInput = z.object({
  title: z.string().trim().min(1).max(200),
  icon: reminderIcon.default(null),
  dueDate: dateKey,
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .default(null),
  freq: reminderFreq.nullable().default(null),
  interval: z.number().int().min(1).max(365).default(1),
  headsUpDays: z.number().int().min(1).max(365).nullable().default(null),
})
export type CreateReminderInput = z.infer<typeof createReminderInput>

/** Everything about a reminder is editable after the fact. */
export const updateReminderInput = createReminderInput.extend({ id: z.string() })
export type UpdateReminderInput = z.infer<typeof updateReminderInput>

/**
 * Editing a task rewrites its checklist block: text plus an optional due date
 * and an optional time-of-day. A time only makes sense with a date, so it is
 * dropped server-side when `due` is null.
 */
export const updateTaskInput = z.object({
  taskId: z.string(),
  text: z.string().trim().min(1).max(500),
  due: dateKey.nullable(),
  dueTime: timeKey.nullable().default(null),
})

export const updateMemoInput = z.object({
  memoId: z.string(),
  content: z.string().trim().min(1).max(5000),
})

export type ReminderView = {
  id: string
  title: string
  icon: string | null
  dueDate: string
  dueTime: string | null
  freq: ReminderFreq | null
  interval: number
  headsUpDays: number | null
  completed: boolean
}

export type TaskView = {
  id: string
  pageId: string
  blockId: string
  text: string
  checked: boolean
  due: string | null
  dueTime: string | null
  pageTitle: string
  spaceName: string
  isJournal: boolean
}

// ---- server settings (admin-editable, stored in the settings table) ----

export const smtpSettings = z.object({
  host: z.string().trim().max(255).default(''),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().max(255).default(''),
  // empty string on save = keep the stored password (never echoed to the UI)
  pass: z.string().max(255).default(''),
  from: z.string().trim().max(255).default(''),
})
export type SmtpSettings = z.infer<typeof smtpSettings>

export const ntfySettings = z.object({
  url: z.string().trim().max(500).default(''),
  topic: z.string().trim().max(200).default(''),
})
export type NtfySettings = z.infer<typeof ntfySettings>

// Google reCAPTCHA v2 keys, instance-wide (reCAPTCHA is registered per domain).
// siteKey is public (embedded in the form); secretKey is server-only.
export const recaptchaSettings = z.object({
  siteKey: z.string().trim().max(200).default(''),
  // empty string on save = keep the stored secret
  secretKey: z.string().max(200).default(''),
})
export type RecaptchaSettings = z.infer<typeof recaptchaSettings>

export const storageDriver = z.enum(['fs', 'db', 's3'])
export type StorageDriver = z.infer<typeof storageDriver>

export const storageSettings = z.object({
  driver: storageDriver.default('fs'),
  s3Bucket: z.string().trim().max(255).default(''),
  s3Endpoint: z.string().trim().max(500).default(''),
  s3Region: z.string().trim().max(100).default('us-east-1'),
  s3AccessKey: z.string().max(255).default(''),
  // empty string on save = keep the stored secret
  s3SecretKey: z.string().max(255).default(''),
  s3ForcePathStyle: z.boolean().default(true),
})
export type StorageSettings = z.infer<typeof storageSettings>

export type ServerSettingsView = {
  smtp: Omit<SmtpSettings, 'pass'> & { hasPass: boolean }
  ntfy: NtfySettings
  storage: Omit<StorageSettings, 's3SecretKey'> & { hasSecret: boolean }
  recaptcha: { siteKey: string; hasSecret: boolean }
  // which sources are effectively active right now (db beats env)
  mailSource: 'db' | 'env' | 'off'
  ntfySource: 'db' | 'env' | 'off'
}

// ---- webhooks ----

export const webhookTarget = z.enum(['inbox', 'today', 'tasks'])
export type WebhookTarget = z.infer<typeof webhookTarget>

export const createWebhookInput = z.object({
  target: webhookTarget,
  label: z.string().trim().min(1).max(80),
})

export type WebhookView = {
  id: string
  target: WebhookTarget
  label: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

// ---- tags ----

export type TagCount = { tag: string; count: number }

export type PageTagView = { tag: string; source: 'inline' | 'manual' }

// same shape the inline extractor accepts: letter/digit start, ≤50 chars
export const tagName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,49}$/u, 'Tags are letters, digits, _ or -')

export const pageTagInput = z.object({ pageId: z.string(), tag: tagName })

// ---- pins + recents ----

export type PinView = { pageId: string; title: string; pageType: 'doc' | 'blog' | 'gallery' }

export type StalePage = {
  id: string
  title: string
  spaceName: string
  updatedAt: string
  /** whole days since the last edit */
  ageDays: number
  isLive: boolean
}

export type RecentPage = {
  id: string
  title: string
  spaceName: string
  pageType: 'doc' | 'blog' | 'gallery'
  updatedAt: string
}

export type TagItem = {
  kind: 'page' | 'memo'
  id: string
  title: string
  // where it lives: space name, 'Journal', or 'Inbox'
  context: string
  // set for journal day pages so the UI can link to /day/<date>
  dateKey: string | null
}

// ---- journal day notes ----

export const createDayNoteInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(120),
})

// ---- data tables (lightweight structured data / forms) ----

export const dbColumnType = z.enum([
  'text',
  'longtext',
  'number',
  'checkbox',
  'date',
  'select',
  'email',
])
export type DbColumnType = z.infer<typeof dbColumnType>

/**
 * A column definition, as stored inside db_tables.columns (a JSON array). `id`
 * is a stable slug assigned by the server — row cells key by it, so a rename or
 * reorder never rewrites a single row. `choices` is only meaningful for select.
 */
/** Optional per-column data-integrity rules, enforced on grid edits and form
 * submissions alike. Which fields apply depends on the column type. */
export type DbColumnConstraints = {
  // text / longtext / email
  minLength?: number
  maxLength?: number
  pattern?: string
  // number
  min?: number
  max?: number
  // shown instead of the default when a rule fails
  message?: string
}

export type DbColumn = {
  id: string
  name: string
  type: DbColumnType
  required: boolean
  choices: string[]
  constraints?: DbColumnConstraints
}

export const dbColumnConstraints = z.object({
  minLength: z.number().int().min(0).max(100000).optional(),
  maxLength: z.number().int().min(0).max(100000).optional(),
  pattern: z.string().max(300).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  message: z.string().trim().max(200).optional(),
})

/** A single cell value. Stored as-is inside db_rows.cells. */
export type DbCellValue = string | number | boolean | null
export const dbCellValue = z.union([z.string(), z.number(), z.boolean(), z.null()])

// A database is the container: it owns visibility and holds tables.
export const createDatabaseInput = z.object({
  name: z.string().trim().min(1).max(80),
  personal: z.boolean().default(false),
})
export type CreateDatabaseInput = z.infer<typeof createDatabaseInput>

export const renameDatabaseInput = z.object({
  databaseId: z.string(),
  name: z.string().trim().min(1).max(80),
})

export const deleteDatabaseInput = z.object({ databaseId: z.string() })

export type DatabaseView = {
  id: string
  name: string
  personal: boolean
  createdAt: string
  updatedAt: string
}

export const createTableInput = z.object({
  databaseId: z.string(),
  name: z.string().trim().min(1).max(80),
})
export type CreateTableInput = z.infer<typeof createTableInput>

export const renameTableInput = z.object({
  tableId: z.string(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().default(null),
})

/** A column as proposed by the schema editor. `id` is absent for new columns; the
 * server assigns one and preserves existing ids. */
export const dbColumnDraft = z.object({
  id: z.string().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(80),
  type: dbColumnType,
  required: z.boolean().default(false),
  choices: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  constraints: dbColumnConstraints.optional(),
})
export type DbColumnDraft = z.infer<typeof dbColumnDraft>

export const updateTableColumnsInput = z.object({
  tableId: z.string(),
  columns: z.array(dbColumnDraft).max(50),
})

export const deleteTableInput = z.object({ tableId: z.string() })
export const duplicateTableInput = z.object({ tableId: z.string() })
export const moveTableInput = z.object({ tableId: z.string(), databaseId: z.string() })
export const archiveTableInput = z.object({ tableId: z.string() })
export const restoreTableInput = z.object({ tableId: z.string() })

export type ArchivedTableView = {
  id: string
  name: string
  databaseName: string
  archivedAt: string
}

export const insertRowInput = z.object({
  tableId: z.string(),
  // validated against the table's columns in the service, not here
  cells: z.record(z.string(), dbCellValue),
})

export const updateRowInput = z.object({
  rowId: z.string(),
  cells: z.record(z.string(), dbCellValue),
})

export const deleteRowInput = z.object({ rowId: z.string() })

/**
 * A form is a table's public intake: which columns it exposes, and the copy
 * shown around them. Stored as JSON on the table; null = no form. The embed
 * token `[[form:<tableId>]]` expands to this at serve time.
 */
export const captchaMode = z.enum(['none', 'basic', 'recaptcha'])
export type CaptchaMode = z.infer<typeof captchaMode>

/**
 * Where one field sits in the form grid: it starts in column `col` and spans
 * `width` columns. A field may never spill past the last column — which is
 * why the widths on offer depend on the column chosen (in a 2-column form,
 * column 1 can be 2 wide, column 2 can only be 1).
 */
export const FORM_MAX_COLUMNS = 4
export const formFieldPlacement = z.object({
  col: z.number().int().min(1).max(FORM_MAX_COLUMNS),
  width: z.number().int().min(1).max(FORM_MAX_COLUMNS),
})
export type FormFieldPlacement = z.infer<typeof formFieldPlacement>

/** The widths a field starting in `col` may take. Never empty. */
export function formWidthChoices(col: number, columns: number): number[] {
  const cols = clampFormColumns(columns)
  const start = Math.min(Math.max(1, Math.round(col) || 1), cols)
  return Array.from({ length: cols - start + 1 }, (_, i) => i + 1)
}

export function clampFormColumns(columns: number | undefined): number {
  return Math.min(Math.max(1, Math.round(columns ?? 1) || 1), FORM_MAX_COLUMNS)
}

/** Fit one placement to the grid, filling in anything missing or nonsensical. */
export function placeFormField(
  placement: Partial<FormFieldPlacement> | undefined,
  columns: number,
): FormFieldPlacement {
  const cols = clampFormColumns(columns)
  const col = Math.min(Math.max(1, Math.round(placement?.col ?? 1) || 1), cols)
  const width = Math.min(Math.max(1, Math.round(placement?.width ?? 1) || 1), cols - col + 1)
  return { col, width }
}

/**
 * Placements for exactly the fields on the form, in the grid it declares.
 * Rebuilt rather than patched, so a field that left the form takes its
 * placement with it, and a form saved before layouts existed still lands in a
 * valid single column.
 */
export function normalizeFormLayout(
  fields: string[],
  columns: number | undefined,
  layout: Record<string, Partial<FormFieldPlacement>> | undefined,
): Record<string, FormFieldPlacement> {
  const cols = clampFormColumns(columns)
  const out: Record<string, FormFieldPlacement> = {}
  for (const id of fields) out[id] = placeFormField(layout?.[id], cols)
  return out
}

/**
 * A block is form furniture that is not a column: a rule that separates one
 * group of questions from the next, or a line of explanatory text. Blocks sit
 * in the same order and the same grid as the fields, and carry no data — a
 * submission never mentions them.
 */
export const formBlock = z.object({
  id: z.string().trim().min(1).max(40),
  kind: z.enum(['divider', 'text']),
  // markdown-lite: plain text plus [label](https://…) links; see richTextHtml
  text: z.string().trim().max(500).default(''),
})
export type FormBlock = z.infer<typeof formBlock>

/**
 * Render order for everything on the form — field ids and block ids in one
 * list. Ids that no longer exist are dropped and anything missing is appended,
 * so a form still renders after a column is deleted or a new one is ticked.
 */
export function normalizeFormOrder(ids: string[], order: string[] | undefined): string[] {
  const known = new Set(ids)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of order ?? []) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  for (const id of ids) if (!seen.has(id)) out.push(id)
  return out
}

export type FormConfig = {
  enabled: boolean
  // ordered column ids exposed as fields (a subset of the table's columns)
  fields: string[]
  // how many columns the fields are laid out in (1 = a plain stack)
  columns: number
  // fieldId/blockId -> where it sits; see normalizeFormLayout
  layout: Record<string, FormFieldPlacement>
  // fieldId -> label shown instead of the column name (blank = use the name)
  labels: Record<string, string>
  // dividers and text blocks, keyed into `order` by id
  blocks: FormBlock[]
  // fields and blocks interleaved, in render order
  order: string[]
  title: string
  description: string
  submitLabel: string
  successMessage: string
  // notify the owner on each submission (via configured ntfy/email channels)
  notify: boolean
  // spam protection: a self-hosted math challenge, or Google reCAPTCHA
  captcha: CaptchaMode
}

export const formConfigInput = z.object({
  enabled: z.boolean().default(false),
  fields: z.array(z.string()).max(50).default([]),
  columns: z.number().int().min(1).max(FORM_MAX_COLUMNS).default(1),
  layout: z.record(z.string(), formFieldPlacement).default({}),
  labels: z.record(z.string(), z.string().trim().max(200)).default({}),
  blocks: z.array(formBlock).max(30).default([]),
  order: z.array(z.string()).max(80).default([]),
  captcha: captchaMode.default('none'),
  title: z.string().trim().max(120).default(''),
  description: z.string().trim().max(500).default(''),
  submitLabel: z.string().trim().min(1).max(40).default('Submit'),
  successMessage: z.string().trim().max(300).default('Thanks — your response was received.'),
  notify: z.boolean().default(false),
})

export const updateFormInput = z.object({
  tableId: z.string(),
  // null removes the form entirely
  form: formConfigInput.nullable(),
})

export type DbTableView = {
  id: string
  databaseId: string
  name: string
  description: string | null
  columns: DbColumn[]
  form: FormConfig | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export type DbRowView = {
  id: string
  tableId: string
  cells: Record<string, DbCellValue>
  source: 'manual' | 'form'
  createdAt: string
  updatedAt: string
}

export type CellCheck =
  | { ok: true; cells: Record<string, DbCellValue> }
  | { ok: false; error: string }

/**
 * Coerce and validate a proposed row against a table's columns. Keeps only
 * known columns (orphan keys from dropped columns are dropped). `requireAll`
 * enforces `required` — off for grid edits (you fill a row after adding it),
 * on for public form submissions.
 */
export function validateRowCells(
  columns: DbColumn[],
  input: Record<string, unknown>,
  opts: { requireAll?: boolean } = {},
): CellCheck {
  const out: Record<string, DbCellValue> = {}
  // a constraint failure prefers the column's custom message
  const fail = (col: DbColumn, fallback: string): CellCheck => ({
    ok: false,
    error: col.constraints?.message || fallback,
  })
  for (const col of columns) {
    const raw = input[col.id]
    const empty = raw === undefined || raw === null || raw === ''
    if (empty) {
      if (opts.requireAll && col.required) return { ok: false, error: `"${col.name}" is required.` }
      out[col.id] = null
      continue
    }
    switch (col.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
        if (!Number.isFinite(n)) return fail(col, `"${col.name}" must be a number.`)
        out[col.id] = n
        break
      }
      case 'checkbox':
        out[col.id] = raw === true || raw === 'true' || raw === 1 || raw === '1'
        break
      case 'date': {
        const s = String(raw).trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
          return fail(col, `"${col.name}" must be a date (YYYY-MM-DD).`)
        out[col.id] = s
        break
      }
      case 'select': {
        const s = String(raw)
        if (col.choices.length > 0 && !col.choices.includes(s))
          return fail(col, `"${col.name}" must be one of its choices.`)
        out[col.id] = s
        break
      }
      case 'email': {
        const s = String(raw).trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254)
          return fail(col, `"${col.name}" must be a valid email.`)
        out[col.id] = s
        break
      }
      default: {
        // text / longtext
        out[col.id] = String(raw).slice(0, col.type === 'longtext' ? 10000 : 2000)
      }
    }

    // per-column constraints, applied to the coerced value
    const c = col.constraints
    const value = out[col.id]
    if (c && col.type === 'number' && typeof value === 'number') {
      if (c.min != null && value < c.min)
        return fail(col, `"${col.name}" must be at least ${c.min}.`)
      if (c.max != null && value > c.max)
        return fail(col, `"${col.name}" must be at most ${c.max}.`)
    }
    if (
      c &&
      typeof value === 'string' &&
      (col.type === 'text' || col.type === 'longtext' || col.type === 'email')
    ) {
      if (c.minLength != null && value.length < c.minLength)
        return fail(col, `"${col.name}" must be at least ${c.minLength} characters.`)
      if (c.maxLength != null && value.length > c.maxLength)
        return fail(col, `"${col.name}" must be at most ${c.maxLength} characters.`)
      if (c.pattern) {
        let re: RegExp | null = null
        try {
          re = new RegExp(c.pattern)
        } catch {
          re = null
        }
        if (re && !re.test(value)) return fail(col, `"${col.name}" is not in the expected format.`)
      }
    }
  }
  return { ok: true, cells: out }
}

// ---- wiki import (markdown / GitHub -> a tree of pages) ----

/**
 * One proposed page. The plan travels to the browser for review and comes back
 * edited, so it carries its own content — the server holds no import session and
 * a preview can be re-ordered, renamed or thrown away for free.
 */
export const importNodeKind = z.enum(['intro', 'section', 'file'])
export type ImportNodeKind = z.infer<typeof importNodeKind>

export const importNodePlan = z.object({
  key: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  /** 0 = a top-level page in the space; each step nests one deeper */
  level: z.number().int().min(0).max(6),
  kind: importNodeKind,
  /** the source anchor this section had, so in-page links can be rewritten */
  anchor: z.string().max(200).optional(),
  /** repo-relative path, for nodes that came from a file */
  path: z.string().max(400).optional(),
  markdown: z.string().max(400_000),
  excerpt: z.string().max(400),
})
export type ImportNodePlan = z.infer<typeof importNodePlan>

export type ImportPlanView = {
  /** what was read, shown above the review list */
  sourceLabel: string
  /** raw base for resolving relative image paths; null for pasted markdown */
  imageBase?: string | null
  /** how many images the source refers to, so the review can offer to fetch them */
  imageCount?: number
  /** proposed name when the import creates its own space */
  suggestedName: string
  nodes: ImportNodePlan[]
  warnings: string[]
}

export const importMarkdownInput = z.object({
  markdown: z.string().min(1).max(2_000_000),
  filename: z.string().trim().max(200).default(''),
})

export const importGithubInput = z.object({
  url: z.string().trim().min(1).max(500),
  /** optional read token for a private repo; used for this request only, never stored */
  token: z.string().trim().max(200).default(''),
  /** also scan docs/ for markdown files */
  includeDocs: z.boolean().default(true),
})

export const importApplyInput = z
  .object({
    /** import into this existing space… */
    spaceId: z.string().optional(),
    /** …or create one with this name */
    newSpaceName: z.string().trim().max(120).optional(),
    category: spaceCategory.default('wiki'),
    personal: z.boolean().default(false),
    /** publish every created page instead of leaving drafts */
    publish: z.boolean().default(false),
    /** archive whatever the target space already holds, first */
    archiveExisting: z.boolean().default(false),
    /** fetch the images the markdown refers to and store them here */
    importImages: z.boolean().default(false),
    /** raw base the plan came with, for resolving relative image paths */
    imageBase: z.string().max(400).nullable().default(null),
    nodes: z.array(importNodePlan).min(1).max(500),
  })
  .refine((v) => Boolean(v.spaceId) !== Boolean(v.newSpaceName), {
    message: 'Choose either an existing space or a name for a new one.',
  })

export type ImportResultView = {
  spaceId: string
  pages: number
  published: number
  /** images fetched and stored alongside the pages */
  images: number
  /** anything skipped along the way, worth showing rather than swallowing */
  warnings?: string[]
  /** pages that were already in the target space and got archived first */
  archived: number
  firstPageId: string | null
}

export type ImportApplyInput = z.infer<typeof importApplyInput>
export type ImportMarkdownInput = z.infer<typeof importMarkdownInput>
export type ImportGithubInput = z.infer<typeof importGithubInput>

/**
 * Merging in the import review: a row can be folded into an earlier one instead
 * of becoming its own page — the classic case is a README `## License` section
 * next to a LICENSE file, or a subsection too small to deserve a page.
 *
 * The plan records the intent (`key -> target key`) rather than concatenating
 * as you click, so a merge stays visible and reversible in the review list. The
 * fold happens once, here, when the user approves.
 */
export type MergeMap = Record<string, string>

export function foldMergedNodes(nodes: ImportNodePlan[], merges: MergeMap): ImportNodePlan[] {
  // A merged into B and B into C means A's content belongs to C
  const resolve = (key: string): string => {
    const seen = new Set<string>()
    let current = key
    while (merges[current] && !seen.has(current)) {
      seen.add(current)
      current = merges[current] as string
    }
    return current
  }

  const kept = new Map<string, ImportNodePlan>()
  for (const node of nodes) if (!merges[node.key]) kept.set(node.key, { ...node })

  for (const node of nodes) {
    if (!merges[node.key]) continue
    const target = kept.get(resolve(node.key))
    if (!target) continue // merged into something that was itself dropped
    // the folded section keeps its title as a heading, so nothing reads as if
    // it had been silently glued on
    const heading = node.title.trim() ? `## ${node.title.trim()}\n\n` : ''
    target.markdown = `${target.markdown}\n\n${heading}${node.markdown}`.trim()
  }

  return nodes.filter((n) => !merges[n.key]).map((n) => kept.get(n.key) as ImportNodePlan)
}

// ---- day rollover ----

/**
 * Milliseconds until the next local midnight. Used by the day view to notice
 * that "today" has moved on while the tab sat open.
 *
 * Local, not UTC — the day a person is living in is the one their clock shows.
 * Built by asking for tomorrow at 00:00:00 rather than adding 24h, so the two
 * days a year that are 23 or 25 hours long land on midnight anyway.
 */
export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return Math.max(1, next.getTime() - now.getTime())
}

// ---- sidebar visibility + password locks ----

/**
 * Sidebar hiding is a view preference, not access control: a hidden section or
 * space still works, still accepts new pages, and is one checkbox from coming
 * back. Tokens are 'cat:<category>' for a whole section, 'space:<id>' or
 * 'db:<id>' for one item.
 */
export const sidebarTokenPattern =
  /^(cat:(notebook|wiki|site|database)|space:[\w-]{1,40}|db:[\w-]{1,40})$/

export const setSidebarHiddenInput = z.object({
  hidden: z.array(z.string().regex(sidebarTokenPattern)).max(300),
})

/** 1 day to 3 months: shorter than a day is just "today", longer stops being
 *  a horizon at all — which is the bug this setting exists to fix. */
export const horizonDaysSchema = z.number().int().min(1).max(90)

/** Either horizon, or both. Tasks and reminders are set apart because a task
 *  due in six weeks is noise today, while a reminder six weeks out may be the
 *  whole point of having written it down. */
export const setHorizonsInput = z
  .object({
    taskDays: horizonDaysSchema.optional(),
    reminderDays: horizonDaysSchema.optional(),
  })
  .refine((v) => v.taskDays !== undefined || v.reminderDays !== undefined, {
    message: 'Set at least one horizon.',
  })

export const lockPolicy = z.enum(['session', 'idle'])
export type LockPolicyView = z.infer<typeof lockPolicy>

export const setLockInput = z.object({
  target: z.enum(['space', 'page']),
  id: z.string(),
  /** null unlocks it for good; otherwise how often the password is re-asked */
  policy: lockPolicy.nullable(),
  /** for 'idle': minutes of disuse before it re-asks. Null uses the 30-minute
   *  default; the ceiling is a week, past which "locked" stops meaning much. */
  idleMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 7)
    .nullable()
    .default(null),
  /** the account password — required to lock and to unlock permanently */
  password: z.string().min(1).max(200),
})

export const unlockInput = z.object({
  target: z.enum(['space', 'page']),
  id: z.string(),
  password: z.string().min(1).max(200),
})

export type LockStateView = {
  target: 'space' | 'page'
  id: string
  policy: LockPolicyView
  /** minutes for an 'idle' lock; null means the 30-minute default */
  idleMinutes: number | null
  /** true once this session has entered the password and the grant still holds */
  open: boolean
}

// ---- what belongs on the Today page's "Coming up" list ----

/** Calendar-date arithmetic on a YYYY-MM-DD key. UTC so no zone can shift a day. */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * Should this land in "Coming up"?
 *
 * Two rules, and the second is why this is a function rather than a comparison:
 * anything inside the horizon qualifies, but a reminder carrying a heads-up
 * window has explicitly asked to be surfaced early — annual life-admin is the
 * entire reason that field exists — so it also qualifies once its own window
 * opens, however distant the date. Everything else stays off the page.
 */
export function isComingUp(
  item: { dueDate: string; headsUpDays?: number | null },
  opts: { today: string; horizonDays: number },
): boolean {
  if (item.dueDate <= opts.today) return false // overdue/today live in the column
  if (item.dueDate <= shiftDayKey(opts.today, opts.horizonDays)) return true
  const lead = item.headsUpDays
  return lead != null && shiftDayKey(item.dueDate, -lead) <= opts.today
}
