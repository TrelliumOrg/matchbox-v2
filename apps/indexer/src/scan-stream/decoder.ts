import {
  ACTIVE_POOL_DEBT_UPDATED_TOPIC,
  ENCLAVE_DEBT_TOPICS,
  ERC20_TRANSFER_EVENTS_ABI,
  ERC20_TRANSFER_TOPIC,
  MUSD_FEE_EVENTS_ABI,
  MUSD_FEE_SOURCES,
  SCAN_STREAM_TOKENS,
} from "@matchbox/chain"
import { createLogger } from "@matchbox/logger"
import { type Address, decodeEventLog, type Hex } from "viem"
import { eventTopics, lower } from "../decode/helpers"
import type { RawLog } from "../ingest/rpc"

// Decodes one window of scan stream logs (src/scan-stream/ingest.ts) into
// per-day token rollups and mUSD fee rows. Pure: no state carries between
// windows, because every transaction's logs sit in one block, so the
// interest of a transaction (its MUSD minted to PCV beyond its fees) is
// always decided inside one window.

/** Bump on any change to what these rows mean; the tables then replay. */
export const SCAN_DECODER_VERSION = 1

const logger = createLogger({ fields: { service: "matchbox-indexer-scan" } })

const ZERO: Address = "0x0000000000000000000000000000000000000000"
const TOKENS = new Set<Address>(SCAN_STREAM_TOKENS.map((t) => t.address))
const ENCLAVE_DEBT = new Set<Hex>(ENCLAVE_DEBT_TOPICS)

export type TokenDayDelta = {
  token: Address
  /** UTC day of the block timestamp, YYYY-MM-DD. */
  day: string
  transfers: bigint
  volume: bigint
  minted: bigint
  burned: bigint
}

export type MusdFeeType =
  | "BORROWING"
  | "REFINANCING"
  | "REDEMPTION"
  | "INTEREST"
  | "ENCLAVE"

export type MusdFeeRow = {
  txHash: Hex
  logIndex: bigint
  blockNumber: bigint
  timestamp: bigint
  contractAddress: Address
  feeType: MusdFeeType
  borrower: Address | null
  asset: "MUSD" | "BTC"
  amount: bigint
  redemptionAttempted: bigint | null
  redemptionActual: bigint | null
  redemptionCollateralSent: bigint | null
}

export type ScanWindowRows = {
  days: TokenDayDelta[]
  fees: MusdFeeRow[]
}

export function utcDay(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toISOString().slice(0, 10)
}

type PcvMints = { amount: bigint; last: RawLog }

function decodeTransfer(log: RawLog) {
  const event = decodeEventLog({
    abi: ERC20_TRANSFER_EVENTS_ABI,
    topics: eventTopics(log),
    data: log.data,
  })
  return {
    from: lower(event.args.from),
    to: lower(event.args.to),
    value: event.args.value,
  }
}

function feeRow(
  log: RawLog,
  feeType: MusdFeeType,
  fields: Pick<MusdFeeRow, "borrower" | "asset" | "amount"> &
    Partial<
      Pick<
        MusdFeeRow,
        "redemptionAttempted" | "redemptionActual" | "redemptionCollateralSent"
      >
    >,
): MusdFeeRow {
  return {
    txHash: lower(log.txHash),
    logIndex: BigInt(log.logIndex),
    blockNumber: log.blockNumber,
    timestamp: log.blockTimestamp,
    contractAddress: lower(log.address),
    feeType,
    redemptionAttempted: null,
    redemptionActual: null,
    redemptionCollateralSent: null,
    ...fields,
  }
}

/**
 * Logs must be the scan stream filters' result for one window, in (block,
 * log index) order. A log the filters should not have returned throws, so
 * a filter mistake stops the stream instead of miscounting.
 */
