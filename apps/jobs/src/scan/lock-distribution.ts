import {
  CONTRACTS,
  VEBTC_MAX_LOCK_SECONDS,
  VEMEZO_MAX_LOCK_SECONDS,
  VOTING_ESCROW_ABI,
} from "@matchbox/chain"
import {
  type ScanLockDistribution,
  type ScanLockEscrow,
  type ScanLockGroup,
  scanLockDistributionSchema,
} from "@matchbox/contracts/scan"
import type { Logger } from "@matchbox/logger"
import type { PublicClient } from "viem"
import {
  cursorStatement,
  type JsonRow,
  runBatch,
  type SqlStatement,
  servedBatch,
  type UpsertSpec,
  upsertStatements,
} from "./statements"

// The escrows' lock distribution, read from the chain once a day (README
// "Governance summaries"). Every token id from 1 to the escrow's
// `tokenId()` is read with `locked()` at one block, and the live ones'
// `votingPowerOfNFT()`: the chain's amounts, ends and permanence, not the
// warehouse's lock rows (which start at block 7.74M and miss splits, so
// they undercount veBTC). The sum of the amounts read is checked against
// the escrow's `supply()` at the same block; a mismatch fails the read.

export const lockEscrows: readonly ScanLockEscrow[] = ["vebtc", "vemezo"]

const escrowAddress: Record<ScanLockEscrow, `0x${string}`> = {
  vebtc: CONTRACTS.mainnet.veBTC,
  vemezo: CONTRACTS.mainnet.veMEZO,
}

export const maxLockSeconds: Record<ScanLockEscrow, number> = {
  vebtc: VEBTC_MAX_LOCK_SECONDS,
  vemezo: VEMEZO_MAX_LOCK_SECONDS,
}

const unit = 10n ** 18n
const week = 7 * 86_400

/**
 * Size buckets' lower edges after 0, in base units: veBTC at 0.01, 0.1, 1
 * and 10 BTC; veMEZO at 1k, 10k, 100k and 1M MEZO.
 */
export const sizeEdges: Record<ScanLockEscrow, readonly bigint[]> = {
  vebtc: [unit / 100n, unit / 10n, unit, 10n * unit],
  vemezo: [1_000n * unit, 10_000n * unit, 100_000n * unit, 1_000_000n * unit],
}

/**
 * Time-left buckets' upper edges: a week each for veBTC (28 days at most),
 * a year (52 weeks) each for veMEZO (208 weeks).
 */
export const timeEdges: Record<ScanLockEscrow, readonly number[]> = {
  vebtc: [week, 2 * week, 3 * week, 4 * week],
  vemezo: [52 * week, 104 * week, 156 * week, 208 * week],
}

/** One live lock as `locked()` and `votingPowerOfNFT()` answered. */
export type ChainLock = {
  id: number
  amount: bigint
  end: number
  permanent: boolean
  votingPower: bigint
}

export type EscrowRead = {
  block: number
  /** The block's unix time. */
  time: number
  /** The escrow's `tokenId()`: ids 1 to it were read. */
  ids: number
  supply: bigint
  /** Locks holding an amount. */
  locks: ChainLock[]
}

export type LockChainReader = {
  /** Every lock of one escrow at `block` (the head when omitted). */
  readEscrow(escrow: ScanLockEscrow, block?: number): Promise<EscrowRead>
  /** The newest block and its unix time. */
  head(): Promise<{ block: number; time: number }>
}

/** Calls per multicall: about 3.5M gas of `locked()` reads. */
export const lockReadChunk = 500

/**
 * Reads in sequential multicalls of `chunk` calls (never viem's parallel
 * split, which would send dozens at once), each failing the read whole.
 */
