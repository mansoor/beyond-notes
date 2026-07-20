import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().default('file:./data/beyond.db'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3800),
  BASE_URL: z.string().url().default('http://127.0.0.1:3800'),
  WEB_DIST: z.string().default(''),
  MIGRATIONS_DIR: z.string().default('./drizzle'),
  UPLOADS_DIR: z.string().default('./data/uploads'),
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
  NODE_ENV: z.string().default('development'),
})

export type Config = z.infer<typeof envSchema> & { cookieSecure: boolean }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env)
  return { ...parsed, cookieSecure: parsed.BASE_URL.startsWith('https://') }
}
