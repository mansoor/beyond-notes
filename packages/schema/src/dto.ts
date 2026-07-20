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
  createdAt: string
}

export const createPageInput = z.object({
  spaceId: z.string(),
  parentId: z.string().nullable().default(null),
  title: z.string().trim().max(300).default(''),
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
  shareEnabled: boolean
  coverAttachmentId: string | null
  metaDescription: string | null
}

export const galleryLayoutName = z.enum(['grid', 'carousel', 'filmstrip', 'mosaic'])
export type GalleryLayoutName = z.infer<typeof galleryLayoutName>

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
  shareEnabled: z.boolean().optional(),
  // null clears the cover; undefined leaves it unchanged
  coverAttachmentId: z.string().nullable().optional(),
  // SEO description for published sites; null clears
  metaDescription: z.string().trim().max(300).nullable().optional(),
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

export const promoteToJournalInput = z.object({
  memoId: z.string(),
  date: dateKey,
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

export const siteAppearance = z.enum(['auto', 'light', 'dark'])
export type SiteAppearance = z.infer<typeof siteAppearance>

export const siteHeaderLayout = z.enum(['classic', 'centered', 'split', 'minimal'])
export type SiteHeaderLayoutName = z.infer<typeof siteHeaderLayout>

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
  tagline: z.string().trim().max(160).nullable().default(null),
  headerLayout: siteHeaderLayout.default('classic'),
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

export const createReminderInput = z.object({
  title: z.string().trim().min(1).max(200),
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

export type ReminderView = {
  id: string
  title: string
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
