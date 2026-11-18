import {
  BORROW_CONTRACT_KINDS,
  BORROW_INDEXED_EVENTS,
  BORROW_STATIC_CONTRACTS,
  type BorrowContractKind,
} from "@matchbox/chain"
import { createLogger } from "@matchbox/logger"
import { type Address, type Hex, toEventSelector } from "viem"
import { type BlockWindow, blockWindows } from "../ingest/ingest"
import type { Network, NetworkConfig } from "../ingest/networks"
import { compareLogs, type RawLog, type RpcClient } from "../ingest/rpc"
import { BorrowDecoder, discoverEnclave } from "./decoder"
import type { BorrowContract } from "./rows"
import { type BorrowStore, contractKey, mergeBorrowContract } from "./store"

// The borrow stream: Morpho Blue and Enclave logs from Mezo RPC, decoded
// straight into matchbox.morpho_* and matchbox.enclave_events. It runs after
// the warehouse's own ingest in each tick, on its own checkpoint (stream
// 'borrow'), so it can catch up from 2026 history without touching the
// warehouse's logs checkpoint or matchbox_raw.
//
// Windows commit in block order, each with its rows, market totals, new
// contracts and checkpoint in one transaction. Like the warehouse ingest, a
// window that can't be fetched or decoded is never skipped: the checkpoint
// waits there.

const logger = createLogger({ fields: { service: "matchbox-indexer-borrow" } })

const TOPIC0S_BY_KIND = Object.fromEntries(
  BORROW_CONTRACT_KINDS.map((kind) => [
    kind,
    BORROW_INDEXED_EVENTS[kind].map((signature) => toEventSelector(signature)),
  ]),
) as Record<BorrowContractKind, Hex[]>

/** First block of borrow history: the earliest borrow contract's creation. */
export const BORROW_HISTORY_START = BORROW_STATIC_CONTRACTS.reduce(
  (first, contract) =>
    contract.fromBlock < first ? contract.fromBlock : first,
  BORROW_STATIC_CONTRACTS[0]?.fromBlock ?? 0n,
)

export type BorrowDeps = {
  config: NetworkConfig
  rpc: RpcClient
  store: BorrowStore
  // Defaults to BORROW_STATIC_CONTRACTS on mezo; tests inject their own.
  staticContracts?: BorrowContract[]
  historyStart?: bigint
}

export function borrowStaticContracts(network: Network): BorrowContract[] {
  if (network !== "mezo") return []
  return BORROW_STATIC_CONTRACTS.map((contract) => ({
    network,
    address: contract.address,
    kind: contract.kind,
    template: contract.template,
    createdBlock: contract.fromBlock,
    createdTx: null,
  }))
}

class BorrowContractSet {
  private readonly byKey = new Map<string, BorrowContract>()

  constructor(contracts: Iterable<BorrowContract>) {
    for (const contract of contracts) this.add(contract)
  }

  add(contract: BorrowContract): void {
    const key = contractKey(contract)
    this.byKey.set(key, mergeBorrowContract(this.byKey.get(key), contract))
  }

  has(contract: Pick<BorrowContract, "network" | "address">): boolean {
    return this.byKey.has(contractKey(contract))
  }

  kindOf(network: Network, address: Address): BorrowContractKind | undefined {
    return this.byKey.get(`${network}:${address}`)?.kind
  }

  activeAt(block: bigint): BorrowContract[] {
    return [...this.byKey.values()].filter(
      (contract) => contract.createdBlock <= block,
    )
  }
}

// One filter per kind: the kinds' topic sets overlap (RoleGranted, Upgraded)
// and eth_getLogs ANDs addresses with topics.
async function fetchLogs(
  deps: BorrowDeps,
  window: BlockWindow,
  contracts: BorrowContract[],
): Promise<RawLog[]> {
  return deps.rpc.getLogsForFilters(
    window.from,
    window.to,
    BORROW_CONTRACT_KINDS.map((kind) => ({
      addresses: [
        ...new Set(
          contracts
            .filter((contract) => contract.kind === kind)
            .map((contract) => contract.address),
        ),
      ].sort(),
      topic0s: TOPIC0S_BY_KIND[kind],
    })),
  )
}

type FetchedWindow = BlockWindow & {
  logs: RawLog[]
  // Addresses whose logs `logs` covers for this window.
  covered: Set<Address>
}

async function fetchWindow(
  deps: BorrowDeps,
  window: BlockWindow,
  known: BorrowContractSet,
): Promise<FetchedWindow> {
  const contracts = known.activeAt(window.to)
  return {
    ...window,
    logs: await fetchLogs(deps, window, contracts),
    covered: new Set(contracts.map((contract) => contract.address)),
  }
}

// A new Enclave's own earlier logs (it may lock veBTC long before governance
// grants it ENCLAVE_ROLE), fetched before its discovering window commits.
// Rare and governance-gated; one eth_getLogs per 10,000 blocks of history.
async function backfillEnclave(
  deps: BorrowDeps,
  enclave: BorrowContract,
  through: bigint,
): Promise<RawLog[]> {
  const start = deps.historyStart ?? BORROW_HISTORY_START
  const logs: RawLog[] = []
  for (const window of blockWindows(start, through, deps.config.windowSize)) {
    const part = await fetchLogs(deps, window, [enclave])
    for (const log of part) logs.push(log)
  }
  logger.warn({
    message: "Discovered a new Enclave and fetched its history",
    network: enclave.network,
    enclave: enclave.address,
    grantedAtBlock: enclave.createdBlock.toString(),
    logs: logs.length,
  })
  return logs
}

