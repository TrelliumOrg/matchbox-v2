import {
  CONTRACTS,
  ERC20_ABI,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_ABI,
  VOTING_ESCROW_WRITE_ABI,
  VOTING_REWARD_WRITE_ABI,
} from "@matchbox/chain"
import type { Gauge } from "@matchbox/contracts/market"
import {
  type ScanActivityItem,
  type ScanLiveTransaction,
  scanLiveInputLimit,
  scanLiveLogLimit,
  scanLiveTransactionSchema,
} from "@matchbox/contracts/scan"
import {
  type ChainLock,
  type KnownReward,
  type LiveLocks,
  liveActivity,
  lockKeysOf,
  type ReceiptInput,
} from "@matchbox/indexer/receipt"
import { type Abi, type PublicClient, parseAbi, toFunctionSelector } from "viem"
import { z } from "zod"
import { ClaimableUnread, withinDeadline } from "../read-models/live-claimable"
import { lockedTuple } from "../read-models/live-wallet"
import type { ScanContext } from "./context"
import type { LiveAsk } from "./live-locks"

// Matchscan's transactions the explorer and our store do not have yet.
//
// A transaction reaches our store through the indexer's tick and the copy
// after it (every 15 minutes), and Blockscout a few seconds after it is
// mined: until then Matchscan had nothing to show (a 404, then a page with
// no decoded actions). The transaction document reads it from Mezo RPC
// instead, at most one read per hash per block: the transaction, then its
// receipt and block, then the locks its logs touch as they stood at the
// block before, and decodes the receipt with the indexer's own handlers
// (`@matchbox/indexer/receipt`), so a vote or a claim reads as it will once
// indexed. A figure that depends on a lock state the read did not get (a
// lock row's before, a poke's owner) is left out, never guessed. Nothing
// is written.
//
// Cost (live-locks.ts has the rules every Matchscan chain read follows):
// - a hash the RPC has never seen costs one request, a pending one one,
//   a mined one four (the head too), and one more when its logs touch a
//   lock (two when an earlier transaction in its block might have changed
//   one); all on the primary RPC, 1.2 s each, no retry, one deadline for
//   the route;
// - a mined transaction never changes (Mezo's blocks are final at once):
//   once its block is `settledDepth` deep, where the indexer reads, its
//   answer is kept a day at the edge and in the isolate. An answer from a
//   newer block, an unknown or pending answer, or a failure is kept for
//   one block (`liveTxSeconds`), so many viewers of one hash, or a page
//   polling it, cost one read per block;
// - each read is paid from the visitor's allowance first, then the
//   transaction budget (`scanTxBudget`, apart from the lock pages'), and
//   refused (not read) when the budget cannot be asked or no limiter is
//   bound: hashes are unbounded keys, so random ones cost one request each
//   and only up to the visitor's allowance and that budget.

/** Seconds an unknown or pending answer, or a failed read, is reused. */
export const liveTxSeconds = 3
/** Seconds a settled transaction's answer is kept at the edge. */
export const minedTxSeconds = 86_400
/**
 * Blocks behind the head a mined transaction's answer is kept a day from:
 * the indexer's own distance from the head. Mezo's blocks are final at
 * once, so this is insurance against a node that served a block the
 * network did not keep.
 */
export const settledDepth = 2

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/)
const quantity = z.string().regex(/^0x[0-9a-fA-F]+$/)
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

const rpcTransactionSchema = z.object({
  hash: hex,
  from: address,
  to: address.nullable(),
  value: quantity,
  nonce: quantity,
  gas: quantity,
  gasPrice: quantity.nullish(),
  maxFeePerGas: quantity.nullish(),
  input: hex,
  blockNumber: quantity.nullable(),
  transactionIndex: quantity.nullable(),
})

const rpcReceiptSchema = z.object({
  status: quantity.nullish(),
  blockNumber: quantity,
  transactionIndex: quantity,
  gasUsed: quantity,
  effectiveGasPrice: quantity.nullish(),
  contractAddress: address.nullish(),
  logs: z.array(
    z.object({
      logIndex: quantity,
      address,
      topics: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).max(4),
      data: hex,
    }),
  ),
})

const rpcBlockSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  timestamp: quantity,
})

const rpcLogsSchema = z.array(
  z.object({
    transactionIndex: quantity,
    logIndex: quantity,
    address,
    topics: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).max(4),
    data: hex,
  }),
)

/**
 * One transaction as the RPC has it: the document's `live`, less our rows,
 * with what the API keeps for itself and never sends.
 */
export type LiveTxRead = Omit<ScanLiveTransaction, "activity" | "read_at"> & {
  /** The newest block when a mined one was read; null when not read. */
  head: number | null
  /**
   * The locks its logs touch as the chain had them before it, for
   * decoding a lock row's before and a poke's owner; null when not read.
   */
  locks: LiveLocks | null
}

const lockKeySchema = z.object({
  escrow: address,
  tokenId: z.string().regex(/^[0-9]+$/),
})

const liveTxReadSchema = scanLiveTransactionSchema
  .omit({ activity: true, read_at: true })
  .extend({
    head: z.number().int().nonnegative().nullable(),
    locks: z
      .object({
        before: z.array(
          lockKeySchema.extend({
            owner: address.nullable(),
            amount: z.string().regex(/^[0-9]+$/),
            end: z.number().int().nonnegative(),
            isPermanent: z.boolean(),
          }),
        ),
        changed: z.array(lockKeySchema),
      })
      .nullable(),
  })

/** How a read is kept at the edge, and read back. */
export const liveTxCodec = {
  encode: (value: LiveTxRead): unknown => value,
  decode: (raw: unknown): LiveTxRead | null => {
    const parsed = liveTxReadSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  },
}

/**
 * A mined answer far enough behind the head to keep for a day. One whose
 * locks could not be read is asked for again instead: a failed
 * transaction never has them, so it is kept.
 */
export function settled(read: LiveTxRead): boolean {
  return (
    read.state === "mined" &&
    read.receipt !== null &&
    (read.locks !== null || read.receipt.status === "failed") &&
    read.head !== null &&
    read.receipt.block_number <= read.head - settledDepth
  )
}

export type LiveTxReader = (
  hash: string,
  /** Unix ms: no request starts after it. */
  deadline: number,
) => Promise<LiveTxRead>

/** Locks as the chain had them at one block. */
export type LockStatesReader = (
  locks: readonly { escrow: string; tokenId: string }[],
  blockNumber: bigint,
  /** Unix ms. */
  deadline: number,
) => Promise<ChainLock[]>

/** The escrows whose locks the store holds: the only ones read. */
const storedEscrows: ReadonlySet<string> = new Set([
  CONTRACTS.mainnet.veBTC.toLowerCase(),
  CONTRACTS.mainnet.veMEZO.toLowerCase(),
])

/**
 * Most locks one read asks the chain for (two calls each, one request):
 * past it, a lock row's before and a poke's owner are left out.
 */
export const maxLiveTxLocks = 40

/** The lock read is not started with less time left than this. */
const leastLockReadMs = 250

/**
 * The lock and earlier-logs reads give up this long before the read's own
 * deadline, so a request that never answers leaves the transaction
 * without its locks rather than losing the whole read to the caller's
 * timer, which is due at that deadline.
 */
export const lockReadMarginMs = 150

const zeroAddress = "0x0000000000000000000000000000000000000000"

/**
 * Each lock's owner and `locked()` at a block, in one request (Multicall3).
 * No owner (a revert or the zero address): the escrow had no such lock.
 */
