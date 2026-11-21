import { CONTRACTS } from "@matchbox/chain"
import { epochStartOf } from "@matchbox/domain"
import {
  type Address,
  DecodeLogDataMismatch,
  DecodeLogTopicsMismatch,
} from "viem"
import type { Network } from "../ingest/networks"
import type { RawLog, RawTx } from "../ingest/rpc"
import { ACTION, WEEK } from "./constants"
import { lockKeysForLog, resolveHandler } from "./dispatch"
import { lockId, lower } from "./helpers"
import type {
  ActivityEventRow,
  BribeToPoolRow,
  BribeVoterSource,
  DynamicDataSource,
  LockPositionRow,
} from "./rows"
import { InMemoryStore, WarehouseOnlyStore } from "./store"
import { DECODER_VERSION } from "./version"

// One transaction's activity rows, decoded from its receipt with the
// projection's own handlers (dispatch.ts), so a transaction read live from
// the chain reads as it will once indexed. Used by the API for Matchscan's
// transactions the copy has not reached yet. Pure: no network, no Postgres.
//
// What the projection knows and a receipt does not comes in as `known`:
// the reward contracts the voters created (templates), with the gauge and
// pool each pays for, and the locks the receipt touches (owner, amount,
// unlock), which a lock row's before and after and a poke's actor are read
// from. A log from any other contract the projection learnt about by
// discovery is not decoded.
//
// `liveActivity` is what a live read shows: the locks as the chain had
// them just before the transaction when that was read, and otherwise
// every field that depends on a lock's prior state left out, never a
// figure made from a guess.

/** A reward contract a voter created, and the gauge it pays for. */
export type KnownReward = {
  address: string
  kind: "bribe" | "fee"
  /** The voter that created it (`incentive_deposits.voter_source`). */
  voter: string
  gauge: string
  pool: string | null
}

/** A lock as last stored (matchbox-scan `locks`). */
export type KnownLock = {
  escrow: string
  tokenId: string
  owner: string | null
  amount: string
  /** Unix seconds; 0 for a permanent lock. */
  unlockAt: number | null
  isPermanent: boolean
  isWithdrawn: boolean
  isMerged: boolean
  createdAt: number | null
  activityCount: number
}

export type ReceiptInput = {
  network?: Network
  hash: string
  from: string
  to: string | null
  input: string
  blockNumber: bigint
  /** Unix seconds. */
  timestamp: bigint
  position: number
  logs: readonly {
    index: number
    address: string
    topics: readonly string[]
    data: string
  }[]
}

const bribeVoters: ReadonlySet<string> = new Set<BribeVoterSource>([
  "BOOST_VOTER",
  "THIRD_PARTY_VOTER",
  "VALIDATORS_VOTER",
])

function lockRow(lock: KnownLock): LockPositionRow {
  const escrow = lower(lock.escrow as Address)
  const tokenId = BigInt(lock.tokenId)
  return {
    id: lockId(escrow, tokenId),
    tokenId,
    contractAddress: escrow,
    owner: lock.owner === null ? null : lower(lock.owner as Address),
    amount: BigInt(lock.amount),
    unlockAt: lock.unlockAt === null ? null : BigInt(lock.unlockAt),
    createdAt: lock.createdAt === null ? null : BigInt(lock.createdAt),
    lastExtendedAt: null,
    withdrawnAt: null,
    isPermanent: lock.isPermanent,
    isWithdrawn: lock.isWithdrawn,
    isMerged: lock.isMerged,
    mergedIntoTokenId: null,
    mergedAt: null,
    boost: null,
    activityCount: BigInt(lock.activityCount),
  }
}

