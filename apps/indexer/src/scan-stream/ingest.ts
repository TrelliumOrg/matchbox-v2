import {
  ACTIVE_POOL_DEBT_UPDATED_TOPIC,
  ENCLAVE_DEBT_TOPICS,
  ERC20_TRANSFER_TOPIC,
  MUSD_FEE_SOURCES,
  MUSD_FEE_TOPICS,
  MUSD_PCV_MINT_TOPICS,
  SCAN_STREAM_HISTORY_START,
  SCAN_STREAM_TOKENS,
} from "@matchbox/chain"
import { type BlockWindow, blockWindows } from "../ingest/ingest"
import type { NetworkConfig } from "../ingest/networks"
import type { LogFilter, RawLog, RpcClient } from "../ingest/rpc"
import { decodeScanLogs } from "./decoder"
import type { ScanStore } from "./store"

// The scan stream: ERC-20 Transfer on six tokens and the mUSD fee events
// from Mezo RPC, decoded straight into matchbox.token_transfer_days and
// matchbox.musd_fees. It runs after the borrow stream in each tick, on its
// own checkpoint (stream 'scan'), so it fills its history from genesis
// without re-fetching anything for the warehouse's 'logs' stream or the
// borrow stream, and keeps no raw rows.
//
// Two eth_getLogs per window, whatever the window holds:
// - the six tokens' Transfer, the BorrowerOperations and TroveManager fee
//   events, ActivePoolDebtUpdated and the EnclaveDebtManager interest, fee
//   and debt events in one filter (each contract emits only its own of
//   these topics, so the AND of addresses and topics over-includes
//   nothing);
// - MUSD Transfer(0x0, PCV), the MUSD minted to PCV (fees, trove interest,
//   Enclave interest and fees, and the one bootstrap loan).
// Plus one header batch per 50 blocks that hold logs (timestamps; Mezo's
// eth_getLogs reports blockTimestamp 0x0).

export type ScanDeps = {
  config: NetworkConfig
  rpc: RpcClient
  store: ScanStore
  // Defaults to SCAN_STREAM_HISTORY_START; tests start later.
  historyStart?: bigint
}

export function scanFilters(): LogFilter[] {
  return [
    {
      addresses: [
        ...SCAN_STREAM_TOKENS.map((token) => token.address),
        MUSD_FEE_SOURCES.borrowerOperations,
        MUSD_FEE_SOURCES.troveManager,
        MUSD_FEE_SOURCES.activePool,
        MUSD_FEE_SOURCES.enclaveDebtManager,
      ].sort(),
      topic0s: [
        ERC20_TRANSFER_TOPIC,
        ...MUSD_FEE_TOPICS,
        ACTIVE_POOL_DEBT_UPDATED_TOPIC,
        ...ENCLAVE_DEBT_TOPICS,
      ].sort(),
    },
    {
      addresses: [MUSD_FEE_SOURCES.musd],
      topic0s: [ERC20_TRANSFER_TOPIC],
      topics: MUSD_PCV_MINT_TOPICS,
    },
  ]
}

export type ScanSummary = BlockWindow & {
  windows: number
  logs: number
  dayRows: number
  fees: number
}

export type ScanRangeOptions = BlockWindow & { concurrency?: number }

function historyStart(deps: ScanDeps): bigint {
  return deps.historyStart ?? SCAN_STREAM_HISTORY_START
}

/**
 * Fetches and decodes one window without writing it: the dry run's sample
 * and the tests' oracle.
 */
export async function fetchScanWindow(
  deps: Pick<ScanDeps, "rpc">,
  window: BlockWindow,
): Promise<RawLog[]> {
  return deps.rpc.getLogsForFilters(window.from, window.to, scanFilters())
}

export async function ingestScanRange(
  deps: ScanDeps,
  options: ScanRangeOptions,
): Promise<ScanSummary> {
  const network = deps.config.network
  if (network !== "mezo") {
    throw new Error(`The scan stream knows mainnet tokens only, not ${network}`)
  }
  const concurrency = Math.max(1, options.concurrency ?? 1)
  await deps.store.ensureDecoderVersion(network)
  let checkpoint = await deps.store.getCheckpoint(network)
  const expectedFrom =
    checkpoint === null ? historyStart(deps) : checkpoint + 1n
  if (options.from !== expectedFrom) {
    throw new Error(
      `Scan ingest must continue from block ${expectedFrom}, not ${options.from}`,
    )
  }
  const summary: ScanSummary = {
    from: options.from,
    to: options.to,
    windows: 0,
    logs: 0,
    dayRows: 0,
    fees: 0,
  }
  const windows = blockWindows(options.from, options.to, deps.config.windowSize)
  for (let index = 0; index < windows.length; index += concurrency) {
    const batch = await Promise.all(
      windows.slice(index, index + concurrency).map(async (window) => ({
        ...window,
        logs: await fetchScanWindow(deps, window),
      })),
    )
    // Windows commit in block order, each with its checkpoint.
    for (const fetched of batch) {
      const rows = decodeScanLogs(fetched.logs)
      await deps.store.commitWindow({
        network,
        fromBlock: fetched.from,
        toBlock: fetched.to,
        expectedCheckpoint: checkpoint,
        days: rows.days,
        fees: rows.fees,
      })
      checkpoint = fetched.to
      summary.windows++
      summary.logs += fetched.logs.length
      summary.dayRows += rows.days.length
      summary.fees += rows.fees.length
    }
  }
  return summary
}

export type ScanStatus = {
  safeHead: bigint
  lastBlock: bigint | null
  lag: bigint | null
}

export async function scanStatus(
  deps: Pick<ScanDeps, "config" | "rpc" | "store">,
  head?: bigint,
): Promise<ScanStatus> {
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

// One tick: from the scan checkpoint towards head minus confirmations, at
// most `maxBlocks` blocks. Null when already caught up.
export async function ingestScanToHead(
  deps: ScanDeps,
  maxBlocks: bigint,
  head?: bigint,
  concurrency = 1,
): Promise<ScanSummary | null> {
  const status = await scanStatus(deps, head)
  const from =
    status.lastBlock === null ? historyStart(deps) : status.lastBlock + 1n
  if (from > status.safeHead) return null
  const limit = from + maxBlocks - 1n
  const to = limit < status.safeHead ? limit : status.safeHead
  return ingestScanRange(deps, { from, to, concurrency })
}
