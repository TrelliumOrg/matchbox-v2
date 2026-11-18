import type { Network } from "../ingest/networks"
import {
  type MusdFeeRow,
  SCAN_DECODER_VERSION,
  type TokenDayDelta,
} from "./decoder"

// Where the scan stream keeps its checkpoint ('scan'), decoder version and
// rows. The Postgres store (pg-store.ts) is the Worker's; the memory store
// backs the tests.

export const SCAN_STREAM = "scan"

export class ScanReplayRequiredError extends Error {
  constructor(network: Network, built: number) {
    super(
      `${network} scan stream tables were built with scan decoder v${built}, current is v${SCAN_DECODER_VERSION}. Run scripts/backfill-scan.ts --replay.`,
    )
    this.name = "ScanReplayRequiredError"
  }
}

export class ScanCheckpointMovedError extends Error {
  constructor(
    network: Network,
    expected: bigint | null,
    actual: bigint | null,
  ) {
    super(
      `${network} scan checkpoint is ${actual ?? "unset"}, expected ${expected ?? "unset"}: another run is ingesting`,
    )
    this.name = "ScanCheckpointMovedError"
  }
}

/** Postgres undefined_table: 0015_scan_stream.sql has not been applied. */
export function isMissingScanSchema(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "42P01"
  )
}

export type ScanWindowCommit = {
  network: Network
  fromBlock: bigint
  toBlock: bigint
  // The checkpoint this window continues from. The commit refuses if the
  // stored one moved since: day rollups are added, so a window must never
  // apply twice.
  expectedCheckpoint: bigint | null
  days: TokenDayDelta[]
  fees: MusdFeeRow[]
}

export type ScanStore = {
  getCheckpoint(network: Network): Promise<bigint | null>
  ensureDecoderVersion(network: Network): Promise<void>
  builtWithDecoderVersion(network: Network): Promise<number | null>
  commitWindow(commit: ScanWindowCommit): Promise<void>
  reset(network: Network): Promise<void>
}

type DayTotals = Omit<TokenDayDelta, "token" | "day">

export class MemoryScanStore implements ScanStore {
  readonly days = new Map<string, DayTotals>()
  readonly fees = new Map<string, MusdFeeRow>()
  private checkpoint: bigint | null = null
  private version: number | null = null
  commits = 0

  async getCheckpoint(_network: Network): Promise<bigint | null> {
    return this.checkpoint
  }

  async ensureDecoderVersion(network: Network): Promise<void> {
    if (this.version === null) this.version = SCAN_DECODER_VERSION
    if (this.version !== SCAN_DECODER_VERSION) {
      throw new ScanReplayRequiredError(network, this.version)
    }
  }

  async builtWithDecoderVersion(_network: Network): Promise<number | null> {
    return this.version
  }

  async commitWindow(commit: ScanWindowCommit): Promise<void> {
    if (this.checkpoint !== commit.expectedCheckpoint) {
      throw new ScanCheckpointMovedError(
        commit.network,
        commit.expectedCheckpoint,
        this.checkpoint,
      )
    }
    for (const delta of commit.days) {
      const key = `${delta.token}|${delta.day}`
      const current = this.days.get(key)
      this.days.set(key, {
        transfers: (current?.transfers ?? 0n) + delta.transfers,
        volume: (current?.volume ?? 0n) + delta.volume,
        minted: (current?.minted ?? 0n) + delta.minted,
        burned: (current?.burned ?? 0n) + delta.burned,
      })
    }
    for (const fee of commit.fees) {
      const key = `${fee.txHash}-${fee.logIndex}`
      if (!this.fees.has(key)) this.fees.set(key, fee)
    }
    this.checkpoint = commit.toBlock
    this.commits++
  }

  async reset(_network: Network): Promise<void> {
    this.days.clear()
    this.fees.clear()
    this.checkpoint = null
    this.version = null
  }
}