function storeWith(
  network: Network,
  known: readonly KnownReward[],
  locks: readonly KnownLock[],
): InMemoryStore {
  const store = new InMemoryStore(DECODER_VERSION)
  for (const lock of locks) store.putLock(lockRow(lock))
  for (const reward of known) {
    const address = lower(reward.address as Address)
    const gauge = lower(reward.gauge as Address)
    // Any live log is long after the contract's creation.
    const base = { network, address, createdBlock: 0n }
    let source: DynamicDataSource
    if (bribeVoters.has(reward.voter)) {
      if (reward.kind !== "bribe") continue
      source = {
        ...base,
        template: "VoterBribeReward",
        voterSource: reward.voter as BribeVoterSource,
        gauge,
      }
    } else {
      source = {
        ...base,
        template:
          reward.kind === "bribe" ? "BribeVotingReward" : "FeeVotingReward",
      }
      if (reward.pool !== null) {
        const mapping: BribeToPoolRow = {
          id: address,
          poolAddress: lower(reward.pool as Address),
          gaugeAddress: gauge,
        }
        store.putRewardMapping(mapping)
      }
    }
    store.putDataSource(source)
  }
  return store
}

/**
 * The activity rows the projection writes for this transaction, in log
 * order. A log no handler covers, or one that does not decode against its
 * handler's event, is skipped (as the projection skips it).
 */
export function decodeReceipt(
  receipt: ReceiptInput,
  known: readonly KnownReward[] = [],
  locks: readonly KnownLock[] = [],
): ActivityEventRow[] {
  return [...decoded(receipt, known, locks).activities.values()]
}

/** The handlers' store after the receipt: its rows and its locks. */
function decoded(
  receipt: ReceiptInput,
  known: readonly KnownReward[],
  locks: readonly KnownLock[],
): InMemoryStore {
  const network = receipt.network ?? "mezo"
  const store = storeWith(network, known, locks)
  const warehouseOnly = new WarehouseOnlyStore(store)
  const tx = rawTx(receipt, network)
  for (const log of rawLogs(receipt, network)) {
    const resolved = resolveHandler(log, store)
    if (resolved === undefined) continue
    try {
      resolved.handler(log, tx, resolved.explorerParity ? store : warehouseOnly)
    } catch (error) {
      if (
        error instanceof DecodeLogTopicsMismatch ||
        error instanceof DecodeLogDataMismatch
      ) {
        continue
      }
      throw error
    }
  }
  return store
}

/**
 * The locks a receipt's handlers read (escrow and token id), so a caller
 * can pass their stored rows to `decodeReceipt`.
 */
export function lockKeysOf(
  receipt: ReceiptInput,
): { escrow: string; tokenId: string }[] {
  const keys = new Set<string>()
  for (const log of rawLogs(receipt, receipt.network ?? "mezo")) {
    for (const key of lockKeysForLog(log)) keys.add(key)
  }
  return [...keys].map((key) => {
    const [escrow = "", tokenId = "0"] = key.split("-")
    return { escrow, tokenId }
  })
}

function rawTx(receipt: ReceiptInput, network: Network): RawTx {
  return {
    network,
    hash: lower(receipt.hash as Address),
    blockNumber: receipt.blockNumber,
    txIndex: receipt.position,
    from: lower(receipt.from as Address),
    to: receipt.to === null ? null : lower(receipt.to as Address),
    input: receipt.input.toLowerCase() as RawTx["input"],
  }
}

function rawLogs(receipt: ReceiptInput, network: Network): RawLog[] {
  return [...receipt.logs]
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({
      network,
      blockNumber: receipt.blockNumber,
      blockHash: "0x",
      blockTimestamp: receipt.timestamp,
      txHash: lower(receipt.hash as Address),
      txIndex: receipt.position,
      logIndex: entry.index,
      address: lower(entry.address as Address),
      topics: entry.topics.map((topic) =>
        topic.toLowerCase(),
      ) as RawLog["topics"],
      data: entry.data.toLowerCase() as RawLog["data"],
    }))
}

// -- read live ------------------------------------------------------------------

/** A lock as the chain had it at one block (`ownerOf` and `locked`). */
export type ChainLock = {
  escrow: string
  tokenId: string
  /** Lower case; null when the escrow had no such lock (never minted, or burned). */
  owner: string | null
  /** The `locked()` amount, base units. */
  amount: string
  /** The `locked()` end, unix seconds; 0 for a permanent lock. */
  end: number
  isPermanent: boolean
}

