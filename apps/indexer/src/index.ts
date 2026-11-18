import { createLogger } from "@matchbox/logger"
import { Pool } from "pg"
import { BORROW_DECODER_VERSION } from "./borrow/decoder"
import { type BorrowDeps, ingestBorrowToHead } from "./borrow/ingest"
import { PgBorrowStore } from "./borrow/pg-store"
import {
  BorrowReplayRequiredError,
  isMissingBorrowSchema,
} from "./borrow/store"
import {
  builtDecoderVersion,
  DECODER_VERSION,
  ProjectionReplayRequiredError,
  runProjection,
} from "./decode/index"
import type { Env } from "./env"
import { escrowMaxTimeDrift } from "./escrow-maxtime"
import { isStale, sendHeartbeat } from "./health"
import { healthReport, usageJson } from "./health-report"
import { NEON_SUSPEND_MS, runTickHook } from "./hook"
import { headStatus, type IngestDeps, ingestToHead } from "./ingest/ingest"
import type { Network } from "./ingest/networks"
import { networkConfig } from "./ingest/networks"
import { RpcClient } from "./ingest/rpc"
import { LOGS_STREAM, PgIngestStore } from "./ingest/store"
import { databaseUsage, pruneRaw } from "./maintenance"
import { SCAN_DECODER_VERSION } from "./scan-stream/decoder"
import { ingestScanToHead, type ScanDeps } from "./scan-stream/ingest"
import { PgScanStore } from "./scan-stream/pg-store"
import {
  isMissingScanSchema,
  ScanReplayRequiredError,
} from "./scan-stream/store"
import { initialSummary } from "./tick-summary"

const logger = createLogger({ fields: { service: "matchbox-indexer" } })

const NETWORK: Network = "mezo"
// The cron runs every 15 minutes (wrangler.jsonc), so at head a tick covers
// ~235 blocks. The cap bounds a catch-up tick after an outage (about two
// days of blocks) to five eth_getLogs windows.
const MAX_BLOCKS_PER_TICK = 50_000n
// Projection keeps pace with ingest: the same bound, so a catch-up tick
// projects what it ingested.
const MAX_PROJECTION_BLOCKS_PER_TICK = 50_000n
// runProjection never passes the 'logs' checkpoint, so it needs no other
// upper bound.
const THROUGH_INGEST_CHECKPOINT = 2n ** 63n - 1n
// The borrow stream (src/borrow) sees a few events a day, so a tick can
// cover more blocks: twenty windows (sixty small eth_getLogs) while it
// catches up from its history start, one window at head.
const MAX_BORROW_BLOCKS_PER_TICK = 200_000n
// The scan stream (src/scan-stream) sees about 400 logs a day: two
// eth_getLogs a window. At head one window; while it fills its history from
// genesis, twenty windows a tick (66 ticks, about 17 hours, for 13.1M
// blocks), unless scripts/backfill-scan.ts fills it first.
const MAX_SCAN_BLOCKS_PER_TICK = 200_000n