export function decodeScanLogs(logs: readonly RawLog[]): ScanWindowRows {
  const days = new Map<string, TokenDayDelta>()
  const fees: MusdFeeRow[] = []
  const feesByTx = new Map<Hex, bigint>()
  const mintsByTx = new Map<Hex, PcvMints>()
  // Transactions that changed trove debt, and Enclave debt transactions:
  // the two sources of MUSD minted to PCV besides fees.
  const troveTxs = new Set<Hex>()
  const enclaveTxs = new Set<Hex>()

  for (const log of logs) {
    const address = lower(log.address)
    const topic0 =
      log.topics[0] === undefined ? undefined : lower(log.topics[0])
    if (TOKENS.has(address) && topic0 === ERC20_TRANSFER_TOPIC) {
      const transfer = decodeTransfer(log)
      const day = utcDay(log.blockTimestamp)
      const key = `${address}|${day}`
      const delta = days.get(key) ?? {
        token: address,
        day,
        transfers: 0n,
        volume: 0n,
        minted: 0n,
        burned: 0n,
      }
      delta.transfers += 1n
      delta.volume += transfer.value
      if (transfer.from === ZERO) delta.minted += transfer.value
      if (transfer.to === ZERO) delta.burned += transfer.value
      days.set(key, delta)
      continue
    }
    if (address === MUSD_FEE_SOURCES.musd && topic0 === ERC20_TRANSFER_TOPIC) {
      const transfer = decodeTransfer(log)
      if (transfer.from !== ZERO || transfer.to !== MUSD_FEE_SOURCES.pcv) {
        throw new Error(
          `Scan stream got a MUSD Transfer that is not a mint to PCV: ${log.txHash}-${log.logIndex}`,
        )
      }
      const txHash = lower(log.txHash)
      const mints = mintsByTx.get(txHash)
      mintsByTx.set(txHash, {
        amount: (mints?.amount ?? 0n) + transfer.value,
        last: log,
      })
      continue
    }
    if (
      address === MUSD_FEE_SOURCES.activePool &&
      topic0 === ACTIVE_POOL_DEBT_UPDATED_TOPIC
    ) {
      troveTxs.add(lower(log.txHash))
      continue
    }
    if (
      address === MUSD_FEE_SOURCES.enclaveDebtManager &&
      topic0 !== undefined &&
      ENCLAVE_DEBT.has(topic0)
    ) {
      enclaveTxs.add(lower(log.txHash))
      continue
    }
    if (
      address === MUSD_FEE_SOURCES.borrowerOperations ||
      address === MUSD_FEE_SOURCES.troveManager
    ) {
      const event = decodeEventLog({
        abi: MUSD_FEE_EVENTS_ABI,
        topics: eventTopics(log),
        data: log.data,
      })
      if (
        event.eventName === "BorrowingFeePaid" ||
        event.eventName === "RefinancingFeePaid"
      ) {
        const txHash = lower(log.txHash)
        fees.push(
          feeRow(
            log,
            event.eventName === "BorrowingFeePaid"
              ? "BORROWING"
              : "REFINANCING",
            {
              borrower: lower(event.args._borrower),
              asset: "MUSD",
              amount: event.args._fee,
            },
          ),
        )
        feesByTx.set(txHash, (feesByTx.get(txHash) ?? 0n) + event.args._fee)
        continue
      }
      fees.push(
        feeRow(log, "REDEMPTION", {
          borrower: null,
          asset: "BTC",
          amount: event.args._collateralFee,
          redemptionAttempted: event.args._attemptedAmount,
          redemptionActual: event.args._actualAmount,
          redemptionCollateralSent: event.args._collateralSent,
        }),
      )
      continue
    }
    throw new Error(
      `Scan stream got an unexpected log ${log.txHash}-${log.logIndex} from ${address}`,
    )
  }

  for (const [txHash, mints] of mintsByTx) {
    if (!troveTxs.has(txHash)) {
      if (enclaveTxs.has(txHash)) {
        fees.push(
          feeRow(mints.last, "ENCLAVE", {
            borrower: null,
            asset: "MUSD",
            amount: mints.amount,
          }),
        )
        continue
      }
      // Neither trove nor Enclave debt moved: not a fee (the PCV bootstrap
      // loan, 100M MUSD at block 179,091, is the one seen on mainnet).
      logger.info({
        message: "MUSD minted to PCV outside trove and Enclave debt: not a fee",
        txHash,
        minted: mints.amount.toString(),
      })
      continue
    }
    const interest = mints.amount - (feesByTx.get(txHash) ?? 0n)
    if (interest > 0n) {
      fees.push(
        feeRow(mints.last, "INTEREST", {
          borrower: null,
          asset: "MUSD",
          amount: interest,
        }),
      )
    } else if (interest < 0n) {
      // Never seen on mainnet (sampled 300,000 blocks to 13,124,532): the
      // fees were minted somewhere other than PCV. The fee rows stand; no
      // interest is inferred.
      logger.warn({
        message: "MUSD minted to PCV is less than the fees in its transaction",
        txHash,
        minted: mints.amount.toString(),
        fees: (feesByTx.get(txHash) ?? 0n).toString(),
      })
    }
  }

  fees.sort((left, right) =>
    left.blockNumber === right.blockNumber
      ? Number(left.logIndex - right.logIndex)
      : left.blockNumber < right.blockNumber
        ? -1
        : 1,
  )
  return { days: [...days.values()], fees }
}