/** The touched locks as a live read found them on the chain. */
export type LiveLocks = {
  /** At the block before the transaction's. */
  before: readonly ChainLock[]
  /**
   * Locks an escrow log of an earlier transaction in the same block names
   * (`lockKeysOf` over those logs): their state at the block before is
   * not this transaction's. Empty when it was the block's first.
   */
  changed: readonly { escrow: string; tokenId: string }[]
}

/** The escrows whose locks the store holds (mainnet's). */
const storedEscrows: ReadonlySet<string> = new Set([
  CONTRACTS.mainnet.veBTC.toLowerCase(),
  CONTRACTS.mainnet.veMEZO.toLowerCase(),
])

const lockKey = (escrow: string, tokenId: string): string =>
  `${escrow.toLowerCase()}-${tokenId}`

function chainKnownLock(lock: ChainLock): KnownLock | null {
  if (lock.owner === null) return null
  return {
    escrow: lock.escrow,
    tokenId: lock.tokenId,
    owner: lock.owner,
    amount: lock.amount,
    unlockAt: lock.isPermanent ? 0 : lock.end,
    isPermanent: lock.isPermanent,
    isWithdrawn: false,
    isMerged: false,
    createdAt: null,
    activityCount: 0,
  }
}

/**
 * Two made-up prior states for a lock whose state is not known, apart in
 * every way a handler reads (owner, amount, unlock, permanent): a field
 * that comes out the same under both, and without the lock, does not
 * depend on it.
 */
function guesses(
  keys: readonly { escrow: string; tokenId: string }[],
  timestamp: bigint,
): [KnownLock[], KnownLock[]] {
  const guess = (
    key: { escrow: string; tokenId: string },
    owner: string,
    amount: string,
    unlockAt: number,
  ): KnownLock => ({
    escrow: key.escrow,
    tokenId: key.tokenId,
    owner,
    amount,
    unlockAt,
    isPermanent: unlockAt === 0,
    isWithdrawn: false,
    isMerged: false,
    createdAt: null,
    activityCount: 0,
  })
  const later = Number(timestamp + 3n * WEEK) + 17
  return [
    keys.map((key) =>
      guess(key, `0x${"5e".repeat(20)}`, "1000000000000000000000007", later),
    ),
    keys.map((key) =>
      guess(key, `0x${"5f".repeat(20)}`, "3000000000000000000000011", 0),
    ),
  ]
}

const optionalFields = [
  "tx_from",
  "actor",
  "recipient",
  "lock_escrow",
  "token_id",
  "amount",
  "token",
  "gauge",
  "pool",
  "reward_contract",
  "weight",
] as const satisfies readonly (keyof CopiedActivity)[]

const requiredFields = [
  "tx_hash",
  "log_index",
  "block_number",
  "timestamp",
  "epoch_start",
  "action_type",
  "source",
  "contract_address",
] as const satisfies readonly (keyof CopiedActivity)[]

/** A row with every field the other decodes disagree on left out. */
function agreed(
  row: CopiedActivity,
  others: readonly CopiedActivity[],
): CopiedActivity | null {
  for (const field of requiredFields) {
    if (others.some((other) => other[field] !== row[field])) return null
  }
  const kept: CopiedActivity = { ...row, extra: {} }
  for (const field of optionalFields) {
    if (others.some((other) => other[field] !== row[field])) kept[field] = null
  }
  for (const [key, value] of Object.entries(row.extra)) {
    if (others.every((other) => other.extra[key] === value)) {
      kept.extra[key] = value
    }
  }
  return kept
}

/**
 * The rows a live read can stand behind, as the copy will write them.
 *
 * With `locks` read, the handlers run over the chain's state at the block
 * before, which is the projection's when no earlier transaction in the
 * block changed the lock, and the rows are the projection's. Any lock
 * whose prior state is not known (not read, past the read's cut, or
 * changed earlier in the block) is decoded three ways, absent and two
 * made-up states,
 * and every field the three disagree on is left out: a lock row's before
 * and after, a poke's actor (null, never the sender). A lock minted by the
 * transaction itself has no prior state to know.
 */
