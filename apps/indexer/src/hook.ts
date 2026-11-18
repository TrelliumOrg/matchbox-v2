// The contract between the indexer and whatever runs right after its tick
// (apps/jobs' warehouse snapshot). Neon's free compute suspends five minutes
// after its last query, and every tick wakes it, so anything that reads Neon
// should run inside that same wake window instead of waking it again on its
// own schedule (docs/plan.md, "Neon compute budget").
//
// Wiring: matchbox-jobs' default WorkerEntrypoint has a warehouseSnapshot
// method (apps/jobs/src/index.ts), and the indexer gets a service binding to
// it named JOBS (wrangler.jsonc, "services"). At the end of every tick the
// indexer awaits JOBS.warehouseSnapshot(summary). The method may ignore the
// summary; reading it lets the snapshot skip ticks where nothing advanced.
// Import the types only, so the jobs bundle carries nothing from the
// indexer:
//
//   import type { IndexerTickSummary } from "@matchbox/indexer/hook"
//
//   async warehouseSnapshot(summary?: IndexerTickSummary) {
//     const advanced = [summary?.projection, summary?.borrow].some(
//       (stream) => stream === undefined || stream.status === "advanced",
//     )
//     if (!advanced) return { status: "skipped", reason: "Nothing advanced" }
//     // read Neon (matchbox_api_ro), write D1 read models
//   }
//
// Everything is JSON-safe: block numbers and byte counts are decimal
// strings.

export type IndexerStreamStatus = "advanced" | "at-head" | "failed" | "halted"

export type IndexerTickSummary = {
  /** Always "matchbox-indexer-tick"; lets a receiver check the shape. */
  kind: "matchbox-indexer-tick"
  version: 1
  network: "mezo" | "mezo-testnet"
  /** The cron expression that fired, e.g. "*\/15 * * * *". */
  cron: string
  startedAt: string
  finishedAt: string
  /**
   * When Neon's compute suspends if nothing else queries it: the last
   * indexer query plus the five-minute suspend timeout. Work that starts
   * before this rides the same wake window.
   */
  neonAwakeUntil: string
  database: {
    bytes: string
    capBytes: string
    /** False when the storage guard paused the tick (90% of the cap). */
    writable: boolean
  }
  /** Raw log ingest (the warehouse's 'logs' checkpoint). */
  ingest: {
    status: IndexerStreamStatus
    lastBlock: string | null
    from: string | null
    to: string | null
    logs: number
  }
  /** Explorer-compatible projection ('projection' checkpoint). */
  projection: {
    status: IndexerStreamStatus
    lastBlock: string | null
    /**
     * The decoder version the projection tables are built with (and
     * projected with). Absent when unknown: no tables yet, or unreadable.
     */
    decoderVersion?: number
  }
  /** Morpho Blue and Enclave tables ('borrow' checkpoint). */
  borrow: {
    status: IndexerStreamStatus
    lastBlock: string | null
    morphoEvents: number
    enclaveEvents: number
    decoderVersion: number
  }
  /**
   * Token transfer days and mUSD fees ('scan' checkpoint). Optional within
   * version 1: absent from Workers that predate the scan stream.
   */
  scan?: {
    status: IndexerStreamStatus
    lastBlock: string | null
    dayRows: number
    fees: number
    decoderVersion: number
  }
}

/** What the JOBS service binding must expose. Its result is ignored. */
export type IndexerTickHook = {
  warehouseSnapshot(summary: IndexerTickSummary): Promise<unknown>
}

/** Neon's free compute suspends this long after its last query. */
export const NEON_SUSPEND_MS = 5 * 60 * 1000

export type TickHookLogger = {
  info(entry: { message: string } & Record<string, unknown>): void
  error(entry: { message: string } & Record<string, unknown>): void
}

/**
 * Calls the hook and never throws: a failing snapshot must not fail the
 * indexer's tick or hold its checkpoint. Returns whether the hook finished.
 */
export async function runTickHook(
  hook: IndexerTickHook | undefined,
  summary: IndexerTickSummary,
  logger: TickHookLogger,
): Promise<boolean> {
  if (hook === undefined) return false
  const started = Date.now()
  try {
    await hook.warehouseSnapshot(summary)
    logger.info({
      message: "Tick hook finished",
      network: summary.network,
      durationMs: Date.now() - started,
    })
    return true
  } catch (error) {
    logger.error({
      message: "TICK HOOK FAILED: the post-tick snapshot did not run",
      network: summary.network,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
