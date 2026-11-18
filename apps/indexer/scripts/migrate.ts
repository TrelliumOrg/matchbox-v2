import { resolve } from "node:path"
import { createLogger } from "@matchbox/logger"
import type { Pool, PoolClient } from "pg"
import { createDatabasePool, indexerRoot } from "./database"
import { type MigrationFile, readMigrations } from "./migration-lib"

const logger = createLogger({ fields: { service: "matchbox-indexer-migrate" } })

const migrationSets = [
  {
    schema: "matchbox",
    directory: resolve(indexerRoot, "db/migrations/matchbox"),
  },
  {
    schema: "matchbox_pro",
    directory: resolve(indexerRoot, "db/migrations/matchbox-pro"),
  },
] as const

async function ensureLedger(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function applyMigration(
  client: PoolClient,
  schema: string,
  migration: MigrationFile,
): Promise<void> {
  await client.query("BEGIN")
  try {
    await client.query(migration.sql)
    await client.query(
      `INSERT INTO ${schema}.schema_migrations (filename, checksum) VALUES ($1, $2)`,
      [migration.filename, migration.checksum],
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

// `--until <filename>` applies pending migrations up to and including that
// file and stops: 0013_row_seq.sql must run, then the row_seq backfill,
// before 0014_row_seq_finish.sql (RUNBOOK-scan-changes.md). A migration set
// without that file (matchbox_pro) is left untouched.
function untilFilename(): string | null {
  const index = process.argv.indexOf("--until")
  if (index === -1) return null
  const filename = process.argv[index + 1]
  if (filename === undefined || filename.startsWith("--")) {
    throw new Error("--until needs a migration filename")
  }
  return filename
}

async function migrateSet(
  pool: Pool,
  schema: string,
  directory: string,
  dryRun: boolean,
  until: string | null,
): Promise<number> {
  await ensureLedger(pool, schema)
  const migrations = await readMigrations(directory)
  const result = await pool.query<{ filename: string; checksum: string }>(
    `SELECT filename, checksum FROM ${schema}.schema_migrations`,
  )
  const applied = new Map(
    result.rows.map((row) => [row.filename, row.checksum]),
  )
  let pending = 0

  if (until !== null && !migrations.some((m) => m.filename === until)) {
    return 0
  }
  for (const migration of migrations) {
    if (until !== null && migration.filename > until) break
    const recordedChecksum = applied.get(migration.filename)
    if (recordedChecksum !== undefined) {
      if (recordedChecksum !== migration.checksum) {
        throw new Error(
          `Migration ${schema}/${migration.filename} changed after it was applied. Add a new immutable migration instead.`,
        )
      }
      continue
    }

    pending += 1
    if (dryRun) {
      logger.info({
        message: "Migration is pending",
        schema,
        filename: migration.filename,
      })
      continue
    }

    const client = await pool.connect()
    try {
      await applyMigration(client, schema, migration)
      logger.info({
        message: "Migration applied",
        schema,
        filename: migration.filename,
      })
    } finally {
      client.release()
    }
  }

  return pending
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run")
  const until = untilFilename()
  const pool = createDatabasePool()
  try {
    let pending = 0
    for (const migrationSet of migrationSets) {
      pending += await migrateSet(
        pool,
        migrationSet.schema,
        migrationSet.directory,
        dryRun,
        until,
      )
    }
    logger.info({
      message: dryRun ? "Migration dry run complete" : "Migrations complete",
      pending,
    })
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  logger.error({
    message: "Migration failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
