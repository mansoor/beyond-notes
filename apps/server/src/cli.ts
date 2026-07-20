// Admin CLI. Shell access to the host IS the credential here:
//   docker compose exec app node dist/cli.js user:reset-password <email> <new-password>
//   docker compose exec app node dist/cli.js blobs:migrate fs s3
import { thumbKey } from './attachments'
import { createAuthService } from './auth'
import { createFsBlobStore } from './blobstore'
import { createDbBlobStore } from './blobstore-db'
import { createDynamicBlobStore } from './blobstore-dynamic'
import { createS3BlobStore } from './blobstore-s3'
import { loadConfig } from './config'
import { createDb } from './db'
import { exportInstance, importInstance, importMarkdownDir } from './export'
import { createPagesService } from './pages'
import { createRepo } from './repo'
import { loadOrCreateSecretsKey } from './secrets'
import { createSettingsService } from './settings'

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
      const valid = ['fs', 's3', 'db']
      if (!valid.includes(from) || !valid.includes(to) || from === to) {
        console.error('usage: cli blobs:migrate <fs|s3|db> <fs|s3|db>')
        process.exitCode = 1
        return
      }
      const repo = createRepo(appDb)
      const cliSettings = createSettingsService(repo, config, {
        secretsKey: loadOrCreateSecretsKey(config),
      })
      await cliSettings.load()
      const storageCfg = cliSettings.effectiveStorage()
      if ((from === 's3' || to === 's3') && !storageCfg.s3Bucket) {
        console.error('S3 is not configured. Fill it in Settings > Storage or set S3_BUCKET.')
        process.exitCode = 1
        return
      }
      const stores = {
        fs: createFsBlobStore(config.UPLOADS_DIR),
        db: createDbBlobStore(repo),
        s3: createS3BlobStore({
          bucket: storageCfg.s3Bucket,
          endpoint: storageCfg.s3Endpoint,
          region: storageCfg.s3Region,
          accessKey: storageCfg.s3AccessKey,
          secretKey: storageCfg.s3SecretKey,
          forcePathStyle: storageCfg.s3ForcePathStyle,
        }),
      }
      const src = stores[from as 'fs' | 's3' | 'db']
      const dst = stores[to as 'fs' | 's3' | 'db']
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
    const repo = createRepo(appDb)
    const secretsKey = loadOrCreateSecretsKey(config)
    const settings = createSettingsService(repo, config, { secretsKey })
    await settings.load()
    // reads fall back across every driver; writes go to the active one
    const blobs = createDynamicBlobStore(settings, config, repo)

    if (cmd === 'export') {
      const [dir] = args
      if (!dir) {
        console.error('usage: cli export <directory>')
        process.exitCode = 1
        return
      }
      const res = await exportInstance(repo, blobs, dir, { secretsKey })
      console.log(`Exported ${res.tables} tables and ${res.blobs} blobs to ${dir}`)
      return
    }

    if (cmd === 'import') {
      const [dir] = args
      if (!dir) {
        console.error('usage: cli import <directory>   (target database must be empty)')
        process.exitCode = 1
        return
      }
      const res = await importInstance(repo, blobs, dir, { secretsKey })
      console.log(`Imported ${res.users} users, ${res.pages} pages, ${res.blobs} blobs.`)
      console.log('Sessions were not carried over — everyone signs in fresh.')
      return
    }

    if (cmd === 'import:markdown') {
      const [dir, spaceName, email] = args
      if (!dir || !spaceName || !email) {
        console.error('usage: cli import:markdown <directory> <space-name> <owner-email>')
        process.exitCode = 1
        return
      }
      const user = await repo.getUserByEmail(email.toLowerCase())
      if (!user) {
        console.error('No user with that email.')
        process.exitCode = 1
        return
      }
      const pages = createPagesService(repo)
      const res = await importMarkdownDir(repo, pages, user, dir, spaceName)
      console.log(`Imported ${res.pages} pages into new space '${spaceName}'.`)
      return
    }

    console.error(
      `Unknown command '${cmd ?? ''}'. Available: user:reset-password, blobs:migrate, export, import, import:markdown`,
    )
    process.exitCode = 1
  } finally {
    await appDb.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
