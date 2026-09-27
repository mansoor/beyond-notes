import { z } from 'zod'

const bool = (def: 'true' | 'false') =>
  z
    .string()
    .default(def)
    .transform((v) => v === 'true' || v === '1')

const envSchema = z.object({
  DATABASE_URL: z.string().default('file:./data/beyond.db'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3800),
  BASE_URL: z.string().url().default('http://127.0.0.1:3800'),
  WEB_DIST: z.string().default(''),
  MIGRATIONS_DIR: z.string().default('./drizzle'),
  UPLOADS_DIR: z.string().default('./data/uploads'),
  // where automatic/manual full backups are written (a zip per backup). Mount
  // this as a volume so backups outlive the container.
  BACKUPS_DIR: z.string().default('./data/backups'),
  // notifications are opt-in: nothing sends unless a channel is configured
  NTFY_URL: z.string().default(''),
  NTFY_TOPIC: z.string().default(''),
  // SMTP (optional): enables forgot-password, emailed invites, and the email
  // notification channel. Unset = those flows are hidden in the UI.
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default(''),
  // S3-compatible blob storage (optional). S3_BUCKET set = use S3; otherwise
  // the filesystem driver at UPLOADS_DIR. Endpoint empty = real AWS.
  S3_BUCKET: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // encryption-at-rest key for secrets in the settings table. Unset = a key
  // is generated once and kept at SECRETS_KEY_FILE (outside the database).
  SECRETS_KEY: z.string().default(''),
  SECRETS_KEY_FILE: z.string().default('./data/secrets.key'),
  // Concept-graph semantic layer (optional, off by default). When on, a small
  // local embedding model (transformers.js, no cloud) runs in-process to add
  // "related by meaning" edges the classical concept graph can't find. The
  // model downloads once to GRAPH_EMBED_CACHE_DIR (mount it as a volume so a
  // redeploy doesn't refetch). If it's off or the model can't load, the graph
  // silently falls back to links/tags/concepts.
  GRAPH_EMBEDDINGS: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  GRAPH_EMBED_MODEL: z.string().default('Xenova/all-MiniLM-L6-v2'),
  GRAPH_EMBED_CACHE_DIR: z.string().default('./data/models'),
  // cosine similarity a page pair must clear to earn a semantic edge. Higher =
  // fewer, tighter matches. MiniLM tends to sit high, so this is worth tuning.
  GRAPH_EMBED_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  // most semantic neighbours kept per page, so a dense space can't go N².
  GRAPH_EMBED_NEIGHBORS: z.coerce.number().int().min(1).max(20).default(4),
  // OpenID Connect single sign-on (optional). Setting OIDC_ISSUER and
  // OIDC_CLIENT_ID turns it on; Settings → Server can override all of it.
  // Register <BASE_URL>/auth/oidc/callback as the redirect URI at the provider.
  OIDC_ISSUER: z.string().default(''),
  OIDC_CLIENT_ID: z.string().default(''),
  OIDC_CLIENT_SECRET: z.string().default(''),
  OIDC_SCOPES: z.string().default('openid email profile'),
  OIDC_BUTTON_LABEL: z.string().default('Single sign-on'),
  OIDC_AUTO_CREATE: bool('false'),
  OIDC_ALLOWED_DOMAINS: z.string().default(''),
  OIDC_REQUIRED_GROUP: z.string().default(''),
  OIDC_ADMIN_GROUP: z.string().default(''),
  OIDC_GROUPS_CLAIM: z.string().default('groups'),
  OIDC_PASSWORD_LOGIN: bool('true'),
  OIDC_AUTO_REDIRECT: bool('false'),
  // Forward-auth (optional): a reverse proxy (Authelia, Authentik outpost,
  // oauth2-proxy, Caddy/Traefik forward_auth) signs people in and passes their
  // email in AUTH_PROXY_EMAIL_HEADER. Trusted ONLY from AUTH_PROXY_TRUSTED_IPS
  // (IPs or CIDRs of the proxy); both must be set or it stays off.
  AUTH_PROXY_EMAIL_HEADER: z.string().default(''),
  AUTH_PROXY_NAME_HEADER: z.string().default(''),
  AUTH_PROXY_GROUPS_HEADER: z.string().default(''),
  AUTH_PROXY_TRUSTED_IPS: z.string().default(''),
  AUTH_PROXY_AUTO_CREATE: bool('false'),
  AUTH_PROXY_ADMIN_GROUP: z.string().default(''),
  // where "Sign out" sends the browser (the proxy's logout), so the proxy
  // doesn't just sign the person straight back in
  AUTH_PROXY_LOGOUT_URL: z.string().default(''),
  NODE_ENV: z.string().default('development'),
})

export type Config = z.infer<typeof envSchema> & { cookieSecure: boolean }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env)
  return { ...parsed, cookieSecure: parsed.BASE_URL.startsWith('https://') }
}
