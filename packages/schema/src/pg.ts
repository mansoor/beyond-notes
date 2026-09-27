import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// drizzle pg-core has no built-in bytea; the blob store needs one.
// Uint8Array keeps this package free of node typings; the driver hands
// back Buffers at runtime either way.
const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return 'bytea'
  },
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  // false for an account created by single sign-on: its password_hash is a
  // random, unknowable value, so "change password" skips the current-password
  // check and lock screens ask the user to set one first.
  passwordSet: boolean('password_set').notNull().default(true),
  role: text('role', { enum: ['admin', 'member'] })
    .notNull()
    .default('member'),
  // TOTP 2FA: secret exists once enrollment starts; enabled only after a
  // verified code; recovery codes stored as sha256 hashes, JSON array
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  recoveryCodes: text('recovery_codes'),
  // per-user opt-in for the email notification channel (channel itself is env config)
  emailNotifications: boolean('email_notifications').notNull().default(false),
  // sidebar sections/spaces this user has hidden, JSON array of tokens like
  // 'cat:site' or 'space:<id>'. Hiding is a view preference: the space keeps
  // working, it just stops taking up room in the sidebar.
  sidebarHidden: text('sidebar_hidden').notNull().default('[]'),
  // How far ahead the Today page looks for "Coming up", per kind: a task list
  // and a reminder list answer different questions, so they get their own
  // horizons. (`coming_up_days` is the tasks one — it predates the split and
  // kept its name so both dialects stay on one migration path.)
  taskDays: integer('coming_up_days').notNull().default(7),
  reminderDays: integer('reminder_days').notNull().default(7),
  // Ask before a page goes to the Trash. On by default: deleting is reversible
  // for 30 days, but losing the page you were looking at is still a surprise.
  confirmDelete: boolean('confirm_delete').notNull().default(true),
  // When a link is shared into the inbox, fetch the whole readable article
  // (default) vs. just the opening paragraph.
  linkCaptureFull: boolean('link_capture_full').notNull().default(true),
  // Whether clicking a space name opens its knowledge-graph overview (on) or
  // just expands/collapses the space in the sidebar (off).
  graphEnabled: boolean('graph_enabled').notNull().default(true),
  // Which edge kinds the knowledge graph generates, JSON array drawn from
  // concept | link | tag | relation | semantic.
  graphEdges: text('graph_edges')
    .notNull()
    .default('["concept","link","tag","relation","semantic"]'),
  // Also build the graph on phones. Off, a small screen behaves as if the graph
  // were disabled (name click just expands) even when it's on elsewhere.
  graphMobile: boolean('graph_mobile').notNull().default(true),
  // The account's default app theme, adopted on a device that hasn't picked one
  // (a fresh login) so the look follows the user across machines.
  defaultTheme: text('default_theme', { enum: ['light', 'paper', 'navy', 'dark'] })
    .notNull()
    .default('light'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const sessions = pgTable('sessions', {
  // sha256 hex of the raw cookie token; the raw token is never stored
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
})

// A sign-in identity from an external OpenID Connect provider, tied to a local
// account. (issuer, subject) is the provider's stable id for the person; the
// email is kept only for display, since it can change at the provider.
export const userIdentities = pgTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => ({ issuerSubject: uniqueIndex('user_identities_issuer_subject').on(t.issuer, t.subject) }),
)

// A WebAuthn passkey. id is the credential id (base64url) the authenticator
// hands back on sign-in; public_key is the COSE key it registered, also
// base64url. The counter guards against cloned authenticators.
export const passkeys = pgTable('passkeys', {
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
  backedUp: boolean('backed_up').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
})

// Who did what, when, from where: sign-ins (and failed ones), security
// changes and admin actions. actor_id has no foreign key on purpose, and the
// email is copied in, so the trail survives the account being deleted.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull(),
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
export const apiTokens = pgTable('api_tokens', {
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
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
})

export const passwordResetTokens = pgTable('password_reset_tokens', {
  // sha256 hex of the raw emailed token; the raw token is never stored
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
})

