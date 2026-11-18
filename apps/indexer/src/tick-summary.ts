import { BORROW_DECODER_VERSION } from "./borrow/decoder"
import type { IndexerTickSummary } from "./hook"
import type { Network } from "./ingest/networks"
import type { DatabaseUsage } from "./maintenance"
import { SCAN_DECODER_VERSION } from "./scan-stream/decoder"

// The tick summary before any stream runs. The projection's decoder version
// is the one its tables were built with (matchbox.projection_state), which
// the Worker keeps projecting with: a v2-built database reports 2 whether
// or not this tick's projection succeeds. It is left out when unknown (no
// tables built yet, or the read failed): the jobs Worker treats a change in
// this field as a rebuilt warehouse, so a guess would flag a false re-fill.
export function initialSummary(
  network: Network,
  cron: string,
  startedAt: Date,
  usage: DatabaseUsage,
  builtDecoderVersion: number | null,
): IndexerTickSummary {
  return {
    kind: "matchbox-indexer-tick",
    version: 1,
    network,
    cron,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    neonAwakeUntil: startedAt.toISOString(),
    database: {
      bytes: usage.bytes.toString(),
      capBytes: usage.capBytes.toString(),
      writable: usage.writable,
    },
    ingest: {
      status: "halted",
      lastBlock: null,
      from: null,
      to: null,
      logs: 0,
    },
    projection: {
      status: "halted",
      lastBlock: null,
      ...(builtDecoderVersion === null
        ? {}
        : { decoderVersion: builtDecoderVersion }),
    },
    borrow: {
      status: "halted",
      lastBlock: null,
      morphoEvents: 0,
      enclaveEvents: 0,
      decoderVersion: BORROW_DECODER_VERSION,
    },
    scan: {
      status: "halted",
      lastBlock: null,
      dayRows: 0,
      fees: 0,
      decoderVersion: SCAN_DECODER_VERSION,
    },
  }
}
