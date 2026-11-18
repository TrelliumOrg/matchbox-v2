import type { Pool } from "pg"
import { BORROW_DECODER_VERSION } from "./borrow/decoder"
import { type BorrowDeps, borrowStatus } from "./borrow/ingest"
import { isMissingBorrowSchema } from "./borrow/store"
import { DECODER_VERSION, projectionStatus } from "./decode/index"
import { escrowMaxTimeDrift } from "./escrow-maxtime"
import { isStale } from "./health"
import { headStatus, type IngestDeps } from "./ingest/ingest"
import type { Network } from "./ingest/networks"
import { type DatabaseUsage, databaseUsage } from "./maintenance"
import { SCAN_DECODER_VERSION } from "./scan-stream/decoder"
import { type ScanDeps, scanStatus } from "./scan-stream/ingest"
import { isMissingScanSchema } from "./scan-stream/store"

// The body of GET /health. It must answer at every step of a migration
// rollout (RUNBOOK-scan-changes.md): a stream whose tables do not exist yet
// reports null fields instead of failing the whole check.

export type HealthReport = {
  status: 200 | 503
  body: Record<string, unknown>
}

export function usageJson(usage: DatabaseUsage) {
  return {
    bytes: usage.bytes.toString(),
    capBytes: usage.capBytes.toString(),
    usedPercent: ((usage.bytes * 100n) / usage.capBytes).toString(),
    writable: usage.writable,
  }
}

// Runs a stream's reads, all of them: its checkpoint read alone never
// touches the stream's own tables, so the decoder version read is where a
// missing table shows up.
async function nullIfMissing<T>(
  isMissing: (error: unknown) => boolean,
  work: () => Promise<T>,
): Promise<T | null> {
  try {
    return await work()
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export async function healthReport(
  network: Network,
  deps: IngestDeps,
  pool: Pick<Pool, "connect">,
  borrowDeps: BorrowDeps,
  scanDeps: ScanDeps,
): Promise<HealthReport> {
  const status = await headStatus(deps)
  const client = await pool.connect()
  let projection: Awaited<ReturnType<typeof projectionStatus>>
  let usage: DatabaseUsage
  try {
    projection = await projectionStatus(client, network)
    usage = await databaseUsage(client)
  } finally {
    client.release()
  }
  // Before 0012_borrow.sql the borrow fields are null.
  const borrow = await nullIfMissing(isMissingBorrowSchema, async () => ({
    status: await borrowStatus(borrowDeps, status.head),
    built: await borrowDeps.store.builtWithDecoderVersion(network),
  }))
  // Before 0015_scan_stream.sql the scan fields are null.
  const scan = await nullIfMissing(isMissingScanSchema, async () => ({
    status: await scanStatus(scanDeps, status.head),
    built: await scanDeps.store.builtWithDecoderVersion(network),
  }))
  // Null when the RPC read fails: the check is advisory here.
  const drift = await escrowMaxTimeDrift(deps.rpc).catch(() => null)
  const borrowBuilt = borrow?.built ?? null
  const scanBuilt = scan?.built ?? null
  return {
    // Stale answers 503 with the same body, so `curl -f` fails.
    status: isStale(status) ? 503 : 200,
    body: {
      service: "matchbox-indexer",
      network,
      head: status.head.toString(),
      lastBlock: status.lastBlock?.toString() ?? null,
      lag: status.lag?.toString() ?? null,
      stale: isStale(status),
      projection: {
        lastBlock: projection.projectedBlock?.toString() ?? null,
        // Blocks ingested but not yet projected.
        lag: projection.lag?.toString() ?? null,
        decoderVersion: DECODER_VERSION,
        builtWithDecoderVersion: projection.builtWithDecoderVersion,
        replayRequired: projection.replayRequired,
        // Built with an older supported decoder: still projecting with it;
        // `rebuild:history -- --replay` would upgrade.
        upgradeAvailable: projection.upgradeAvailable,
      },
      borrow: {
        lastBlock: borrow?.status.lastBlock?.toString() ?? null,
        lag: borrow?.status.lag?.toString() ?? null,
        decoderVersion: BORROW_DECODER_VERSION,
        builtWithDecoderVersion: borrowBuilt,
        replayRequired:
          borrowBuilt !== null && borrowBuilt !== BORROW_DECODER_VERSION,
      },
      scan: {
        lastBlock: scan?.status.lastBlock?.toString() ?? null,
        lag: scan?.status.lag?.toString() ?? null,
        decoderVersion: SCAN_DECODER_VERSION,
        builtWithDecoderVersion: scanBuilt,
        replayRequired:
          scanBuilt !== null && scanBuilt !== SCAN_DECODER_VERSION,
      },
      escrowMaxTime:
        drift === null
          ? null
          : {
              ok: drift.length === 0,
              drift: drift.map((entry) => ({
                escrow: entry.escrow,
                expected: entry.expected.toString(),
                onChain: entry.onChain.toString(),
              })),
            },
      database: usageJson(usage),
    },
  }
}