export function createLockChainReader(
  client: PublicClient,
  chunk = lockReadChunk,
): LockChainReader {
  async function calls<Result>(
    block: bigint,
    contracts: readonly {
      address: `0x${string}`
      functionName: "locked" | "votingPowerOfNFT"
      args: readonly [bigint]
    }[],
  ): Promise<Result[]> {
    const results: Result[] = []
    for (let start = 0; start < contracts.length; start += chunk) {
      const part = contracts.slice(start, start + chunk)
      const answers = await client.multicall({
        allowFailure: false,
        batchSize: 0,
        blockNumber: block,
        contracts: part.map((call) => ({
          address: call.address,
          abi: VOTING_ESCROW_ABI,
          functionName: call.functionName,
          args: call.args,
        })),
      })
      results.push(...(answers as Result[]))
    }
    return results
  }
  return {
    async head() {
      const block = await client.getBlock({ blockTag: "latest" })
      return { block: Number(block.number), time: Number(block.timestamp) }
    },
    async readEscrow(escrow, at) {
      const blockNumber =
        at === undefined ? await client.getBlockNumber() : BigInt(at)
      const address = escrowAddress[escrow]
      const [block, header] = await Promise.all([
        client.getBlock({ blockNumber }),
        client.multicall({
          allowFailure: false,
          blockNumber,
          contracts: [
            { address, abi: VOTING_ESCROW_ABI, functionName: "tokenId" },
            { address, abi: VOTING_ESCROW_ABI, functionName: "supply" },
          ] as const,
        }),
      ])
      const [newest, supply] = header
      const ids = Number(newest)
      const tokenIds = Array.from({ length: ids }, (_, index) =>
        BigInt(index + 1),
      )
      const locked = await calls<{
        amount: bigint
        end: bigint
        isPermanent: boolean
      }>(
        blockNumber,
        tokenIds.map((id) => ({
          address,
          functionName: "locked" as const,
          args: [id] as const,
        })),
      )
      const live = locked.flatMap((lock, index) =>
        lock.amount > 0n ? [{ id: index + 1, lock }] : [],
      )
      const power = await calls<bigint>(
        blockNumber,
        live.map((entry) => ({
          address,
          functionName: "votingPowerOfNFT" as const,
          args: [BigInt(entry.id)] as const,
        })),
      )
      return {
        block: Number(blockNumber),
        time: Number(block.timestamp),
        ids,
        supply,
        locks: live.map((entry, index) => ({
          id: entry.id,
          amount: entry.lock.amount,
          end: Number(entry.lock.end),
          permanent: entry.lock.isPermanent,
          votingPower: power[index] ?? 0n,
        })),
      }
    },
  }
}

type Group = { count: number; amount: bigint; votingPower: bigint }

function emptyGroup(): Group {
  return { count: 0, amount: 0n, votingPower: 0n }
}

function addLock(group: Group, lock: ChainLock): void {
  group.count += 1
  group.amount += lock.amount
  group.votingPower += lock.votingPower
}

function groupOut(group: Group): ScanLockGroup {
  return {
    count: group.count,
    amount: group.amount.toString(),
    voting_power: group.votingPower.toString(),
  }
}

export class SupplyMismatch extends Error {}

/**
 * The day's document from one escrow read. Pure. Throws when the amounts
 * read do not add up to the escrow's `supply()`: a lock was missed.
 */