export function createLockStatesReader(client: PublicClient): LockStatesReader {
  return async function readLockStates(locks, blockNumber, deadline) {
    const results = await withinDeadline(
      client.multicall({
        allowFailure: true,
        batchSize: 0,
        blockNumber,
        contracts: locks.flatMap((lock) => [
          {
            address: lock.escrow as `0x${string}`,
            abi: VOTING_ESCROW_ABI as Abi,
            functionName: "ownerOf",
            args: [BigInt(lock.tokenId)],
          },
          {
            address: lock.escrow as `0x${string}`,
            abi: VOTING_ESCROW_ABI as Abi,
            functionName: "locked",
            args: [BigInt(lock.tokenId)],
          },
        ]),
      }),
      deadline - Date.now(),
    )
    return locks.map((lock, index) => {
      const owner = results[index * 2]
      const none = {
        escrow: lock.escrow,
        tokenId: lock.tokenId,
        owner: null,
        amount: "0",
        end: 0,
        isPermanent: false,
      }
      if (
        owner?.status !== "success" ||
        typeof owner.result !== "string" ||
        owner.result.toLowerCase() === zeroAddress
      ) {
        return none
      }
      const locked = results[index * 2 + 1]
      const tuple =
        locked?.status === "success" ? lockedTuple(locked.result) : null
      if (tuple === null) throw new ClaimableUnread("A lock was not read")
      return {
        escrow: lock.escrow,
        tokenId: lock.tokenId,
        owner: owner.result.toLowerCase(),
        amount: tuple.amount.toString(),
        end: tuple.isPermanent ? 0 : Number(tuple.end),
        isPermanent: tuple.isPermanent,
      }
    })
  }
}

const decimal = (value: string): string => BigInt(value).toString()
const lowerHex = (value: string): string => value.toLowerCase()

/** Method names Matchscan can give a selector (what Pro and Mezo send). */
const methodNames: ReadonlyMap<string, string> = (() => {
  const extra = parseAbi([
    "function poke(uint256 _tokenId)",
    "function claim(uint256 _tokenId)",
    "function claimMany(uint256[] _tokenIds)",
    "function claimRewards(address[] _gauges)",
    "function depositFor(uint256 _tokenId, uint256 _value)",
  ])
  const abis: Abi[] = [
    VOTING_ESCROW_WRITE_ABI,
    VOTER_WRITE_ABI,
    VOTING_REWARD_WRITE_ABI,
    ERC20_ABI,
    extra,
  ]
  const names = new Map<string, string>()
  for (const abi of abis) {
    for (const item of abi) {
      if (item.type !== "function" || item.stateMutability === "view") continue
      names.set(toFunctionSelector(item), item.name)
    }
  }
  return names
})()

export function methodOf(input: string): string | null {
  if (input.length < 10) return null
  return methodNames.get(input.slice(0, 10).toLowerCase()) ?? null
}

/**
 * Reads a transaction from the given client, one step at a time: the
 * transaction (unknown or pending ends there), then its receipt and block
 * together. Every answer is checked: an RPC is not trusted to be well
 * formed.
 */
