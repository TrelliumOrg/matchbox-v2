import { parseArgs } from "node:util"
import { createLogger } from "@matchbox/logger"
import { databaseUsage } from "../src/maintenance"
import {
  stampHistoryBatch,
  TRACKED_TABLES,
  unstampedRows,
} from "../src/row-seq"
import { createDatabasePool } from "./database"

// Stamps the rows that existed before 0013_row_seq.sql, once, so every row
// of a tracked table carries a row_seq and 0014_row_seq_finish.sql can make
// the column NOT NULL. History stamps come from matchbox.row_seq_history
// (below 10^12, under every live stamp), in each table's natural order:
// a reader filling from 0 reads history in block order, then live changes.
//
//   pnpm --filter @matchbox/indexer backfill:row-seq            # dry run
//   pnpm --filter @matchbox/indexer backfill:row-seq -- --apply \
//     [--batch 5000] [--vacuum-every 20000]
//
// Dry run by default: counts the unstamped rows per table and writes
// nothing. --apply stamps them in batches, each its own short transaction,
// so the cron can keep running beside it. Resumable: a run picks up the
// rows still unstamped. Every update writes a new row version, so the
// table is vacuumed every --vacuum-every rows and the next batches reuse
// the space (measured on a local Postgres 18 with 230,000 activity rows:
// 298 MB before, 313 MB after; without the vacuums, 431 MB). Stops before
// the indexer's storage guard (90% of the cap). Needs the owner's direct
// URL (DATABASE_URL_UNPOOLED): VACUUM needs the table owner.

const logger = createLogger({
  fields: { service: "matchbox-indexer-backfill-row-seq" },
})

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    apply: { type: "boolean", default: false },
    batch: { type: "string", default: "5000" },
    "vacuum-every": { type: "string", default: "20000" },
  },
})

async function main(): Promise<void> {
  const batch = Number.parseInt(values.batch ?? "5000", 10)
  const vacuumEvery = Number.parseInt(values["vacuum-every"] ?? "20000", 10)
  if (!(batch > 0) || !(vacuumEvery > 0)) {
    throw new Error("--batch and --vacuum-every must be positive")
  }
  const pool = createDatabasePool()
  const client = await pool.connect()
  const startedAt = Date.now()
  try {
    await client.query("SET statement_timeout = 0")
    const pending = []
    for (const table of TRACKED_TABLES) {
      const rows = await unstampedRows(client, table)
      pending.push({ table, rows })
      logger.info({
        message: "Unstamped rows",
        table: table.name,
        rows,
        batches: Math.ceil(rows / batch),
      })
    }
    if (!values.apply) {
      logger.info({
        message: "Dry run: nothing written. Re-run with --apply to stamp.",
        rows: pending.reduce((sum, entry) => sum + entry.rows, 0),
      })
      return
    }

    for (const { table, rows } of pending) {
      if (rows === 0) continue
      let stamped = 0
      let sinceVacuum = 0
      for (;;) {
        const usage = await databaseUsage(client)
        if (!usage.writable) {
          throw new Error(
            `Database at ${usage.bytes} of ${usage.capBytes} bytes: stopped before the storage guard`,
          )
        }
        const count = await stampHistoryBatch(client, table, batch)
        stamped += count
        sinceVacuum += count
        if (count === 0 || sinceVacuum >= vacuumEvery) {
          await client.query(`VACUUM matchbox.${table.name}`)
          sinceVacuum = 0
          logger.info({
            message: "Stamped history rows",
            table: table.name,
            stamped,
            of: rows,
            elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
          })
        }
        if (count === 0) break
      }
      await client.query(`ANALYZE matchbox.${table.name}`)
    }

    for (const table of TRACKED_TABLES) {
      const left = await unstampedRows(client, table)
      if (left > 0) {
        throw new Error(
          `matchbox.${table.name} still has ${left} rows unstamped`,
        )
      }
    }
    logger.info({
      message:
        "Every tracked row is stamped: 0014_row_seq_finish.sql can run now",
      seconds: Math.round((Date.now() - startedAt) / 1000),
    })
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error: unknown) => {
  logger.error({
    message: "Row stamp backfill failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
