import { existsSync } from "node:fs"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createLogger } from "@matchbox/logger"
import { Pool } from "pg"
import { type DatabaseTarget, resolveDirectDatabase } from "./database-target"

export const repositoryRoot = fileURLToPath(
  new URL("../../..", import.meta.url),
)

export const indexerRoot = fileURLToPath(new URL("..", import.meta.url))

// Local credentials, never committed: apps/indexer/.dev.vars (what wrangler
// dev reads too), then the repository root's .env.local. A variable already
// set wins, so a shell export overrides both. Point these at a Neon
// development branch only. Which file set each variable is kept, so a
// script can say where its database came from.
const variableOrigins = new Map<string, string>()
for (const file of [
  resolve(indexerRoot, ".dev.vars"),
  resolve(repositoryRoot, ".env.local"),
]) {
  if (!existsSync(file)) continue
  const before = new Set(Object.keys(process.env))
  process.loadEnvFile(file)
  for (const key of Object.keys(process.env)) {
    if (!before.has(key)) {
      variableOrigins.set(key, relative(repositoryRoot, file))
    }
  }
}

const logger = createLogger({
  fields: { service: "matchbox-indexer-database" },
})

// The direct database URL, its host, and the variable and file it came
// from. The first of MATCHBOX_DATABASE_URL_UNPOOLED, DATABASE_URL_UNPOOLED,
// MATCHBOX_DATABASE_URL and DATABASE_URL that is set wins.
export function directDatabaseTarget(): DatabaseTarget {
  return resolveDirectDatabase(process.env, variableOrigins)
}

export function loadDirectDatabaseUrl(): string {
  const { url, host } = directDatabaseTarget()
  logger.info({ message: "Using direct PostgreSQL endpoint", hostname: host })
  return url
}

export function createDatabasePool(): Pool {
  return new Pool({
    connectionString: loadDirectDatabaseUrl(),
    max: 1,
    application_name: "matchbox-indexed-data-phase-a",
  })
}
