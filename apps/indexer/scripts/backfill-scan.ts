import { parseArgs } from "node:util"
import { createLogger } from "@matchbox/logger"
import { Pool } from "pg"
import { blockWindows } from "../src/ingest/ingest"
import { networkConfig, networkSchema } from "../src/ingest/networks"
import { RpcClient } from "../src/ingest/rpc"
import { databaseUsage } from "../src/maintenance"
import { decodeScanLogs } from "../src/scan-stream/decoder"
import {
  fetchScanWindow,
  ingestScanRange,
  type ScanDeps,
} from "../src/scan-stream/ingest"
import { PgScanStore } from "../src/scan-stream/pg-store"
import { loadDirectDatabaseUrl } from "./database"

// Fills the scan stream's history (token transfer days from genesis, mUSD
// fees from block 178,630) from a laptop instead of 66 cron ticks. Same
// code, checkpoint and commits as the cron, so the two never disagree and
// either can finish what the other started.
//
//   pnpm --filter @matchbox/indexer backfill:scan -- --network mezo \
//     [--apply] [--replay] [--to N] [--max-windows 400] [--concurrency 4] \
//     [--probe 3]
//
// Dry run by default: reads the checkpoint (one query, which wakes Neon),
// prints the windows and RPC calls the range needs, and with --probe N
// fetches and decodes the next N windows from RPC without writing.
// --apply ingests from the checkpoint, at most --max-windows windows a run
// (resumable: run it again), stopping before the storage guard. --replay
// (with --apply) empties the stream first: one reset tombstone per table.
// Stop the cron first only for --replay (README, "Scan stream").
//
// Cost, full history at block 13.1M: 1,313 windows, 2 eth_getLogs each plus
// one header batch per 50 blocks with logs (about 2,700 calls); about 10
// minutes at concurrency 4. Neon: one short transaction a window, about
// 1,313 x 30 ms, under a minute awake, about 0.01 CU-hours.

const logger = createLogger({ fields: { service: "matchbox-indexer-scan" } })

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    network: { type: "string", default: "mezo" },
    apply: { type: "boolean", default: false },
    replay: { type: "boolean", default: false },
    to: { type: "string" },
    "max-windows": { type: "string", default: "400" },
    concurrency: { type: "string", default: "4" },
    probe: { type: "string", default: "0" },
  },
})

async function main(): Promise<void> {
  const network = networkSchema.parse(values.network)
  const config = networkConfig(network)
  const maxWindows = BigInt(values["max-windows"] ?? "400")
  const concurrency = Number.parseInt(values.concurrency ?? "4", 10)
  const probe = Number.parseInt(values.probe ?? "0", 10)
  if (values.replay && !values.apply) {
    throw new Error("--replay deletes the scan tables: it needs --apply")
  }
  const pool = new Pool({
    connectionString: loadDirectDatabaseUrl(),
    max: 2,
    application_name: "matchbox-indexer-backfill-scan",
  })
  const rpc = new RpcClient({ endpoints: config.endpoints, network })
  const deps: ScanDeps = { config, rpc, store: new PgScanStore(pool) }
  const startedAt = Date.now()
  try {
    if (values.replay) {
      await deps.store.reset(network)
      logger.info({ message: "Scan stream reset", network })
    }
    const head = (await rpc.blockNumber()) - config.confirmations
    const target = values.to ? BigInt(values.to) : head
    const checkpoint = await deps.store.getCheckpoint(network)
    const from = checkpoint === null ? 0n : checkpoint + 1n
    const windows = blockWindows(from, target, config.windowSize)
    logger.info({
      message: "Scan stream range",
      network,
      from: from.toString(),
      to: target.toString(),
      windows: windows.length,
      getLogsCalls: windows.length * 2,
    })

    if (!values.apply) {
      for (const window of windows.slice(0, probe)) {
        const logs = await fetchScanWindow(deps, window)
        const rows = decodeScanLogs(logs)
        logger.info({
          message: "Probed window (not written)",
          from: window.from.toString(),
          logs: logs.length,
          dayRows: rows.days.length,
          fees: rows.fees.length,
        })
      }
      logger.info({
        message: "Dry run: nothing written. Re-run with --apply to ingest.",
      })
      return
    }

    let cursor = from
    let done = 0n
    while (cursor <= target && done < maxWindows) {
      const usage = await databaseUsage(pool)
      if (!usage.writable) {
        throw new Error(
          `Database at ${usage.bytes} of ${usage.capBytes} bytes: stopped before the storage guard`,
        )
      }
      // Twenty windows a chunk, so the guard is re-checked as it goes.
      const chunk = 20n < maxWindows - done ? 20n : maxWindows - done
      const end = cursor + config.windowSize * chunk - 1n
      const to = end < target ? end : target
      const summary = await ingestScanRange(deps, {
        from: cursor,
        to,
        concurrency,
      })
      done += BigInt(summary.windows)
      cursor = to + 1n
      logger.info({
        message: "Scan stream chunk committed",
        through: to.toString(),
        windows: done.toString(),
        logs: summary.logs,
        fees: summary.fees,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      })
    }
    logger.info({
      message:
        cursor > target
          ? "Scan stream history complete"
          : "Window limit reached: run again to continue",
      through: (cursor - 1n).toString(),
      seconds: Math.round((Date.now() - startedAt) / 1000),
    })
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  logger.error({
    message: "Scan stream backfill failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
