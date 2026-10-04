import { type Transporter, createTransport } from 'nodemailer'
import type { SettingsService } from './settings'

/** Extras for mail that isn't a plain notice (newsletters). */
export type MailExtras = {
  /** an HTML part; `text` stays as the plain-text alternative */
  html?: string
  /** display name for the sender; the address stays the configured one */
  fromName?: string
  replyTo?: string
  headers?: Record<string, string>
}

// The email seam. Everything that sends mail goes through this interface so
// dev/test run on a log (or capture) mailer. SMTP resolves through the
// settings service on every send — admin edits in the UI apply immediately,
// no restart, with env vars as the bootstrap fallback.
export interface Mailer {
  /** false = no SMTP anywhere; the UI hides email-dependent flows entirely */
  readonly configured: boolean
  send(to: string, subject: string, text: string, extras?: MailExtras): Promise<void>
}

/** The address inside a From value: `Name <a@b.c>` or a bare `a@b.c`. */
export function fromAddress(from: string): string {
  return from.match(/<([^>]+)>/)?.[1]?.trim() ?? from.trim()
}

/** A From header with this display name, safely quoted. */
export function withFromName(from: string, name: string | undefined): string {
  const clean = (name ?? '').replace(/["\\\r\n<>]/g, '').trim()
  return clean ? `"${clean}" <${fromAddress(from)}>` : from
}

export function createDynamicMailer(settings: SettingsService, log: (msg: string) => void): Mailer {
  // one pooled connection per SMTP config, so a newsletter isn't a new
  // connection per subscriber; an edited config gets a fresh pool
  let pool: { key: string; transport: Transporter } | null = null
  const transportFor = (smtp: NonNullable<ReturnType<SettingsService['effectiveSmtp']>>) => {
    const key = JSON.stringify([smtp.host, smtp.port, smtp.secure, smtp.user, smtp.pass])
    if (pool?.key === key) return pool.transport
    pool?.transport.close()
    const transport = createTransport({
      pool: true,
      maxConnections: 2,
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    })
    pool = { key, transport }
    return transport
  }
  return {
    get configured() {
      return settings.effectiveSmtp() !== null
    },
    async send(to, subject, text, extras) {
      const smtp = settings.effectiveSmtp()
      if (!smtp) {
        log(`[mail] (no SMTP configured) to=${to} subject=${subject}\n${text}`)
        return
      }
      await transportFor(smtp).sendMail({
        from: withFromName(smtp.from, extras?.fromName),
        to,
        subject,
        text,
        html: extras?.html,
        replyTo: extras?.replyTo,
        headers: extras?.headers,
      })
    },
  }
}

export function createLogMailer(log: (msg: string) => void): Mailer {
  return {
    configured: false,
    async send(to, subject, text) {
      log(`[mail] to=${to} subject=${subject}\n${text}`)
    },
  }
}

// Plain-text templates. Deliberately no HTML: reset and invite mail must
// survive every client, and there is nothing to style.

export function passwordResetEmail(baseUrl: string, token: string) {
  return {
    subject: 'Reset your Beyond Notes password',
    text: [
      'Someone (hopefully you) asked to reset the password for this account.',
      '',
      'Reset it here (link is valid for 1 hour, single use):',
      `${baseUrl}/reset/${token}`,
      '',
      'If this was not you, ignore this email — your password is unchanged.',
    ].join('\n'),
  }
}

export function inviteEmail(baseUrl: string, token: string, inviterName: string) {
  return {
    subject: `${inviterName} invited you to Beyond Notes`,
    text: [
      `${inviterName} invited you to join their Beyond Notes instance.`,
      '',
      'Create your account here (link is valid for 7 days, single use):',
      `${baseUrl}/invite/${token}`,
    ].join('\n'),
  }
}
