import {
  type AnySQLiteColumn,
  blob,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

// Mirrors pg.ts exactly; dates are stored as integer epoch-ms and surfaced as Date.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] })
    .notNull()
    .default('member'),
  totpSecret: text('totp_secret'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  recoveryCodes: text('recovery_codes'),
  emailNotifications: integer('email_notifications', { mode: 'boolean' }).notNull().default(false),
  // sidebar sections/spaces this user has hidden, JSON array of tokens like
  // 'cat:site' or 'space:<id>'. Hiding is a view preference: the space keeps
  // working, it just stops taking up room in the sidebar.
  sidebarHidden: text('sidebar_hidden').notNull().default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
})

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
})

export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category', { enum: ['notebook', 'wiki', 'site'] })
    .notNull()
    .default('notebook'),
  kind: text('kind', { enum: ['tree', 'journal'] })
    .notNull()
    .default('tree'),
  ownerId: text('owner_id').references(() => users.id),
  publicEnabled: integer('public_enabled', { mode: 'boolean' }).notNull().default(false),
  publicHost: text('public_host').unique(),
  publicTitle: text('public_title'),
  publicFooter: text('public_footer'),
  publicTheme: text('public_theme', { enum: ['paper', 'ink', 'mist', 'sand', 'bloom'] })
    .notNull()
    .default('paper'),
  publicAppearance: text('public_appearance', { enum: ['auto', 'light', 'dark'] })
    .notNull()
    .default('auto'),
  // JSON array of {platform, url} shown in the published site header
  publicSocial: text('public_social').notNull().default('[]'),
  // site branding: uploaded logo (attachments id), short tagline, header style
  publicLogoAttachmentId: text('public_logo_attachment_id'),
  publicTagline: text('public_tagline'),
  publicHeaderLayout: text('public_header_layout', {
    enum: ['classic', 'centered', 'split', 'minimal'],
  })
    .notNull()
    .default('classic'),
  // password lock: null = open. 'session' re-asks once per sign-in, 'idle'
  // re-asks after 30 minutes without opening it. A lock hides content behind
  // the account password; it does not encrypt (see DESIGN-NOTES).
  lockPolicy: text('lock_policy', { enum: ['session', 'idle'] }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Untitled'),
  position: integer('position').notNull().default(0),
  dateKey: text('date_key'),
  pageType: text('page_type', { enum: ['doc', 'blog', 'gallery'] })
    .notNull()
    .default('doc'),
  slug: text('slug'),
  liveVersionId: text('live_version_id'),
  galleryLayout: text('gallery_layout', { enum: ['grid', 'carousel', 'filmstrip', 'mosaic'] })
    .notNull()
    .default('grid'),
  // carousel auto-rotate interval in seconds; null = off
  galleryAutoplaySecs: integer('gallery_autoplay_secs'),
  shareEnabled: integer('share_enabled', { mode: 'boolean' }).notNull().default(false),
  coverAttachmentId: text('cover_attachment_id'),
  metaDescription: text('meta_description'),
  // a single emoji shown beside the page in the sidebar and published nav
  icon: text('icon'),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  archivedBy: text('archived_by'),
  trashedAt: integer('trashed_at', { mode: 'timestamp_ms' }),
  trashedBy: text('trashed_by'),
  // password lock: null = open. 'session' re-asks once per sign-in, 'idle'
  // re-asks after 30 minutes without opening it. A lock hides content behind
  // the account password; it does not encrypt (see DESIGN-NOTES).
  lockPolicy: text('lock_policy', { enum: ['session', 'idle'] }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const pageVersions = sqliteTable('page_versions', {
  id: text('id').primaryKey(),
  pageId: text('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content: text('content').notNull(),
  html: text('html').notNull(),
  textPlain: text('text_plain').notNull(),
  attachmentIds: text('attachment_ids').notNull().default('[]'),
  coverAttachmentId: text('cover_attachment_id'),
  metaDescription: text('meta_description'),
  tags: text('tags').notNull().default('[]'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const previews = sqliteTable('previews', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  pageId: text('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
})

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  hash: text('hash').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const galleryItems = sqliteTable('gallery_items', {
  id: text('id').primaryKey(),
  pageId: text('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  attachmentId: text('attachment_id')
    .notNull()
    .references(() => attachments.id),
  position: integer('position').notNull().default(0),
  caption: text('caption').notNull().default(''),
})

export const documents = sqliteTable('documents', {
  pageId: text('page_id')
    .primaryKey()
    .references(() => pages.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const memos = sqliteTable('memos', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  promotedTo: text('promoted_to', { enum: ['note', 'journal', 'task'] }),
  promotedAt: integer('promoted_at', { mode: 'timestamp_ms' }),
})

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  pageId: text('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  blockId: text('block_id').notNull(),
  text: text('text').notNull(),
  checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
  due: text('due'),
  // optional local time-of-day 'HH:MM' paired with `due`; null = no time set
  dueTime: text('due_time'),
  position: integer('position').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const reminders = sqliteTable('reminders', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  // a single emoji shown in place of the default bell (birthday cake, etc.)
  icon: text('icon'),
  dueDate: text('due_date').notNull(),
  dueTime: text('due_time'),
  freq: text('freq', { enum: ['daily', 'weekly', 'monthly', 'yearly'] }),
  interval: integer('interval').notNull().default(1),
  headsUpDays: integer('heads_up_days'),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const scheduledJobs = sqliteTable('scheduled_jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  refId: text('ref_id').notNull(),
  payload: text('payload').notNull(),
  runAt: integer('run_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  suggestedEmail: text('suggested_email'),
  role: text('role', { enum: ['admin', 'member'] })
    .notNull()
    .default('member'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  usedBy: text('used_by'),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const blobs = sqliteTable('blobs', {
  key: text('key').primaryKey(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  target: text('target', { enum: ['inbox', 'today', 'tasks'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
})

export const pageTags = sqliteTable(
  'page_tags',
  {
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    source: text('source', { enum: ['inline', 'manual'] })
      .notNull()
      .default('inline'),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.tag] })],
)

export const pageLinks = sqliteTable(
  'page_links',
  {
    fromPageId: text('from_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    toPageId: text('to_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fromPageId, t.toPageId] })],
)

export const pageSlugs = sqliteTable(
  'page_slugs',
  {
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.slug] })],
)

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const pins = sqliteTable(
  'pins',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
)

// ---- data (lightweight structured data / forms) ----
// A database is the container level; tables live under it and inherit its
// visibility. Column definitions live in the `columns` JSON array (each carries
// a stable id); a row's cells key by column id. No runtime DDL — a fixed trio.
export const dbDatabases = sqliteTable('db_databases', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').references(() => users.id),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const dbTables = sqliteTable('db_tables', {
  id: text('id').primaryKey(),
  databaseId: text('database_id')
    .notNull()
    .references(() => dbDatabases.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  // JSON array of {id,name,type,required,choices}
  columns: text('columns').notNull().default('[]'),
  // JSON form config (the public intake projection); null = no form
  form: text('form'),
  position: integer('position').notNull().default(0),
  // archive: soft-hide from the sidebar; restore from the Archive view
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  archivedBy: text('archived_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const dbRows = sqliteTable('db_rows', {
  id: text('id').primaryKey(),
  tableId: text('table_id')
    .notNull()
    .references(() => dbTables.id, { onDelete: 'cascade' }),
  // JSON object of cell values keyed by column id
  cells: text('cells').notNull().default('{}'),
  // where the row came from: hand-entered in the grid, or a public form submit
  source: text('source', { enum: ['manual', 'form'] })
    .notNull()
    .default('manual'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})