export function lockDistribution(
  escrow: ScanLockEscrow,
  read: EscrowRead,
  day: string,
): ScanLockDistribution {
  const total = read.locks.reduce((sum, lock) => sum + lock.amount, 0n)
  if (total !== read.supply) {
    throw new SupplyMismatch(
      `${escrow}: locks add up to ${total}, supply() is ${read.supply}`,
    )
  }
  const live = emptyGroup()
  const permanent = emptyGroup()
  const timed = emptyGroup()
  const expired = emptyGroup()
  const edges = sizeEdges[escrow]
  const sizes = Array.from({ length: edges.length + 1 }, emptyGroup)
  const times = timeEdges[escrow]
  const remaining = times.map(emptyGroup)
  const unlocks = new Map<number, { count: number; amount: bigint }>()
  let weightedSeconds = 0n
  for (const lock of read.locks) {
    addLock(live, lock)
    let size = edges.findIndex((edge) => lock.amount < edge)
    if (size === -1) size = edges.length
    const bucket = sizes[size]
    if (bucket !== undefined) addLock(bucket, lock)
    if (lock.permanent) {
      addLock(permanent, lock)
      continue
    }
    if (lock.end <= read.time) {
      addLock(expired, lock)
      continue
    }
    addLock(timed, lock)
    const left = lock.end - read.time
    weightedSeconds += lock.amount * BigInt(left)
    let slot = times.findIndex((edge) => left <= edge)
    if (slot === -1) slot = times.length - 1
    const timeBucket = remaining[slot]
    if (timeBucket !== undefined) addLock(timeBucket, lock)
    const at = unlocks.get(lock.end) ?? { count: 0, amount: 0n }
    at.count += 1
    at.amount += lock.amount
    unlocks.set(lock.end, at)
  }
  const amounts = read.locks
    .map((lock) => lock.amount)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const middle = amounts.length === 0 ? null : (amounts.length - 1) / 2
  const median =
    middle === null
      ? null
      : Number.isInteger(middle)
        ? (amounts[middle] ?? null)
        : ((amounts[Math.floor(middle)] ?? 0n) +
            (amounts[Math.ceil(middle)] ?? 0n)) /
          2n
  return scanLockDistributionSchema.parse({
    escrow,
    day,
    block: read.block,
    read_at: read.time,
    max_lock_seconds: maxLockSeconds[escrow],
    ids_read: read.ids,
    supply: read.supply.toString(),
    live: groupOut(live),
    permanent: groupOut(permanent),
    timed: groupOut(timed),
    expired: groupOut(expired),
    largest: amounts.at(-1)?.toString() ?? null,
    median: median?.toString() ?? null,
    mean_remaining_seconds:
      timed.amount === 0n ? null : Number(weightedSeconds / timed.amount),
    by_size: sizes.map((group, index) => ({
      ...groupOut(group),
      min: (index === 0 ? 0n : (edges[index - 1] ?? 0n)).toString(),
      max: edges[index]?.toString() ?? null,
    })),
    by_remaining: remaining.map((group, index) => ({
      ...groupOut(group),
      min_seconds: index === 0 ? 0 : (times[index - 1] ?? 0),
      max_seconds: times[index] ?? 0,
    })),
    unlocks: [...unlocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([at, entry]) => ({
        at,
        count: entry.count,
        amount: entry.amount.toString(),
      })),
  })
}

export const lockDistributionSpec: UpsertSpec = {
  table: "lock_distribution",
  columns: ["escrow", "day", "block", "data", "source", "updated_at"],
  key: ["escrow", "day"],
  update: ["block", "data", "source", "updated_at"],
  // A backfilled day never replaces the daily read's.
  guard:
    "NOT (excluded.source LIKE 'backfill:%' AND lock_distribution.source NOT LIKE 'backfill:%')",
}

/** The row a document is stored as. */
export function lockDistributionRow(
  doc: ScanLockDistribution,
  source: string,
  nowSeconds: number,
): JsonRow {
  return {
    escrow: doc.escrow,
    day: doc.day,
    block: doc.block,
    data: JSON.stringify(doc),
    source,
    updated_at: nowSeconds,
  }
}

export function lockDistributionStatements(
  rows: readonly JsonRow[],
): SqlStatement[] {
  return upsertStatements(lockDistributionSpec, rows)
}

const marker = "daily:locks"
/** `<unix time>:<failures in a row>` of the last failed read. */
const attemptMarker = "daily:locks:attempt"
/** A failed read is retried after this long, doubling with each failure. */
export const lockRetrySeconds = 30 * 60
/** The longest wait between retries: at most about 8 reads a day. */
export const lockRetryMaxSeconds = 6 * 3_600
/** A head older than this is a halted chain or a lagging node: no read. */
export const lockHeadMaxAgeSeconds = 3_600

