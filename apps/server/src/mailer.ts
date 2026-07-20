import { createTransport } from 'nodemailer'
import type { SettingsService } from './settings'

// The email seam. Everything that sends mail goes through this interface so
// dev/test run on a log (or capture) mailer. SMTP resolves through the
// settings service on every send — admin edits in the UI apply immediately,
// no restart, with env vars as the bootstrap fallback.
export interface Mailer {
  /** false = no SMTP anywhere; the UI hides email-dependent flows entirely */
  readonly configured: boolean
  send(to: string, subject: string, text: string): Promise<void>
}

export function createDynamicMailer(settings: SettingsService, log: (msg: string) => void): Mailer {
  return {
    get configured() {
      return settings.effectiveSmtp() !== null
    },
    async send(to, subject, text) {
      const smtp = settings.effectiveSmtp()
      if (!smtp) {
        log(`[mail] (no SMTP configured) to=${to} subject=${subject}\n${text}`)
        return
      }
      const transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      })
      await transport.sendMail({ from: smtp.from, to, subject, text })
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
