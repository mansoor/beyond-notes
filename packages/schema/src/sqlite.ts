import {
  type AnySQLiteColumn,
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// Mirrors pg.ts exactly; dates are stored as integer epoch-ms and surfaced as Date.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  // false for an account created by single sign-on: its password_hash is a
  // random, unknowable value, so "change password" skips the current-password
  // check and lock screens ask the user to set one first.
  passwordSet: integer('password_set', { mode: 'boolean' }).notNull().default(true),
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
  // How far ahead the Today page looks for "Coming up", per kind: a task list
  // and a reminder list answer different questions, so they get their own
  // horizons. (`coming_up_days` is the tasks one — it predates the split and
  // was not renamed, because renaming a column costs a rebuild on SQLite.)
  taskDays: integer('coming_up_days').notNull().default(7),
  reminderDays: integer('reminder_days').notNull().default(7),
  // Ask before a page goes to the Trash. On by default: deleting is reversible
  // for 30 days, but losing the page you were looking at is still a surprise.
  confirmDelete: integer('confirm_delete', { mode: 'boolean' }).notNull().default(true),
  // When a link is shared into the inbox, fetch the whole readable article
  // (default) vs. just the opening paragraph.
  linkCaptureFull: integer('link_capture_full', { mode: 'boolean' }).notNull().default(true),
  // Whether clicking a space name opens its knowledge-graph overview (on) or
  // just expands/collapses the space in the sidebar (off).
  graphEnabled: integer('graph_enabled', { mode: 'boolean' }).notNull().default(true),
  // Which edge kinds the knowledge graph generates, JSON array drawn from
  // concept | link | tag | relation | semantic.
  graphEdges: text('graph_edges')
    .notNull()
    .default('["concept","link","tag","relation","semantic"]'),
  // Also build the graph on phones. Off, a small screen behaves as if the graph
  // were disabled (name click just expands) even when it's on elsewhere.
  graphMobile: integer('graph_mobile', { mode: 'boolean' }).notNull().default(true),
  // The account's default app theme, adopted on a device that hasn't picked one
  // (a fresh login) so the look follows the user across machines.
  defaultTheme: text('default_theme', { enum: ['light', 'paper', 'navy', 'dark'] })
    .notNull()
    .default('light'),
  // Deactivated by an admin (or a provisioning system): can't sign in, sessions
  // and API tokens stop working. Everything the person made stays.
  disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
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

// A sign-in identity from an external OpenID Connect provider, tied to a local
// account. (issuer, subject) is the provider's stable id for the person; the
// email is kept only for display, since it can change at the provider.
export const userIdentities = sqliteTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({ issuerSubject: uniqueIndex('user_identities_issuer_subject').on(t.issuer, t.subject) }),
)

// A WebAuthn passkey. id is the credential id (base64url) the authenticator
// hands back on sign-in; public_key is the COSE key it registered, also
// base64url. The counter guards against cloned authenticators.
export const passkeys = sqliteTable('passkeys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  // JSON array of transports ("internal", "hybrid", "usb", ...)
  transports: text('transports').notNull().default('[]'),
  // synced (a password manager / iCloud keychain) vs bound to one device
  backedUp: integer('backed_up', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
})

// Who did what, when, from where: sign-ins (and failed ones), security
// changes and admin actions. actor_id has no foreign key on purpose, and the
// email is copied in, so the trail survives the account being deleted.
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    // dotted name, e.g. auth.login, auth.login_failed, settings.saved
    action: text('action').notNull(),
    target: text('target'),
    ip: text('ip'),
    // JSON object with anything else worth keeping
    detail: text('detail'),
  },
  (t) => ({ at: index('audit_events_at').on(t.at) }),
)