function parseAttempt(value: string | undefined): {
  at: number
  failures: number
} {
  const [at, failures] = (value ?? "").split(":")
  return {
    at: Number.parseInt(at ?? "0", 10) || 0,
    failures: Math.max(1, Number.parseInt(failures ?? "1", 10) || 1),
  }
}

/** The wait after `failures` failed reads in a row. */
export function lockRetryAfter(failures: number): number {
  return Math.min(
    lockRetryMaxSeconds,
    lockRetrySeconds * 2 ** Math.max(0, Math.min(failures, 16) - 1),
  )
}

function dayOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

export type LockDistributionResult =
  | { status: "done"; day: string; rowsWritten: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string }

/**
 * Once a UTC day, on the first live run whose head block is from that day
 * and under an hour old: both escrows at that block, two rows and the
 * marker (today) in one served batch. A run before the chain passes
 * midnight, or while it is halted, costs one head read and writes nothing.
 * A failed read (an RPC error, a supply mismatch) writes nothing but the
 * attempt; retries wait 30 minutes, doubling to at most 6 hours, until a
 * read succeeds.
 */
export async function runLockDistribution(deps: {
  db: D1Database
  reader: LockChainReader
  nowSeconds: number
  logger: Logger
}): Promise<LockDistributionResult> {
  const { db, nowSeconds, logger } = deps
  const today = dayOf(nowSeconds)
  let markers: Map<string, string>
  try {
    const result = await db
      .prepare("SELECT name, value FROM scan_cursors WHERE name IN (?1, ?2)")
      .bind(marker, attemptMarker)
      .all<{ name: string; value: string }>()
    markers = new Map(result.results.map((row) => [row.name, row.value]))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { status: "failed", reason }
  }
  if ((markers.get(marker) ?? "") >= today) {
    return { status: "skipped", reason: "Read today" }
  }
  const attempt = markers.has(attemptMarker)
    ? parseAttempt(markers.get(attemptMarker))
    : null
  if (
    attempt !== null &&
    nowSeconds - attempt.at < lockRetryAfter(attempt.failures)
  ) {
    return { status: "skipped", reason: "Retrying later" }
  }
  const failures = (attempt?.failures ?? 0) + 1
  try {
    const head = await deps.reader.head()
    if (nowSeconds - head.time > lockHeadMaxAgeSeconds) {
      return { status: "skipped", reason: "Chain head over an hour old" }
    }
    if (dayOf(head.time) !== today) {
      return { status: "skipped", reason: "Chain not past midnight yet" }
    }
    const docs: ScanLockDistribution[] = []
    for (const escrow of lockEscrows) {
      const read = await deps.reader.readEscrow(escrow, head.block)
      docs.push(lockDistribution(escrow, read, today))
    }
    const day = today
    const rowsWritten = await runBatch(
      db,
      servedBatch(
        lockDistributionStatements(
          docs.map((doc) => lockDistributionRow(doc, "live", nowSeconds)),
        ),
        [
          cursorStatement(marker, day, nowSeconds),
          {
            sql: "DELETE FROM scan_cursors WHERE name = ?1",
            params: [attemptMarker],
          },
        ],
      ),
    )
    logger.info({
      message: "Lock distribution written",
      day,
      block: head.block,
      locks: docs.map((doc) => `${doc.escrow} ${doc.live.count}`).join(", "),
    })
    return { status: "done", day, rowsWritten }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const fields = {
      message: /no such table/i.test(reason)
        ? "LOCK DISTRIBUTION TABLE MISSING; apply scan-migrations 0007"
        : "Lock distribution failed; retrying later",
      reason,
      failures,
      retryInSeconds: lockRetryAfter(failures),
    }
    // A read that keeps failing (a supply mismatch does every time) is an
    // error after the third, not a warning.
    if (failures >= 3) logger.error(fields)
    else logger.warn(fields)
    await runBatch(db, [
      cursorStatement(attemptMarker, `${nowSeconds}:${failures}`, nowSeconds),
    ]).catch(() => 0)
    return { status: "failed", reason }
  }
}
