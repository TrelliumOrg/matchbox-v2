import { createLogger } from "@matchbox/logger"
import { createDatabasePool } from "./database"
import { ROLE_SQL } from "./role-sql"

const logger = createLogger({ fields: { service: "matchbox-indexer-roles" } })

async function main(): Promise<void> {
  const pool = createDatabasePool()
  try {
    await pool.query(ROLE_SQL)
    logger.info({ message: "Warehouse roles and privilege assertions passed" })
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  logger.error({
    message: "Role setup failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
