import { createMezoClient } from "@matchbox/api/chain/client"
import type { Prices } from "@matchbox/contracts/read-models"
import { logger } from "@matchbox/logger"
import type { RunTrigger } from "../cursors"
import type { JobsEnv } from "../env"
import {
  cometNode,
  createCometReader,
  defaultUptimeNodes,
} from "../uptime/comet"
import { runUptimePoll } from "../uptime/poll"
import { neonQueryRunner } from "../warehouse/reader"
import {
  createClosingChainReader,
  runClosingValues,
  runPriceClose,
} from "./closing"
import { type ScanCopyRun, startScanCopy } from "./copy"
import { parseScanEnv } from "./env"
import { runGovernance } from "./governance"
import { createLockChainReader, runLockDistribution } from "./lock-distribution"
import { createScanWarehouseReader } from "./neon"
import { runOnceDaily } from "./once-daily"
import { parseTickSummary } from "./summary"

// What apps/jobs/src/index.ts calls. Each entry is a no-op without SCAN_DB,
// so the Worker deploys and runs before the scan database exists.

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Before the warehouse snapshot: a started copy step, whose read() the
 * snapshot calls right after its last Neon query and whose finish() runs
 * after it. Null (with a log line) when SCAN_DB is not bound or no
 * warehouse is configured, so the Worker runs without the scan database.
 */
export async function startScan(
  rawEnv: unknown,
  env: JobsEnv,
  trigger: RunTrigger,
  rawSummary: unknown,
): Promise<ScanCopyRun | null> {
  const scan = parseScanEnv(rawEnv)
  const log = logger.child({ task: "scan-copy", trigger })
  if (scan.scanDb === null) {
    log.info({ message: "SCAN_DB not bound; scan copy skipped" })
    return null
  }
  if (env.WAREHOUSE_DATABASE_URL === null) return null
  const summary = parseTickSummary(rawSummary)
  if (summary === "invalid") {
    log.warn({ message: "Unreadable tick summary; copying every table" })
  }
  return startScanCopy({
    db: scan.scanDb,
    warehouse: createScanWarehouseReader(
      neonQueryRunner(env.WAREHOUSE_DATABASE_URL),
    ),
    trigger,
    summary: summary === "invalid" ? null : summary,
    nowSeconds: nowSeconds(),
    logger: log,
  })
}

/**
 * After the live snapshot: closing values, the once-a-day reads, then the
 * governance summaries (README "Governance summaries").
 */
export async function scanLive(
  rawEnv: unknown,
  env: JobsEnv,
  liveBlock: number | null,
): Promise<void> {
  const scan = parseScanEnv(rawEnv)
  if (scan.scanDb === null) return
  const now = nowSeconds()
  const log = logger.child({ task: "scan-live" })
  await runClosingValues({
    readDb: env.READ_DB,
    scanDb: scan.scanDb,
    chain: createClosingChainReader(
      createMezoClient(env.MEZO_RPC_URLS ?? undefined),
    ),
    nowSeconds: now,
    logger: log,
    liveBlock,
  })
  await runOnceDaily({
    db: scan.scanDb,
    api: scan.api,
    fetcher: (input, init) => fetch(input, init),
    nowSeconds: now,
    logger: log,
  })
  await runGovernance({
    db: scan.scanDb,
    nowSeconds: now,
    logger: log.child({ step: "governance" }),
  })
  await runLockDistribution({
    db: scan.scanDb,
    reader: createLockChainReader(
      createMezoClient(env.MEZO_RPC_URLS ?? undefined, 20_000),
    ),
    nowSeconds: now,
    logger: log.child({ step: "lock-distribution" }),
  })
}

/**
 * Each minute: validator uptime from a community CometBFT node (README
 * "Validator uptime"). Reads stop after 25 s so a slow node cannot run
 * into the next minute; the rest is read on the next run.
 */
export async function scanUptime(rawEnv: unknown, env: JobsEnv): Promise<void> {
  const scan = parseScanEnv(rawEnv)
  if (scan.scanDb === null) return
  const mezo = createMezoClient(env.MEZO_RPC_URLS ?? undefined, 5_000)
  await runUptimePoll({
    db: scan.scanDb,
    reader: createCometReader({ fetcher: (input, init) => fetch(input, init) }),
    primary: cometNode(
      env.UPTIME_RPC_URL ?? defaultUptimeNodes.rpc,
      env.UPTIME_REST_URL ?? defaultUptimeNodes.rest,
    ),
    fallback: cometNode(
      env.UPTIME_FALLBACK_RPC_URL ?? defaultUptimeNodes.fallbackRpc,
      env.UPTIME_FALLBACK_REST_URL ?? defaultUptimeNodes.fallbackRest,
    ),
    evmHeight: async () => Number(await mezo.getBlockNumber()),
    nowSeconds: nowSeconds(),
    maxHeights: env.UPTIME_HEIGHTS_PER_RUN,
    readBudgetMs: 25_000,
    logger: logger.child({ task: "scan-uptime" }),
  })
}

/** After the price job: the day's closing price. */
export async function scanPriceClose(
  rawEnv: unknown,
  prices: Prices,
): Promise<void> {
  const scan = parseScanEnv(rawEnv)
  if (scan.scanDb === null) return
  await runPriceClose({ scanDb: scan.scanDb, prices, nowSeconds: nowSeconds() })
}