// Personal access tokens for the REST API and the MCP server. Only the
// sha256 of the token is stored; `prefix` (the first characters) is kept so
// people can tell their tokens apart in Settings.
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  // read = look only; write = also create and change content
  scope: text('scope', { enum: ['read', 'write'] })
    .notNull()
    .default('read'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
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
  // published, but showing a holding page instead of the content
  publicMaintenance: integer('public_maintenance', { mode: 'boolean' }).notNull().default(false),
  publicHost: text('public_host').unique(),
  publicTitle: text('public_title'),
  publicFooter: text('public_footer'),
  publicTheme: text('public_theme', { enum: ['paper', 'ink', 'mist', 'sand', 'bloom'] })
    .notNull()
    .default('paper'),
  publicAppearance: text('public_appearance', { enum: ['auto', 'light', 'dark', 'toggle'] })
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
  // how loud the wordmark is, and how much room the logo takes beside it —
  // 'md' is what every site rendered before these existed
  publicTitleSize: text('public_title_size', { enum: ['sm', 'md', 'lg', 'xl'] })
    .notNull()
    .default('md'),
  publicLogoSize: text('public_logo_size', { enum: ['sm', 'md', 'lg'] })
    .notNull()
    .default('md'),
  // a square mark for the browser tab; falls back to the logo when unset
  publicFaviconAttachmentId: text('public_favicon_attachment_id'),
  // opt-in analytics for the published site only — never the app. Provider is
  // 'none' unless chosen; host lets Plausible/Umami point at a self-hosted
  // instance instead of the vendor's.
  analyticsProvider: text('analytics_provider', {
    enum: ['none', 'plausible', 'umami', 'ga4'],
  })
    .notNull()
    .default('none'),
  analyticsSiteId: text('analytics_site_id'),
  analyticsHost: text('analytics_host'),
  // password lock: null = open. 'session' re-asks once per sign-in, 'idle'
  // re-asks after 30 minutes without opening it. A lock hides content behind
  // the account password; it does not encrypt (see DESIGN-NOTES).
  lockPolicy: text('lock_policy', { enum: ['session', 'idle'] }),
  // minutes of disuse before an 'idle' lock re-asks; null = the 30-minute default
  lockIdleMinutes: integer('lock_idle_minutes'),
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
  // how a blog page lays its posts out; ignored on other page types
  blogLayout: text('blog_layout', { enum: ['list', 'grid'] })
    .notNull()
    .default('list'),
  // free-text taxonomy for blog posts and galleries; null = uncategorised
  category: text('category'),
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
  // minutes of disuse before an 'idle' lock re-asks; null = the 30-minute default
  lockIdleMinutes: integer('lock_idle_minutes'),
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

// ---- sharing (managed by an edition; the core only reads these) ----

/** Named sets of people, e.g. "Family". Space shares can name a group. */
export const userGroups = sqliteTable('user_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const userGroupMembers = sqliteTable(
  'user_group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
)

/**
 * A personal space shared with a person or a group. viewer = read only;
 * editor = edit pages. Space settings stay with the owner.
 */
export const spaceShares = sqliteTable(
  'space_shares',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    principalType: text('principal_type', { enum: ['user', 'group'] }).notNull(),
    principalId: text('principal_id').notNull(),
    role: text('role', { enum: ['viewer', 'editor'] })
      .notNull()
      .default('viewer'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.principalType, t.principalId] }),
    index('space_shares_principal_idx').on(t.principalType, t.principalId),
  ],
)

// ---- built-in site visit counts (an edition switches counting on per site) ----

/** Daily views and unique visitors per published page; path '' = the whole site. */
export const siteVisitsDaily = sqliteTable(
  'site_visits_daily',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    // UTC, YYYY-MM-DD
    day: text('day').notNull(),
    path: text('path').notNull(),
    views: integer('views').notNull().default(0),
    visitors: integer('visitors').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.day, t.path] })],
)

/** Daily views arriving from another site, by its host name. */
export const siteReferrersDaily = sqliteTable(
  'site_referrers_daily',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    host: text('host').notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.day, t.host] })],
)

// ---- live co-editing ----

/**
 * The collaborative (Yjs) state of a page being co-edited. Only a cache: it
 * can always be rebuilt from documents.content, and is when content_at no
 * longer matches the document (something else wrote the page meanwhile).
 */
export const documentLiveStates = sqliteTable('document_live_states', {
  pageId: text('page_id')
    .primaryKey()
    .references(() => pages.id, { onDelete: 'cascade' }),
  state: blob('state', { mode: 'buffer' }).notNull(),
  // documents.updated_at this state matches
  contentAt: integer('content_at', { mode: 'timestamp_ms' }).notNull(),
})

// ---- newsletters ----

/**
 * People who asked a published site to email them its new posts. A signup is
 * 'pending' until the address is confirmed from the email it receives; the
 * token is in every email they get, for confirming and unsubscribing.
 */
export const newsletterSubscribers = sqliteTable(
  'newsletter_subscribers',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    // lower-cased
    email: text('email').notNull(),
    status: text('status', { enum: ['pending', 'active', 'unsubscribed'] }).notNull(),
    token: text('token').notNull(),
    // 'form' (the site), 'manual' (added by the owner), 'import'
    source: text('source').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    unsubscribedAt: integer('unsubscribed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('newsletter_subscribers_space_email').on(t.spaceId, t.email),
    uniqueIndex('newsletter_subscribers_token').on(t.token),
  ],
)

/** A post emailed to a site's subscribers: queued, sending, then sent. */
export const newsletterIssues = sqliteTable(
  'newsletter_issues',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    pageId: text('page_id').references(() => pages.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    status: text('status', {
      enum: ['queued', 'sending', 'sent', 'cancelled', 'failed'],
    }).notNull(),
    // not before this (a short hold after an automatic send, to fix a typo)
    sendAfter: integer('send_after', { mode: 'timestamp_ms' }).notNull(),
    // subscribers are sent to in id order; the last one done, for resuming
    cursor: text('cursor'),
    recipients: integer('recipients').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    error: text('error'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('newsletter_issues_space_idx').on(t.spaceId)],
)

// ---- AI ----

/**
 * The note index behind Ask: each page cut into passages, each passage as an
 * embedding vector from the configured model. Only a cache — rebuilt from the
 * pages whenever they change or the model does — so it isn't in exports.
 */
export const aiChunks = sqliteTable(
  'ai_chunks',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    spaceId: text('space_id').notNull(),
    seq: integer('seq').notNull(),
    text: text('text').notNull(),
    model: text('model').notNull(),
    // float32, little-endian
    vector: blob('vector', { mode: 'buffer' }).notNull(),
    // documents.updated_at this passage was cut from
    sourceAt: integer('source_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('ai_chunks_page_idx').on(t.pageId)],
)
