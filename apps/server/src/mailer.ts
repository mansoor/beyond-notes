import { createTransport } from 'nodemailer'
import type { Config } from './config'

// The email seam. Everything that sends mail goes through this interface so
// dev/test run on a log (or capture) mailer and SMTP stays a deployment fact.
export interface Mailer {
  /** false = no SMTP configured; the UI hides email-dependent flows entirely */
  configured: boolean
  send(to: string, subject: string, text: string): Promise<void>
}

export function mailConfigured(config: Config): boolean {
  return Boolean(config.SMTP_HOST && config.MAIL_FROM)
}

export function createSmtpMailer(config: Config): Mailer {
  const transport = createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  })
  return {
    configured: true,
    async send(to, subject, text) {
      await transport.sendMail({ from: config.MAIL_FROM, to, subject, text })
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
