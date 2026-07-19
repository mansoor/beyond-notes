import {
  type NtfySettings,
  type ServerSettingsView,
  type SmtpSettings,
  type StorageSettings,
  ntfySettings,
  smtpSettings,
  storageSettings,
} from '@bn/schema'
import type { Config } from './config'
import type { Repo } from './repo'

/**
 * Runtime-editable server settings (TECH-PLAN's second config bucket). The
 * whole table is loaded into an in-memory snapshot at boot and refreshed on
 * every write — correct because the app is a single process by design, and
 * it lets everything downstream (mailer, notifiers, blob store) read current
 * values synchronously on every use.
 *
 * Precedence: a DB group that is actually filled in wins over env vars; env
 * remains the bootstrap/deployment path and the fallback.
 */
export function createSettingsService(repo: Repo, config: Config, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())
  const snapshot = new Map<string, unknown>()

  function parse<T>(key: string, schema: { parse: (v: unknown) => T }): T | null {
    const raw = snapshot.get(key)
    if (raw === undefined) return null
    try {
      return schema.parse(raw)
    } catch {
      return null // an unreadable row must never take the server down
    }
  }

  return {
    async load(): Promise<void> {
      snapshot.clear()
      for (const row of await repo.listSettings()) {
        try {
          snapshot.set(row.key, JSON.parse(row.value))
        } catch {
          // skip corrupt rows
        }
      }
    },

    async put(key: string, value: unknown): Promise<void> {
      await repo.putSetting(key, JSON.stringify(value), now())
      snapshot.set(key, value)
    },

    smtp(): SmtpSettings | null {
      return parse('smtp', smtpSettings)
    },

    ntfy(): NtfySettings | null {
      return parse('ntfy', ntfySettings)
    },

    storage(): StorageSettings | null {
      return parse('storage', storageSettings)
    },

    /** Effective SMTP config: filled-in DB group first, env second, else null. */
    effectiveSmtp(): {
      host: string
      port: number
      secure: boolean
      user: string
      pass: string
      from: string
      source: 'db' | 'env'
    } | null {
      const db = this.smtp()
      if (db?.host && db.from) return { ...db, source: 'db' }
      if (config.SMTP_HOST && config.MAIL_FROM) {
        return {
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          user: config.SMTP_USER,
          pass: config.SMTP_PASS,
          from: config.MAIL_FROM,
          source: 'env',
        }
      }
      return null
    },

    effectiveNtfy(): { url: string; topic: string; source: 'db' | 'env' } | null {
      const db = this.ntfy()
      if (db?.url && db.topic) return { ...db, source: 'db' }
      if (config.NTFY_URL && config.NTFY_TOPIC) {
        return { url: config.NTFY_URL, topic: config.NTFY_TOPIC, source: 'env' }
      }
      return null
    },

    /** Effective storage: DB choice first; env S3 config implies s3; else fs. */
    effectiveStorage(): StorageSettings & { source: 'db' | 'env' } {
      const db = this.storage()
      if (db && (db.driver !== 's3' || db.s3Bucket)) return { ...db, source: 'db' }
      if (config.S3_BUCKET) {
        return {
          driver: 's3',
          s3Bucket: config.S3_BUCKET,
          s3Endpoint: config.S3_ENDPOINT,
          s3Region: config.S3_REGION,
          s3AccessKey: config.S3_ACCESS_KEY,
          s3SecretKey: config.S3_SECRET_KEY,
          s3ForcePathStyle: config.S3_FORCE_PATH_STYLE,
          source: 'env',
        }
      }
      return {
        driver: 'fs',
        s3Bucket: '',
        s3Endpoint: '',
        s3Region: 'us-east-1',
        s3AccessKey: '',
        s3SecretKey: '',
        s3ForcePathStyle: true,
        source: 'env',
      }
    },

    /** Secrets never leave the server; the UI sees presence flags only. */
    view(): ServerSettingsView {
      const smtp = this.smtp() ?? smtpSettings.parse({})
      const ntfy = this.ntfy() ?? ntfySettings.parse({})
      const storage = this.storage() ?? {
        ...storageSettings.parse({}),
        // surface the env S3 bootstrap so the form starts from reality
        ...(config.S3_BUCKET
          ? {
              driver: 's3' as const,
              s3Bucket: config.S3_BUCKET,
              s3Endpoint: config.S3_ENDPOINT,
              s3Region: config.S3_REGION,
              s3AccessKey: config.S3_ACCESS_KEY,
            }
          : {}),
      }
      const { pass: _p, ...smtpRest } = smtp
      const { s3SecretKey: _s, ...storageRest } = storage
      const mail = this.effectiveSmtp()
      const ntfyEff = this.effectiveNtfy()
      return {
        smtp: { ...smtpRest, hasPass: Boolean(smtp.pass || config.SMTP_PASS) },
        ntfy,
        storage: {
          ...storageRest,
          hasSecret: Boolean(storage.s3SecretKey || config.S3_SECRET_KEY),
        },
        mailSource: mail?.source ?? 'off',
        ntfySource: ntfyEff?.source ?? 'off',
      }
    },

    /** Merge semantics for secret fields: blank input keeps the stored value. */
    async saveSmtp(input: SmtpSettings): Promise<void> {
      const prev = this.smtp()
      await this.put('smtp', { ...input, pass: input.pass || prev?.pass || '' })
    },

    async saveNtfy(input: NtfySettings): Promise<void> {
      await this.put('ntfy', input)
    },

    async saveStorage(input: StorageSettings): Promise<void> {
      const prev = this.storage()
      await this.put('storage', {
        ...input,
        s3SecretKey: input.s3SecretKey || prev?.s3SecretKey || config.S3_SECRET_KEY || '',
      })
    },
  }
}

export type SettingsService = ReturnType<typeof createSettingsService>