export function liveActivity(
  receipt: ReceiptInput,
  options: {
    known: readonly KnownReward[]
    gaugeOfPool: (pool: string) => string | null
    locks: LiveLocks | null
  },
): CopiedActivity[] {
  const { known, gaugeOfPool } = options
  const copy = (locks: readonly KnownLock[]): CopiedActivity[] =>
    decodeReceipt(receipt, known, locks).map((row) =>
      copiedActivity(row, gaugeOfPool),
    )
  const minted = new Set(
    copy([])
      .filter((row) => row.action_type === ACTION.LOCK_CREATED)
      .flatMap((row) =>
        row.token_id === null
          ? []
          : [lockKey(row.contract_address, row.token_id)],
      ),
  )
  // Only the store's escrows can hold a lock the handlers would find.
  const touched = new Map<string, { escrow: string; tokenId: string }>()
  for (const key of lockKeysOf(receipt)) {
    const id = lockKey(key.escrow, key.tokenId)
    if (storedEscrows.has(key.escrow.toLowerCase()) && !minted.has(id)) {
      touched.set(id, key)
    }
  }
  const fixed = priorLocks(touched, options.locks)
  const unsure = [...touched.entries()]
    .filter(
      ([id]) =>
        !fixed.some((lock) => lockKey(lock.escrow, lock.tokenId) === id),
    )
    .map(([, key]) => key)
  const rows = copy(fixed)
  if (unsure.length === 0) return rows
  const [one, two] = guesses(unsure, receipt.timestamp)
  const others = [copy([...fixed, ...one]), copy([...fixed, ...two])].map(
    (each) => new Map(each.map((row) => [row.id, row])),
  )
  return rows.flatMap((row) => {
    const same = others.map((each) => each.get(row.id))
    if (same.some((other) => other === undefined)) return []
    const kept = agreed(
      row,
      same.filter((other) => other !== undefined),
    )
    return kept === null ? [] : [kept]
  })
}

/**
 * The touched locks the chain read says existed before the transaction,
 * as the handlers take them: none when nothing was read, and none of a
 * lock an earlier transaction in the block changed.
 */
function priorLocks(
  touched: ReadonlyMap<string, { escrow: string; tokenId: string }>,
  locks: LiveLocks | null,
): KnownLock[] {
  if (locks === null) return []
  const before = new Map(
    locks.before.map((lock) => [lockKey(lock.escrow, lock.tokenId), lock]),
  )
  const changed = new Set(
    locks.changed.map((lock) => lockKey(lock.escrow, lock.tokenId)),
  )
  return [...touched.keys()].flatMap((id) => {
    const lock = before.get(id)
    const known =
      lock === undefined || changed.has(id) ? null : chainKnownLock(lock)
    return known === null ? [] : [known]
  })
}

// -- as the copy writes it ---------------------------------------------------

/** A row as matchbox-scan `activity` holds it (apps/jobs/src/scan). */
export type CopiedActivity = {
  id: string
  tx_hash: string
  log_index: number
  block_number: number
  timestamp: number
  epoch_start: number
  action_type: string
  source: string
  contract_address: string
  tx_from: string | null
  actor: string | null
  recipient: string | null
  lock_escrow: string | null
  token_id: string | null
  amount: string | null
  token: string | null
  gauge: string | null
  pool: string | null
  reward_contract: string | null
  weight: string | null
  extra: Record<string, string | boolean>
}

const vebtc = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const vemezo = "0xb90fdad3dfd180458d62cc6acedc983d78e20122"

/** apps/jobs/src/scan/transform.ts `lockEscrowOf`, which the copy applies. */
const escrowBySource: Readonly<Record<string, string>> = {
  POOLS_VOTER: vebtc,
  VALIDATORS_VOTER: vebtc,
  BRIBE_VOTING_REWARD: vebtc,
  FEE_VOTING_REWARD: vebtc,
  BOOST_VOTER: vemezo,
  THIRD_PARTY_VOTER: vemezo,
  MEZO_REBASE_DISTRIBUTOR: vemezo,
}