function withDeps<T>(
  env: Env,
  work: (
    deps: IngestDeps,
    pool: Pool,
    borrow: BorrowDeps,
    scan: ScanDeps,
  ) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 })
  const config = networkConfig(NETWORK)
  const rpc = new RpcClient({ endpoints: config.endpoints, network: NETWORK })
  const deps: IngestDeps = { config, rpc, store: new PgIngestStore(pool) }
  const borrow: BorrowDeps = { config, rpc, store: new PgBorrowStore(pool) }
  const scan: ScanDeps = { config, rpc, store: new PgScanStore(pool) }
  return work(deps, pool, borrow, scan).finally(() => pool.end())
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (
      request.method === "GET" &&
      new URL(request.url).pathname === "/health"
    ) {
      try {
        const report = await withDeps(env, (deps, pool, borrowDeps, scanDeps) =>
          healthReport(NETWORK, deps, pool, borrowDeps, scanDeps),
        )
        return Response.json(
          { ...report.body, environment: env.ENVIRONMENT },
          {
            status: report.status,
            headers: { "Cache-Control": "no-store" },
          },
        )
      } catch (error) {
        logger.error({
          message: "Health check failed",
          error: error instanceof Error ? error.message : String(error),
        })
        return Response.json(
          { service: "matchbox-indexer", status: "error" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        )
      }
    }

    return Response.json(
      { error: "not_found", message: "No route for this request." },
      { status: 404 },
    )
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _context: ExecutionContext,
  ): Promise<void> {
    const startedAt = new Date()
    await withDeps(env, async (deps, pool, borrowDeps, scanDeps) => {
      // Neon's Free plan refuses writes past its storage cap. Stop well
      // short of it so no window or batch is cut off mid-write; /health
      // reports the usage. Pruning cannot help here (raw is kept small
      // already), so this needs a person: raise the cap or free space.
      const usage = await databaseUsage(pool)
      const built = await builtDecoderVersion(pool, NETWORK).catch(() => null)
      const summary = initialSummary(
        NETWORK,
        controller.cron,
        startedAt,
        usage,
        built,
      )

      // The post-tick hook (src/hook.ts) runs last, after the tick's final
      // query, so its Neon reads ride the same wake window.
      async function finish(): Promise<void> {
        const finishedAt = new Date()
        summary.finishedAt = finishedAt.toISOString()
        summary.neonAwakeUntil = new Date(
          finishedAt.getTime() + NEON_SUSPEND_MS,
        ).toISOString()
        await runTickHook(env.JOBS, summary, logger)
      }

      if (!usage.writable) {
        logger.error({
          message: "WAREHOUSE NEAR STORAGE CAP: ingest and projection paused",
          network: NETWORK,
          ...usageJson(usage),
        })
        await finish()
        return
      }

      // A window that can't be fetched is never skipped, so the checkpoint
      // stops there until someone fixes the cause the error names. Every tick
      // says so loudly, and projection below still catches up to the windows
      // committed before it.
      let ingestError: Error | null = null
      try {
        const ingested = await ingestToHead(deps, MAX_BLOCKS_PER_TICK)
        logger.info({
          message: ingested ? "Ingested logs" : "Ingest already at head",
          cron: controller.cron,
          network: NETWORK,
          ...(ingested
            ? {
                from: ingested.from.toString(),
                to: ingested.to.toString(),
                logs: ingested.logs,
                transactions: ingested.transactions,
                contracts: ingested.contracts,
              }
            : {}),
        })
        summary.ingest = {
          status: ingested ? "advanced" : "at-head",
          lastBlock: null,
          from: ingested?.from.toString() ?? null,
          to: ingested?.to.toString() ?? null,
          logs: ingested?.logs ?? 0,
        }
      } catch (error) {
        ingestError = errorOf(error)
        summary.ingest.status = "failed"
        const status = await headStatus(deps).catch(() => null)
        logger.error({
          message: "INGEST FAILED: logs checkpoint not advancing",
          network: NETWORK,
          lastBlock: status?.lastBlock?.toString() ?? null,
          lag: status?.lag?.toString() ?? null,
          stale: status === null ? null : isStale(status),
          error: ingestError.message,
        })
      }
      const ingestCheckpoint = await deps.store
        .getCheckpoint(NETWORK, LOGS_STREAM)
        .catch(() => null)
      summary.ingest.lastBlock = ingestCheckpoint?.toString() ?? null

      // Project whatever ingest has checkpointed. runProjection issues its own
      // BEGIN/COMMIT, so it gets a dedicated client, and never projects past
      // the 'logs' checkpoint. A failed projection leaves its checkpoint
      // untouched; the next tick resumes from it.
      let projectionHalted = false
      let projectionError: Error | null = null
      const client = await pool.connect()
      try {
        const projected = await runProjection(
          client,
          NETWORK,
          THROUGH_INGEST_CHECKPOINT,
          { maxBlocks: MAX_PROJECTION_BLOCKS_PER_TICK },
        )
        logger.info({
          message:
            projected.logsScanned > 0
              ? "Projected activity"
              : "Projection already at ingest checkpoint",
          network: NETWORK,
          throughBlock: projected.throughBlock.toString(),
          logsScanned: projected.logsScanned,
          activitiesWritten: projected.activitiesWritten,
        })
        summary.projection.status =
          projected.logsScanned > 0 ? "advanced" : "at-head"
        summary.projection.decoderVersion = projected.decoderVersion
        summary.projection.lastBlock =
          projected.throughBlock >= 0n
            ? projected.throughBlock.toString()
            : null

        // Raw older than the retention window and already projected is not
        // read again (src/maintenance.ts).
        const pruned = await pruneRaw(client, NETWORK)
        if (pruned !== null) {
          logger.info({
            message: "Pruned raw history",
            network: NETWORK,
            throughBlock: pruned.throughBlock.toString(),
            logs: pruned.logs,
            transactions: pruned.transactions,
          })
        }
      } catch (error) {
        if (error instanceof ProjectionReplayRequiredError) {
          projectionHalted = true
          // Retrying cannot fix this: the tables were built by another
          // decoder version. Ingest keeps running; activity stops advancing
          // until someone runs scripts/rebuild.ts --replay (raw is pruned,
          // so the replay re-ingests history from RPC).
          logger.error({
            message:
              "PROJECTION HALTED: decoder version changed, replay required",
            network: NETWORK,
            decoderVersion: DECODER_VERSION,
            error: error.message,
          })
        } else {
          // Thrown at the end of the tick, as before; the borrow stream and
          // the hook still run.
          projectionError = errorOf(error)
          summary.projection.status = "failed"
        }
      } finally {
        client.release()
      }

      // Morpho Blue and Enclaves, on their own checkpoint (src/borrow). A
      // failure here never holds the warehouse back, and the reverse.
      let borrowError: Error | null = null
      try {
        const borrowed = await ingestBorrowToHead(
          borrowDeps,
          MAX_BORROW_BLOCKS_PER_TICK,
        )
        logger.info({
          message: borrowed ? "Ingested borrow events" : "Borrow at head",
          network: NETWORK,
          ...(borrowed
            ? {
                from: borrowed.from.toString(),
                to: borrowed.to.toString(),
                logs: borrowed.logs,
                morphoEvents: borrowed.morphoEvents,
                enclaveEvents: borrowed.enclaveEvents,
                contracts: borrowed.contracts,
              }
            : {}),
        })
        summary.borrow.status = borrowed ? "advanced" : "at-head"
        summary.borrow.morphoEvents = borrowed?.morphoEvents ?? 0
        summary.borrow.enclaveEvents = borrowed?.enclaveEvents ?? 0
      } catch (error) {
        if (isMissingBorrowSchema(error)) {
          logger.warn({
            message:
              "Borrow tables missing: run the 0012_borrow migration to start the borrow stream",
            network: NETWORK,
          })
        } else if (error instanceof BorrowReplayRequiredError) {
          logger.error({
            message:
              "BORROW HALTED: borrow decoder version changed, replay required",
            network: NETWORK,
            decoderVersion: BORROW_DECODER_VERSION,
            error: error.message,
          })
        } else {
          borrowError = errorOf(error)
          summary.borrow.status = "failed"
          logger.error({
            message: "BORROW INGEST FAILED: borrow checkpoint not advancing",
            network: NETWORK,
            error: borrowError.message,
          })
        }
      }
      const borrowCheckpoint = await borrowDeps.store
        .getCheckpoint(NETWORK)
        .catch(() => null)
      summary.borrow.lastBlock = borrowCheckpoint?.toString() ?? null

      // Token transfer days and mUSD fees, on their own checkpoint
      // (src/scan-stream). Like the borrow stream, a failure here holds
      // nothing else back, and the reverse.
      let scanError: Error | null = null
      const scanSummary = summary.scan
      try {
        const scanned = await ingestScanToHead(
          scanDeps,
          MAX_SCAN_BLOCKS_PER_TICK,
        )
        logger.info({
          message: scanned ? "Ingested scan stream" : "Scan stream at head",
          network: NETWORK,
          ...(scanned
            ? {
                from: scanned.from.toString(),
                to: scanned.to.toString(),
                logs: scanned.logs,
                dayRows: scanned.dayRows,
                fees: scanned.fees,
              }
            : {}),
        })
        if (scanSummary) {
          scanSummary.status = scanned ? "advanced" : "at-head"
          scanSummary.dayRows = scanned?.dayRows ?? 0
          scanSummary.fees = scanned?.fees ?? 0
        }
      } catch (error) {
        if (isMissingScanSchema(error)) {
          logger.warn({
            message:
              "Scan stream tables missing: run the 0015_scan_stream migration to start it",
            network: NETWORK,
          })
        } else if (error instanceof ScanReplayRequiredError) {
          logger.error({
            message:
              "SCAN HALTED: scan decoder version changed, replay required",
            network: NETWORK,
            decoderVersion: SCAN_DECODER_VERSION,
            error: error.message,
          })
        } else {
          scanError = errorOf(error)
          if (scanSummary) scanSummary.status = "failed"
          logger.error({
            message: "SCAN INGEST FAILED: scan checkpoint not advancing",
            network: NETWORK,
            error: scanError.message,
          })
        }
      }
      if (scanSummary) {
        const scanCheckpoint = await scanDeps.store
          .getCheckpoint(NETWORK)
          .catch(() => null)
        scanSummary.lastBlock = scanCheckpoint?.toString() ?? null
      }

      // The dead man's switch alerts when these pings stop: a checkpoint
      // stale past 45 minutes, a halted or failing projection, a full
      // database, or a tick that crashes or never runs (src/health.ts).
      // Decoder v3 decodes with each escrow's MAXTIME as a constant; a
      // proxy upgrade that changes it must stop the pings too
      // (src/escrow-maxtime.ts). An RPC failure here only warns.
      const drift = await escrowMaxTimeDrift(deps.rpc).catch(
        (error: unknown) => {
          logger.warn({
            message: "Escrow MAXTIME check failed",
            error: errorOf(error).message,
          })
          return []
        },
      )
      if (drift.length > 0) {
        logger.error({
          message:
            "ESCROW MAXTIME CHANGED: decoder v3's lock ends are wrong from the upgrade on; update ESCROW_MAXTIME",
          network: NETWORK,
          drift: drift.map((entry) => ({
            escrow: entry.escrow,
            expected: entry.expected.toString(),
            onChain: entry.onChain.toString(),
          })),
        })
      }
      if (
        env.HEARTBEAT_URL &&
        !projectionHalted &&
        projectionError === null &&
        drift.length === 0
      ) {
        const status = await headStatus(deps).catch(() => null)
        if (status !== null && !isStale(status)) {
          await sendHeartbeat(env.HEARTBEAT_URL)
        }
      }

      await finish()

      // Thrown last, so Cloudflare still records the tick as failed.
      const failure = ingestError ?? projectionError ?? borrowError ?? scanError
      if (failure !== null) throw failure
    })
  },
} satisfies ExportedHandler<Env>