export function createLiveTxReader(
  client: PublicClient,
  lockStates: LockStatesReader = createLockStatesReader(client),
): LiveTxReader {
  async function call(
    method: string,
    params: unknown[],
    deadline: number,
  ): Promise<unknown> {
    return withinDeadline(
      client.request({ method, params } as never) as Promise<unknown>,
      deadline - Date.now(),
    )
  }
  return async function readLiveTx(hash, deadline) {
    const raw = await call("eth_getTransactionByHash", [hash], deadline)
    if (raw === null) {
      return {
        state: "unknown",
        transaction: null,
        receipt: null,
        timestamp: null,
        head: null,
        locks: null,
      }
    }
    const tx = rpcTransactionSchema.parse(raw)
    if (tx.hash.toLowerCase() !== hash) {
      throw new ClaimableUnread("The RPC answered for another transaction")
    }
    const input = lowerHex(tx.input)
    const transaction = {
      from: lowerHex(tx.from),
      to: tx.to === null ? null : lowerHex(tx.to),
      value: decimal(tx.value),
      nonce: Number(BigInt(tx.nonce)),
      gas_limit: decimal(tx.gas),
      gas_price:
        tx.gasPrice === null || tx.gasPrice === undefined
          ? tx.maxFeePerGas === null || tx.maxFeePerGas === undefined
            ? null
            : decimal(tx.maxFeePerGas)
          : decimal(tx.gasPrice),
      input:
        input.length > scanLiveInputLimit
          ? input.slice(0, scanLiveInputLimit)
          : input,
      input_truncated: input.length > scanLiveInputLimit,
      method: methodOf(input),
    }
    const pending = {
      state: "pending",
      transaction,
      receipt: null,
      timestamp: null,
      head: null,
      locks: null,
    } as const
    if (tx.blockNumber === null) return pending
    const [rawReceipt, rawBlock, rawHead] = await Promise.all([
      call("eth_getTransactionReceipt", [hash], deadline),
      call("eth_getBlockByNumber", [tx.blockNumber, false], deadline),
      // How long the answer is kept, only: unread, it is kept a block.
      call("eth_blockNumber", [], deadline).catch(() => null),
    ])
    // Mined but the receipt not served yet (a lagging node): pending.
    if (rawReceipt === null || rawBlock === null) return pending
    const receipt = rpcReceiptSchema.parse(rawReceipt)
    const block = rpcBlockSchema.parse(rawBlock)
    const logs = receipt.logs.map((log) => ({
      index: Number(BigInt(log.logIndex)),
      address: lowerHex(log.address),
      topics: log.topics.map(lowerHex),
      data: lowerHex(log.data),
    }))
    const status =
      receipt.status === undefined ||
      receipt.status === null ||
      BigInt(receipt.status) === 1n
        ? "success"
        : "failed"
    const blockNumber = BigInt(receipt.blockNumber)
    const position = Number(BigInt(receipt.transactionIndex))
    const timestamp = Number(BigInt(block.timestamp))
    const locks =
      status === "failed"
        ? null
        : await priorLocks({
            input: {
              hash,
              from: transaction.from,
              to: transaction.to,
              input,
              blockNumber,
              timestamp: BigInt(timestamp),
              position,
              logs,
            },
            blockHash: block.hash,
            deadline,
          }).catch(() => null)
    return {
      state: "mined",
      transaction,
      receipt: {
        status,
        block_number: Number(blockNumber),
        position,
        gas_used: decimal(receipt.gasUsed),
        effective_gas_price:
          receipt.effectiveGasPrice === null ||
          receipt.effectiveGasPrice === undefined
            ? null
            : decimal(receipt.effectiveGasPrice),
        created:
          receipt.contractAddress === null ||
          receipt.contractAddress === undefined
            ? null
            : lowerHex(receipt.contractAddress),
        logs: logs.slice(0, scanLiveLogLimit),
        logs_truncated: logs.length > scanLiveLogLimit,
      },
      timestamp,
      head: headOf(rawHead),
      locks,
    }
  }

  /**
   * The touched locks at the block before, and all of them as changed
   * when an earlier transaction in the block emitted any escrow log (one
   * request each, together). Null when
   * too many, or too little time is left.
   */
  async function priorLocks(read: {
    input: ReceiptInput
    blockHash: string
    deadline: number
  }): Promise<LiveLocks | null> {
    const { input } = read
    const deadline = read.deadline - lockReadMarginMs
    const keys = storedKeys(input)
    if (keys.length === 0) return { before: [], changed: [] }
    if (keys.length > maxLiveTxLocks) return null
    if (deadline - Date.now() < leastLockReadMs) return null
    const [before, changed] = await Promise.all([
      lockStates(keys, input.blockNumber - 1n, deadline),
      input.position === 0
        ? Promise.resolve([])
        : call(
            "eth_getLogs",
            [{ blockHash: read.blockHash, address: [...storedEscrows] }],
            deadline,
          ).then((raw) => {
            const earlier = rpcLogsSchema
              .parse(raw)
              .filter(
                (log) => Number(BigInt(log.transactionIndex)) < input.position,
              )
            // Any escrow log earlier in the block may have changed a
            // touched lock without naming it in an event the decoders
            // read (a deposit into a managed lock, say): none is known.
            return earlier.length > 0 ? keys : []
          }),
    ])
    return { before, changed }
  }
}

/** The locks a receipt's logs touch in the store's escrows. */
function storedKeys(
  input: ReceiptInput,
): { escrow: string; tokenId: string }[] {
  return lockKeysOf(input).filter((key) =>
    storedEscrows.has(key.escrow.toLowerCase()),
  )
}

function headOf(raw: unknown): number | null {
  const parsed = quantity.safeParse(raw)
  return parsed.success ? Number(BigInt(parsed.data)) : null
}

