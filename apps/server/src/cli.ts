// Admin rescue CLI. Shell access to the host IS the credential here:
//   docker compose exec app node dist/cli.js user:reset-password <email> <new-password>
import { createAuthService } from './auth'
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
    console.error(`Unknown command '${cmd ?? ''}'. Available: user:reset-password`)
    process.exitCode = 1
  } finally {
    await appDb.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