export type BorrowSummary = BlockWindow & {
  windows: number
  logs: number
  morphoEvents: number
  enclaveEvents: number
  contracts: number
}

export type BorrowRangeOptions = BlockWindow & { concurrency?: number }

export async function seedBorrowContracts(deps: BorrowDeps): Promise<void> {
  await deps.store.upsertContracts(
    deps.staticContracts ?? borrowStaticContracts(deps.config.network),
  )
}

export async function ingestBorrowRange(
  deps: BorrowDeps,
  options: BorrowRangeOptions,
): Promise<BorrowSummary> {
  const network = deps.config.network
  const concurrency = Math.max(1, options.concurrency ?? 1)
  await deps.store.ensureDecoderVersion(network)
  await seedBorrowContracts(deps)
  const known = new BorrowContractSet(await deps.store.loadContracts(network))
  const decoder = new BorrowDecoder(
    network,
    await deps.store.loadState(network),
  )
  let checkpoint = await deps.store.getCheckpoint(network)
  const start = deps.historyStart ?? BORROW_HISTORY_START
  const expectedFrom = checkpoint === null ? start : checkpoint + 1n
  if (options.from !== expectedFrom) {
    throw new Error(
      `Borrow ingest must continue from block ${expectedFrom}, not ${options.from}`,
    )
  }

  const summary: BorrowSummary = {
    from: options.from,
    to: options.to,
    windows: 0,
    logs: 0,
    morphoEvents: 0,
    enclaveEvents: 0,
    contracts: 0,
  }
  const windows = blockWindows(options.from, options.to, deps.config.windowSize)
  for (let index = 0; index < windows.length; index += concurrency) {
    const batch = await Promise.all(
      windows
        .slice(index, index + concurrency)
        .map((window) => fetchWindow(deps, window, known)),
    )
    for (const fetched of batch) {
      // An Enclave discovered by an earlier window of this batch was not in
      // the set this window was fetched with.
      const missing = known
        .activeAt(fetched.to)
        .filter((contract) => !fetched.covered.has(contract.address))
      const logs = [...fetched.logs]
      if (missing.length > 0) {
        for (const log of await fetchLogs(deps, fetched, missing)) {
          logs.push(log)
        }
      }

      const discovered: BorrowContract[] = []
      for (const log of logs) {
        const enclave = discoverEnclave(log, known.kindOf(network, log.address))
        if (enclave && !known.has(enclave)) {
          discovered.push(enclave)
          known.add(enclave)
        }
      }
      for (const enclave of discovered) {
        const history = await backfillEnclave(deps, enclave, fetched.to)
        for (const log of history) logs.push(log)
        // Fetched from the history start, so that is where it is registered.
        known.add({ ...enclave, createdBlock: start })
      }

      const unique = new Map<string, RawLog>()
      for (const log of logs) unique.set(`${log.txHash}-${log.logIndex}`, log)
      const ordered = [...unique.values()].sort(compareLogs)
      const transactions = new Map(
        (
          await deps.rpc.getTransactions([
            ...new Set(ordered.map((log) => log.txHash)),
          ])
        ).map((tx) => [tx.hash, tx]),
      )
      for (const log of ordered) {
        const kind = known.kindOf(network, log.address)
        const tx = transactions.get(log.txHash)
        if (kind === undefined || tx === undefined) {
          throw new Error(
            `Borrow log ${log.txHash}-${log.logIndex} has no ${kind === undefined ? "contract" : "transaction"}`,
          )
        }
        decoder.apply(log, tx, kind)
      }
      const rows = decoder.drain()
      const contracts = discovered.map((enclave) => ({
        ...enclave,
        createdBlock: start,
      }))
      await deps.store.commitWindow({
        network,
        fromBlock: fetched.from,
        toBlock: fetched.to,
        expectedCheckpoint: checkpoint,
        contracts,
        morphoEvents: rows.morphoEvents,
        enclaveEvents: rows.enclaveEvents,
        markets: rows.markets,
      })
      checkpoint = fetched.to
      summary.windows++
      summary.logs += ordered.length
      summary.morphoEvents += rows.morphoEvents.length
      summary.enclaveEvents += rows.enclaveEvents.length
      summary.contracts += contracts.length
    }
  }
  return summary
}

export type BorrowStatus = {
  safeHead: bigint
  lastBlock: bigint | null
  lag: bigint | null
}

export async function borrowStatus(
  deps: Pick<BorrowDeps, "config" | "rpc" | "store">,
  head?: bigint,
): Promise<BorrowStatus> {
  const [currentHead, lastBlock] = await Promise.all([
    head ?? deps.rpc.blockNumber(),
    deps.store.getCheckpoint(deps.config.network),
  ])
  const safeHead = currentHead - deps.config.confirmations
  return {
    safeHead,
    lastBlock,
    lag: lastBlock === null ? null : safeHead - lastBlock,
  }
}

// One tick: from the borrow checkpoint towards head minus confirmations, at
// most `maxBlocks` blocks. Null when already caught up. The cron fetches one
// window at a time; a backfill may fetch several in parallel (windows still
// commit in order).
export async function ingestBorrowToHead(
  deps: BorrowDeps,
  maxBlocks: bigint,
  head?: bigint,
  concurrency = 1,
): Promise<BorrowSummary | null> {
  const status = await borrowStatus(deps, head)
  const from =
    status.lastBlock === null
      ? (deps.historyStart ?? BORROW_HISTORY_START)
      : status.lastBlock + 1n
  if (from > status.safeHead) return null
  const limit = from + maxBlocks - 1n
  const to = limit < status.safeHead ? limit : status.safeHead
  return ingestBorrowRange(deps, { from, to, concurrency })
}