/**
 * The extra fields the copy keeps (apps/jobs/src/scan/neon.ts
 * `activityExtra`): every one that is not null, numbers as decimal text.
 */
const extraFields: ReadonlyArray<readonly [keyof ActivityEventRow, string]> = [
  ["boostContext", "boost_context"],
  ["duration", "duration"],
  ["prevAmount", "prev_amount"],
  ["prevDuration", "prev_duration"],
  ["prevIsPermanent", "prev_is_permanent"],
  ["postAmount", "post_amount"],
  ["postDuration", "post_duration"],
  ["postIsPermanent", "post_is_permanent"],
  ["mergeSourceTokenId", "merge_source_token_id"],
  ["mergeDestTokenId", "merge_dest_token_id"],
  ["mergeDestPrevAmount", "merge_dest_prev_amount"],
  ["mergeDestPrevDuration", "merge_dest_prev_duration"],
  ["mergeDestPrevIsPermanent", "merge_dest_prev_is_permanent"],
  ["rewardType", "reward_type"],
  ["metadata", "metadata"],
  ["boostableTokenId", "boostable_token_id"],
  ["boost", "boost"],
  ["totalWeight", "total_weight"],
  ["pokeMethod", "poke_method"],
  ["period", "period"],
  ["newPeriod", "new_period"],
  ["firstRecipientAmount", "first_recipient_amount"],
  ["secondRecipientAmount", "second_recipient_amount"],
  ["oldRate", "old_rate"],
  ["newRate", "new_rate"],
  ["emission", "emission"],
  ["rebase", "rebase"],
  ["rewards", "rewards"],
  ["totalSupply", "total_supply"],
  ["epochIndex", "epoch_index"],
  ["epochStart", "epoch_start"],
  ["epochEnd", "epoch_end"],
  ["distributionId", "distribution_id"],
  ["merkleRoot", "merkle_root"],
]

const text = (value: bigint | null): string | null =>
  value === null ? null : value.toString()

/**
 * A decoded row as the copy writes it. `gaugeOfPool` maps a pool to its
 * gauge, as the copy's join on matchbox.contracts does: PoolsVoter names
 * the pool it voted for in `gauge`.
 */
export function copiedActivity(
  row: ActivityEventRow,
  gaugeOfPool: (pool: string) => string | null = () => null,
): CopiedActivity {
  const extra: Record<string, string | boolean> = {}
  for (const [field, key] of extraFields) {
    const value = row[field]
    if (value === null || value === undefined) continue
    extra[key] =
      typeof value === "boolean" || typeof value === "string"
        ? value
        : String(value)
  }
  const rawGauge = row.gauge === null ? null : row.gauge.toLowerCase()
  const mapped = rawGauge === null ? null : gaugeOfPool(rawGauge)
  const timestamp = Number(row.timestamp)
  const tokenId = text(row.tokenId)
  const contract = row.contractAddress.toLowerCase()
  return {
    id: row.id,
    tx_hash: row.txHash.toLowerCase(),
    log_index: Number(row.logIndex),
    block_number: Number(row.blockNumber),
    timestamp,
    epoch_start: epochStartOf(timestamp),
    action_type: row.actionType,
    source: row.source,
    contract_address: contract,
    tx_from: row.txFrom?.toLowerCase() ?? null,
    actor: row.actor?.toLowerCase() ?? null,
    recipient: row.recipient?.toLowerCase() ?? null,
    lock_escrow:
      tokenId === null
        ? null
        : row.source === "VOTING_ESCROW"
          ? contract
          : (escrowBySource[row.source] ?? null),
    token_id: tokenId,
    amount: text(row.amount),
    token: row.token?.toLowerCase() ?? null,
    gauge: mapped ?? rawGauge,
    pool: row.pool?.toLowerCase() ?? (mapped === null ? null : rawGauge),
    reward_contract: row.rewardContract?.toLowerCase() ?? null,
    weight: text(row.weight),
    extra,
  }
}