export const spaces = pgTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category', { enum: ['notebook', 'wiki', 'site'] })
    .notNull()
    .default('notebook'),
  // authoring mode: 'tree' spaces appear in the sidebar; each user gets one
  // system 'journal' space (created on demand, never listed as a space)
  kind: text('kind', { enum: ['tree', 'journal'] })
    .notNull()
    .default('tree'),
  // null = shared with every member; set = personal to that user (flat model, no ACLs)
  ownerId: text('owner_id').references(() => users.id),
  // publishing config: space-level "can this appear on the web"
  publicEnabled: boolean('public_enabled').notNull().default(false),
  // published, but showing a holding page instead of the content
  publicMaintenance: boolean('public_maintenance').notNull().default(false),
  publicHost: text('public_host').unique(),
  publicTitle: text('public_title'),
  publicFooter: text('public_footer'),
  publicTheme: text('public_theme', { enum: ['paper', 'ink', 'mist', 'sand', 'bloom'] })
    .notNull()
    .default('paper'),
  // 'auto' follows the visitor's OS; 'light'/'dark' pin one palette
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
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const pages = pgTable('pages', {
  id: text('id').primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  // null = root of the space; deleting a page cascades to its whole subtree
  parentId: text('parent_id').references((): AnyPgColumn => pages.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Untitled'),
  position: integer('position').notNull().default(0),
  // journal day pages carry 'YYYY-MM-DD'; the per-user tasks-inbox page carries
  // the sentinel 'inbox'; ordinary tree pages carry null
  dateKey: text('date_key'),
  // 'blog' renders live children as dated posts; 'gallery' renders its image grid
  pageType: text('page_type', { enum: ['doc', 'blog', 'gallery'] })
    .notNull()
    .default('doc'),
  // public path segment; set at first publish, then stable
  slug: text('slug'),
  // page-level "is this live right now" — soft ref into page_versions
  liveVersionId: text('live_version_id'),
  // per-gallery presentation, chosen in the editor, baked into the snapshot at publish
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
  // opt-in social share bar on the published page
  shareEnabled: boolean('share_enabled').notNull().default(false),
  // gallery cover / blog-post listing image (an attachments id)
  coverAttachmentId: text('cover_attachment_id'),
  // SEO: og/meta description on published sites; falls back to the text body
  metaDescription: text('meta_description'),
  // a single emoji shown beside the page in the sidebar and published nav
  icon: text('icon'),
  // archive: soft-removal from the app surfaces; restore puts it back where it
  // was. Set on the whole subtree at once. Publish state is deliberately
  // untouched — retiring is its own explicit act.
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  archivedBy: text('archived_by'),
  // trash: deletion is a 30-day soft state before the purge job hard-deletes.
  // Trashed pages vanish from the tree, search, tags, AND the public site.
  trashedAt: timestamp('trashed_at', { withTimezone: true, mode: 'date' }),
  trashedBy: text('trashed_by'),
  // password lock: null = open. 'session' re-asks once per sign-in, 'idle'
  // re-asks after 30 minutes without opening it. A lock hides content behind
  // the account password; it does not encrypt (see DESIGN-NOTES).
  lockPolicy: text('lock_policy', { enum: ['session', 'idle'] }),
  // minutes of disuse before an 'idle' lock re-asks; null = the 30-minute default
  lockIdleMinutes: integer('lock_idle_minutes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const pageVersions = pgTable('page_versions', {
  // immutable published snapshots: content frozen AND pre-rendered at publish
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
  // JSON array of attachment ids referenced by this snapshot — the public
  // file route only serves attachments that appear in some live version
  attachmentIds: text('attachment_ids').notNull().default('[]'),
  coverAttachmentId: text('cover_attachment_id'),
  // frozen at publish like everything else in the snapshot
  metaDescription: text('meta_description'),
  tags: text('tags').notNull().default('[]'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

// shareable draft-preview links: the token (hashed at rest) grants read-only
// access to ONE page's working copy, revocable any time
export const previews = pgTable('previews', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  pageId: text('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
})

export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  // sha256 of the processed bytes; the blob store key (content-addressed, deduped)
  hash: text('hash').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const galleryItems = pgTable('gallery_items', {
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

export const documents = pgTable('documents', {
  // the working copy: one editable document per page (published snapshots arrive in M3)
  pageId: text('page_id')
    .primaryKey()
    .references(() => pages.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const memos = pgTable('memos', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  promotedTo: text('promoted_to', { enum: ['note', 'journal', 'task'] }),
  promotedAt: timestamp('promoted_at', { withTimezone: true, mode: 'date' }),
})

export const tasks = pgTable('tasks', {
  // index over checkbox blocks — the block inside the document is the source
  // of truth; id is `${pageId}:${blockId}`
  id: text('id').primaryKey(),
  pageId: text('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  blockId: text('block_id').notNull(),
  text: text('text').notNull(),
  checked: boolean('checked').notNull().default(false),
  due: text('due'),
  // optional local time-of-day 'HH:MM' paired with `due`; null = no time set
  dueTime: text('due_time'),
  position: integer('position').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const reminders = pgTable('reminders', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  // a single emoji shown in place of the default bell (birthday cake, etc.)
  icon: text('icon'),
  // date-only scheduling (local dates); dueTime is display + notification time
  dueDate: text('due_date').notNull(),
  dueTime: text('due_time'),
  freq: text('freq', { enum: ['daily', 'weekly', 'monthly', 'yearly'] }),
  interval: integer('interval').notNull().default(1),
  headsUpDays: integer('heads_up_days'),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const scheduledJobs = pgTable('scheduled_jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  refId: text('ref_id').notNull(),
  payload: text('payload').notNull(),
  runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }).notNull(),
  status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  suggestedEmail: text('suggested_email'),
  role: text('role', { enum: ['admin', 'member'] })
    .notNull()
    .default('member'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  usedBy: text('used_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
})

// runtime-editable server settings: one row per group, JSON value validated
// by per-group zod schemas at the service boundary (TECH-PLAN settings split)
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

// blob storage, database driver: content-addressed like the other drivers
export const blobs = pgTable('blobs', {
  key: text('key').primaryKey(),
  data: bytea('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

// incoming webhooks: token-addressed writers into a user's capture surfaces
export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  target: text('target', { enum: ['inbox', 'today', 'tasks'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
})

// tag index over page content: #tags are extracted from documents on every
// save (same pattern as the tasks index) — the text is the source of truth
export const pageTags = pgTable(
  'page_tags',
  {
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    // 'inline' rows are re-derived from the text on every save; 'manual' rows
    // come from the context rail and survive reconciliation
    source: text('source', { enum: ['inline', 'manual'] })
      .notNull()
      .default('inline'),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.tag] })],
)

// internal page→page links, re-derived from documents on every save (tags
// pattern); the backlinks panel reads the reverse direction
export const pageLinks = pgTable(
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

// every slug a page has ever been published under — old public URLs 301 to
// the current one instead of breaking
export const pageSlugs = pgTable(
  'page_slugs',
  {
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.slug] })],
)

// reusable page skeletons ("Save as template" → offered on empty pages)
export const templates = pgTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

// per-user pinned pages (the ⭐ section in the sidebar)
export const pins = pgTable(
  'pins',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
)

// ---- data (lightweight structured data / forms) ----
// A database is the container level (parity with a space): it owns visibility
// and holds tables. A table's column definitions live in the `columns` JSON
// array (each carries a stable id), so a row's cells key by column id and a
// rename/reorder never rewrites a single row. No runtime DDL — a fixed trio.
export const dbDatabases = pgTable('db_databases', {
  id: text('id').primaryKey(),
  // null = shared with every member; set = personal to that user (spaces rule)
  ownerId: text('owner_id').references(() => users.id),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const dbTables = pgTable('db_tables', {
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
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  archivedBy: text('archived_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const dbRows = pgTable('db_rows', {
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
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})
