import { WorkerEntrypoint } from "cloudflare:workers"
import { createMezoClient } from "@matchbox/api/chain/client"
import {
  cachedMezoFromKv,
  readReferencePrices,
} from "@matchbox/api/market/prices"
import type { Prices } from "@matchbox/contracts/read-models"
import { logger } from "@matchbox/logger"
import { priceCacheMaxAgeSeconds, refreshSeconds } from "./coingecko-budget"
import { crossChainHourly, crossChainMinute } from "./crosschain/entry"
import { type JobsEnv, parseJobsEnv } from "./env"
import { createLiveChainReader, runLiveSnapshot } from "./live/snapshot"
import { runPriceJob } from "./prices"
import { scanLive, scanPriceClose, scanUptime, startScan } from "./scan/run"
import { createWalletChainReader } from "./warehouse/chain"
import { createWarehouseReader, neonQueryRunner } from "./warehouse/reader"
import {
  runWarehouseSnapshot,
  type WarehouseSnapshotResult,
} from "./warehouse/snapshot"

// matchbox-jobs: cron Worker that fills READ_DB and the PRICES KV.
//
// - "* * * * *"          prices (KV every other minute, D1 sample each minute),
//                        then MUSD's cross-chain venue quotes (SCAN_DB);
//                        validator uptime from CometBFT commits beside them
// - "*/5 * * * *"        live RPC snapshot: Morpho, troves, Stability Pool,
//                        then cross-chain supply, pools and bridge (hourly)
// - "3,18,33,48 * * * *" warehouse fallback (skipped after a chained run)
//
// The warehouse snapshot's primary trigger is the indexer: right after its
// 15-minute ingest it calls `env.JOBS.warehouseSnapshot()` through a service
// binding, so the Neon reads land in the same compute wake window.

export const priceCron = "* * * * *"
export const liveCron = "*/5 * * * *"
export const warehouseCron = "3,18,33,48 * * * *"

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function loadEnv(raw: unknown): JobsEnv | null {
  const parsed = parseJobsEnv(raw)
  if (parsed.ok) return parsed.env
  logger.error({
    message: "Invalid matchbox-jobs configuration",
    problems: parsed.problems,
  })
  return null
}

function mezoClient(env: JobsEnv) {
  return createMezoClient(env.MEZO_RPC_URLS ?? undefined)
}

export async function prices(env: JobsEnv): Promise<Prices> {
  const rpcUrls = env.MEZO_RPC_URLS ?? []
  const now = nowSeconds()
  const refresh = refreshSeconds(
    env.COINGECKO_API_PLAN,
    env.COINGECKO_API_KEY !== null,
    env.COINGECKO_REFRESH_SECONDS,
  )
  return runPriceJob({
    db: env.READ_DB,
    kv: env.PRICES,
    readPrices: (previous) =>
      readReferencePrices({
        mezoMainnetRpcUrl:
          rpcUrls[0] ?? "https://mainnet.mezo.public.validationcloud.io",
        baseRpcUrl: env.BASE_RPC_URL,
        coingecko: {
          apiKey: env.COINGECKO_API_KEY,
          plan: env.COINGECKO_API_PLAN,
        },
        cachedMezoUsd: cachedMezoFromKv(previous),
        // A call lands on a KV publish minute only (coingecko-budget.ts).
        cacheMaxAgeSeconds: priceCacheMaxAgeSeconds(now, refresh),
        nowSeconds: now,
        logger: logger.child({ task: "prices" }),
      }),
    nowSeconds: now,
    logger: logger.child({ task: "prices" }),
  })
}

/** The live snapshot; returns the block it read. */
export async function live(env: JobsEnv): Promise<number> {
  const summary = await runLiveSnapshot({
    db: env.READ_DB,
    chain: createLiveChainReader(
      mezoClient(env),
      logger.child({ task: "live-snapshot" }),
    ),
    logWindowsPerRun: env.MORPHO_LOG_WINDOWS_PER_RUN,
    nowSeconds: nowSeconds(),
    logger: logger.child({ task: "live-snapshot" }),
  })
  logger.info({ message: "Live snapshot written", ...summary })
  return summary.block
}

