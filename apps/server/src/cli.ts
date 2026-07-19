// Admin CLI. Shell access to the host IS the credential here:
//   docker compose exec app node dist/cli.js user:reset-password <email> <new-password>
//   docker compose exec app node dist/cli.js blobs:migrate fs s3
import { thumbKey } from './attachments'
import { createAuthService } from './auth'
import { createFsBlobStore } from './blobstore'
import { createS3BlobStore, s3Configured } from './blobstore-s3'
import { loadConfig } from './config'
import { createDb } from './db'
import { createRepo } from './repo'

async function main() {
  try {
    process.loadEnvFile()
  } catch {
    // no .env — env vars or defaults apply
  }
  const [cmd, ...args] = process.argv.slice(2)
  const config = loadConfig()
  const appDb = createDb(config.DATABASE_URL)
  await appDb.migrate(config.MIGRATIONS_DIR)
  const auth = createAuthService(createRepo(appDb))

  try {
    if (cmd === 'user:reset-password') {
      const [email, password] = args
      if (!email || !password || password.length < 10) {
        console.error('usage: cli user:reset-password <email> <new-password, 10+ chars>')
        process.exitCode = 1
        return
      }
      const ok = await auth.forceResetPassword(email.toLowerCase(), password)
      if (ok) {
        console.log('Password reset. 2FA disabled, all sessions revoked — sign in fresh.')
      } else {
        console.error('No user with that email.')
        process.exitCode = 1
      }
      return
    }
    if (cmd === 'blobs:migrate') {
      // Copies every known blob between drivers. Idempotent and non-destructive:
      // the source is left in place — delete it yourself once you've verified.
      const [from = '', to = ''] = args
      const valid = ['fs', 's3']
      if (!valid.includes(from) || !valid.includes(to) || from === to) {
        console.error('usage: cli blobs:migrate <fs|s3> <s3|fs>   (both drivers via env)')
        process.exitCode = 1
        return
      }
      if ((from === 's3' || to === 's3') && !s3Configured(config)) {
        console.error('S3 is not configured. Set S3_BUCKET (and endpoint/keys) first.')
        process.exitCode = 1
        return
      }
      const stores = {
        fs: createFsBlobStore(config.UPLOADS_DIR),
        s3: createS3BlobStore(config),
      }
      const src = stores[from as 'fs' | 's3']
      const dst = stores[to as 'fs' | 's3']
      const repo = createRepo(appDb)
      let copied = 0
      let skipped = 0
      let missing = 0
      for (const attachment of await repo.listAttachments()) {
        for (const key of [attachment.hash, thumbKey(attachment.hash)]) {
          if (!(await src.exists(key))) {
            // thumbs are optional (non-image attachments never had one)
            if (key === attachment.hash) {
              console.warn(`missing in ${from}: ${key} (${attachment.filename})`)
              missing++
            }
            continue
          }
          if (await dst.exists(key)) {
            skipped++
            continue
          }
          await dst.put(key, await src.read(key))
          copied++
        }
      }
      console.log(
        `Done: ${copied} copied, ${skipped} already present, ${missing} missing from source.`,
      )
      if (missing > 0) process.exitCode = 1
      return
    }
    console.error(`Unknown command '${cmd ?? ''}'. Available: user:reset-password, blobs:migrate`)
    process.exitCode = 1
  } finally {
    await appDb.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
