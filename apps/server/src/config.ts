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
  NODE_ENV: z.string().default('development'),
})

export type Config = z.infer<typeof envSchema> & { cookieSecure: boolean }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env)
  return { ...parsed, cookieSecure: parsed.BASE_URL.startsWith('https://') }
}