export async function warehouse(
  env: JobsEnv,
  trigger: "chained" | "cron",
  afterWarehouseReads?: () => Promise<void>,
): Promise<WarehouseSnapshotResult> {
  if (env.WAREHOUSE_DATABASE_URL === null) {
    logger.warn({ message: "WAREHOUSE_DATABASE_URL unset; snapshot skipped" })
    return { status: "skipped", reason: "No warehouse configured" }
  }
  return runWarehouseSnapshot({
    db: env.READ_DB,
    kv: env.PRICES,
    warehouse: createWarehouseReader(
      neonQueryRunner(env.WAREHOUSE_DATABASE_URL),
    ),
    chain: createWalletChainReader(mezoClient(env)),
    trigger,
    sweepWallets: env.WAREHOUSE_SWEEP_WALLETS,
    nowSeconds: nowSeconds(),
    logger: logger.child({ task: "warehouse-snapshot", trigger }),
    ...(afterWarehouseReads === undefined ? {} : { afterWarehouseReads }),
  })
}

/** Starts the scan copy without letting its failure reach the Pro step. */
async function prepareScan(
  rawEnv: unknown,
  env: JobsEnv,
  trigger: "chained" | "cron",
  summary: unknown,
) {
  try {
    return await startScan(rawEnv, env, trigger, summary)
  } catch (error) {
    logger.error({ message: "Job failed", task: "scan-copy", error })
    return null
  }
}

/**
 * The Pro snapshot, then the scan copy's D1 work. The scan's one Neon
 * read runs right after the snapshot's last Neon query (or after the
 * snapshot, when it stopped early), so it adds almost nothing to Neon's
 * awake time.
 */
async function warehouseAndScan(
  rawEnv: unknown,
  env: JobsEnv,
  trigger: "chained" | "cron",
  summary: unknown,
): Promise<WarehouseSnapshotResult> {
  const scan = await prepareScan(rawEnv, env, trigger, summary)
  try {
    return await warehouse(env, trigger, scan?.read)
  } finally {
    if (scan !== null) await guarded("scan-copy", () => scan.finish())
  }
}

async function guarded(task: string, work: () => Promise<unknown>) {
  try {
    await work()
  } catch (error) {
    logger.error({ message: "Job failed", task, error })
  }
}

/**
 * The service-binding entrypoint the indexer calls after each tick:
 * `await env.JOBS.warehouseSnapshot()`.
 */
export default class Jobs extends WorkerEntrypoint<unknown> {
  /**
   * The indexer passes its tick summary (IndexerTickSummary). The Pro
   * snapshot ignores it; the scan copy step reads it and skips Neon when no
   * stream advanced. The scan step finishes after the Pro snapshot, whether
   * or not that snapshot succeeded.
   */
  async warehouseSnapshot(summary?: unknown): Promise<WarehouseSnapshotResult> {
    const env = loadEnv(this.env)
    if (env === null) return { status: "skipped", reason: "Misconfigured" }
    return warehouseAndScan(this.env, env, "chained", summary)
  }

  override async fetch(): Promise<Response> {
    return Response.json(
      { service: "matchbox-jobs" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }

  override async scheduled(controller: ScheduledController): Promise<void> {
    const env = loadEnv(this.env)
    if (env === null) return
    switch (controller.cron) {
      case priceCron:
        // Uptime runs beside the prices, not after them: neither waits on
        // the other's network reads. MUSD's cross-chain quotes still follow
        // the price job, whether or not it succeeded.
        await Promise.all([
          (async () => {
            await guarded("prices", async () => {
              const latest = await prices(env)
              await guarded("scan-price-close", () =>
                scanPriceClose(this.env, latest),
              )
            })
            await guarded("crosschain-price", () =>
              crossChainMinute(this.env, env),
            )
          })(),
          guarded("scan-uptime", () => scanUptime(this.env, env)),
        ])
        return
      case liveCron: {
        let liveBlock: number | null = null
        await guarded("live-snapshot", async () => {
          liveBlock = await live(env)
        })
        // Closing values are skipped when the snapshot failed (null), and
        // read at the snapshot's own block otherwise, so a day's rows are
        // one consistent set.
        const block = liveBlock
        await guarded("scan-live", () => scanLive(this.env, env, block))
        await guarded("crosschain-hourly", () =>
          crossChainHourly(this.env, env),
        )
        return
      }
      case warehouseCron:
        await guarded("warehouse-snapshot", () =>
          warehouseAndScan(this.env, env, "cron", null),
        )
        return
      default:
        logger.warn({ message: "Unknown cron", cron: controller.cron })
    }
  }
}
