import type { Hex } from "viem"
import type { Network } from "../ingest/networks"
import { BORROW_DECODER_VERSION, type BorrowState } from "./decoder"
import type {
  BorrowContract,
  EnclaveEventRow,
  EnclavePosition,
  MorphoEventRow,
  MorphoMarketRow,
} from "./rows"

// Where the borrow stream keeps its registry, checkpoint, decoder version
// and rows. The Postgres store (pg-store.ts) is the Worker's; the memory
// store backs the tests.

export const BORROW_STREAM = "borrow"

export class BorrowReplayRequiredError extends Error {
  constructor(network: Network, built: number) {
    super(
      `${network} borrow tables were built with borrow decoder v${built}, current is v${BORROW_DECODER_VERSION}. Run scripts/backfill-borrow.ts --replay.`,
    )
    this.name = "BorrowReplayRequiredError"
  }
}

export class BorrowCheckpointMovedError extends Error {
  constructor(
    network: Network,
    expected: bigint | null,
    actual: bigint | null,
  ) {
    super(
      `${network} borrow checkpoint is ${actual ?? "unset"}, expected ${expected ?? "unset"}: another run is ingesting`,
    )
    this.name = "BorrowCheckpointMovedError"
  }
}

// Postgres undefined_table: the borrow migration (0012_borrow.sql) has not
// been applied. The Worker then runs the warehouse as before and leaves the
// borrow stream idle, so it can replace the live Worker ahead of the
// migration.
export function isMissingBorrowSchema(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "42P01"
  )
}

export type BorrowWindowCommit = {
  network: Network
  fromBlock: bigint
  toBlock: bigint
  // The checkpoint this window continues from. The commit refuses if the
  // stored checkpoint moved since, so rows and market totals never apply
  // twice.
  expectedCheckpoint: bigint | null
  contracts: BorrowContract[]
  morphoEvents: MorphoEventRow[]
  enclaveEvents: EnclaveEventRow[]
  markets: MorphoMarketRow[]
}

export type BorrowStore = {
  /** The version the tables were built with, or null before the first run. */
  builtWithDecoderVersion(network: Network): Promise<number | null>
  /** Records the current version on first use; throws on another one. */
  ensureDecoderVersion(network: Network): Promise<void>
  loadContracts(network: Network): Promise<BorrowContract[]>
  upsertContracts(contracts: BorrowContract[]): Promise<void>
  getCheckpoint(network: Network): Promise<bigint | null>
  loadState(network: Network): Promise<BorrowState>
  commitWindow(commit: BorrowWindowCommit): Promise<void>
  /** Clears rows, state and checkpoint; keeps discovered contracts. */
  reset(network: Network): Promise<void>
}

export function contractKey(
  contract: Pick<BorrowContract, "network" | "address">,
) {
  return `${contract.network}:${contract.address}`
}

// The earlier creation wins, so a back-filled Enclave keeps its first block.
export function mergeBorrowContract(
  existing: BorrowContract | undefined,
  incoming: BorrowContract,
): BorrowContract {
  if (!existing) return incoming
  return incoming.createdBlock < existing.createdBlock
    ? { ...existing, createdBlock: incoming.createdBlock }
    : existing
}

function rowKey(row: { network: Network; txHash: Hex; logIndex: number }) {
  return `${row.network}:${row.txHash}:${row.logIndex}`
}

export class MemoryBorrowStore implements BorrowStore {
  readonly contracts = new Map<string, BorrowContract>()
  readonly checkpoints = new Map<Network, bigint>()
  readonly versions = new Map<Network, number>()
  readonly morphoEvents = new Map<string, MorphoEventRow>()
  readonly enclaveEvents = new Map<string, EnclaveEventRow>()
  readonly markets = new Map<string, MorphoMarketRow>()
  commits = 0

  async builtWithDecoderVersion(network: Network): Promise<number | null> {
    return this.versions.get(network) ?? null
  }

  async ensureDecoderVersion(network: Network): Promise<void> {
    const built = this.versions.get(network)
    if (built === undefined) {
      this.versions.set(network, BORROW_DECODER_VERSION)
    } else if (built !== BORROW_DECODER_VERSION) {
      throw new BorrowReplayRequiredError(network, built)
    }
  }

  async loadContracts(network: Network): Promise<BorrowContract[]> {
    return [...this.contracts.values()].filter(
      (contract) => contract.network === network,
    )
  }

  async upsertContracts(contracts: BorrowContract[]): Promise<void> {
    for (const contract of contracts) {
      const key = contractKey(contract)
      this.contracts.set(
        key,
        mergeBorrowContract(this.contracts.get(key), contract),
      )
    }
  }

  async getCheckpoint(network: Network): Promise<bigint | null> {
    return this.checkpoints.get(network) ?? null
  }

  async loadState(network: Network): Promise<BorrowState> {
    const markets = new Map<Hex, MorphoMarketRow>()
    for (const market of this.markets.values()) {
      if (market.network === network) {
        markets.set(market.marketId, { ...market })
      }
    }
    const latest = new Map<Hex, EnclaveEventRow>()
    const rows = [...this.enclaveEvents.values()]
      .filter((row) => row.network === network && row.positionId !== null)
      .sort(
        (left, right) =>
          Number(left.blockNumber - right.blockNumber) ||
          left.logIndex - right.logIndex,
      )
    for (const row of rows) {
      if (row.positionId !== null) latest.set(row.positionId, row)
    }
    const positions = new Map<Hex, EnclavePosition>()
    for (const [positionId, row] of latest) {
      positions.set(positionId, positionFromRow(positionId, row))
    }
    return { markets, positions }
  }

  async commitWindow(commit: BorrowWindowCommit): Promise<void> {
    const current = this.checkpoints.get(commit.network) ?? null
    if (current !== commit.expectedCheckpoint) {
      throw new BorrowCheckpointMovedError(
        commit.network,
        commit.expectedCheckpoint,
        current,
      )
    }
    await this.upsertContracts(commit.contracts)
    for (const row of commit.morphoEvents) {
      this.morphoEvents.set(rowKey(row), row)
    }
    for (const row of commit.enclaveEvents) {
      this.enclaveEvents.set(`${rowKey(row)}:${row.veBtcTokenId}`, row)
    }
    for (const market of commit.markets) {
      this.markets.set(`${market.network}:${market.marketId}`, { ...market })
    }
    this.checkpoints.set(commit.network, commit.toBlock)
    this.commits++
  }

  async reset(network: Network): Promise<void> {
    for (const map of [this.morphoEvents, this.enclaveEvents, this.markets]) {
      for (const [key, row] of map) {
        if (row.network === network) map.delete(key)
      }
    }
    this.checkpoints.delete(network)
    this.versions.delete(network)
  }
}

/** Rebuilds a position from its latest row (both stores use this). */
export function positionFromRow(
  positionId: Hex,
  row: Pick<
    EnclaveEventRow,
    "enclave" | "borrower" | "principal" | "pledgedVeBtc" | "action"
  >,
): EnclavePosition {
  if (row.borrower === null || row.principal === null) {
    throw new Error(`Enclave position ${positionId} row lacks its borrower`)
  }
  return {
    positionId,
    enclave: row.enclave,
    borrower: row.borrower,
    principal: row.principal,
    pledged: [...row.pledgedVeBtc],
    open: row.action !== "POSITION_CLOSED",
  }
}