// -- decoding -------------------------------------------------------------

/**
 * What the decoder needs beyond the receipt: the reward contracts each
 * gauge pays through and each pool's gauge, from this epoch's market
 * snapshot (every gauge of the four voters, read every minute).
 */
export type KnownGauges = {
  rewards: KnownReward[]
  gaugeOfPool: ReadonlyMap<string, string>
}

/** No gauges: reward claims and pool votes stay undecoded. */
export const noGauges: KnownGauges = { rewards: [], gaugeOfPool: new Map() }

const voterSource = {
  boost: "BOOST_VOTER",
  pools: "POOLS_VOTER",
  validators: "VALIDATORS_VOTER",
  "third-party": "THIRD_PARTY_VOTER",
} as const

export function knownGauges(gauges: readonly Gauge[]): KnownGauges {
  const rewards: KnownReward[] = []
  const gaugeOfPool = new Map<string, string>()
  for (const gauge of gauges) {
    const voter = voterSource[gauge.voter]
    const pool = gauge.voter === "pools" ? gauge.poolAddress : null
    if (pool !== null) gaugeOfPool.set(pool, gauge.gaugeAddress)
    if (gauge.bribeContract !== null) {
      rewards.push({
        address: gauge.bribeContract,
        kind: "bribe",
        voter,
        gauge: gauge.gaugeAddress,
        pool,
      })
    }
    if (gauge.voter === "pools" && gauge.feesContract !== null) {
      rewards.push({
        address: gauge.feesContract,
        kind: "fee",
        voter,
        gauge: gauge.gaugeAddress,
        pool,
      })
    }
  }
  return { rewards, gaugeOfPool }
}

/** The receipt as the decoder takes it. */
export function receiptInput(
  hash: string,
  read: LiveTxRead,
): ReceiptInput | null {
  const { transaction, receipt, timestamp } = read
  if (transaction === null || receipt === null || timestamp === null) {
    return null
  }
  return {
    hash,
    from: transaction.from,
    to: transaction.to,
    input: transaction.input,
    blockNumber: BigInt(receipt.block_number),
    timestamp: BigInt(timestamp),
    position: receipt.position,
    logs: receipt.logs,
  }
}

/**
 * Our rows for a mined transaction: the indexer's handlers over its
 * receipt, with the reward contracts and pools the snapshot knows and the
 * touched locks as the chain had them before it, less anything that
 * depends on a lock state the read did not get (`liveActivity`). A failed
 * transaction emitted nothing.
 */
export function decodedActivity(
  receipt: ReceiptInput,
  known: KnownGauges,
  locks: LiveLocks | null,
): ScanActivityItem[] {
  return liveActivity(receipt, {
    known: known.rewards,
    gaugeOfPool: (pool) => known.gaugeOfPool.get(pool) ?? null,
    locks,
  })
}

/**
 * The document's `live` part for a transaction: read (or remembered),
 * then decoded. Null when the chain was not read: no reader, the budget
 * spent or refused, or the read failed or ran out of time.
 */
export async function liveTransaction(
  scan: ScanContext,
  ask: LiveAsk,
  hash: string,
): Promise<ScanLiveTransaction | null> {
  const read = await scan.live.transaction(hash, ask)
  if (read === null) return null
  const { head: _head, locks, ...part } = read
  const base = { ...part, read_at: scan.nowSeconds(), activity: [] }
  const receipt = receiptInput(hash, read)
  if (receipt === null || receipt.logs.length === 0) return base
  if (read.receipt?.status === "failed") return base
  // Inside the route's deadline: a slow snapshot decodes without gauges
  // (claims and pool votes undecoded) rather than the page timing out.
  const known = await withinDeadline(
    scan.knownGauges(),
    ask.deadline - scan.nowMs(),
  ).catch(() => noGauges)
  try {
    return { ...base, activity: decodedActivity(receipt, known, locks) }
  } catch (error) {
    // A handler that throws on a log the projection would also fail on:
    // the transaction shows without our rows.
    scan.deps.logger.warn({
      message: "Live transaction not decoded",
      hash,
      error,
    })
    return base
  }
}
