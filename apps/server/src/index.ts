import { loadConfig } from './config'
import { createDb } from './db'
import { buildServer } from './server'

async function main() {
  try {
    // Node's built-in .env loader; like dotenv it never overrides existing vars.
    process.loadEnvFile()
  } catch {
    // no .env present - fine, env vars or defaults apply
  }
  const config = loadConfig()
  const appDb = createDb(config.DATABASE_URL)
  await appDb.migrate(config.MIGRATIONS_DIR, {
    snapshotDir: config.BACKUPS_DIR,
    log: (msg) => console.log(msg),
  })

  const server = await buildServer(config, appDb)
  await server.listen({ port: config.PORT, host: '0.0.0.0' })

  const shutdown = async () => {
    await server.close()
    await appDb.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
