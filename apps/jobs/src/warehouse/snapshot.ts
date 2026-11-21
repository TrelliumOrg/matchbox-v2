import {
  type ClaimPrices,
  historyCaughtUp,
  historyTokens,
  readClaimPrices,
} from "@matchbox/api/read-models/claim-prices"
import { readPricesFromKv } from "@matchbox/api/read-models/prices-kv"
import { gaugeCardsFrom } from "@matchbox/api/read-models/wallet-extras"
import { historyBackfillCursor } from "@matchbox/api/read-models/wallet-history"
import {
  currentKey,
  type ReadModelData,
  type ReadModelKind,
  type ReadModelWrite,
  readReadModel,
  writeReadModels,
} from "@matchbox/api/read-store"
import {
  type ActivityRow,
  type Escrow,
  type ProtocolStats,
  type WalletActivity,
  type WalletRewards,
  walletRewardsSchema,
} from "@matchbox/contracts/read-models"
import {
  EPOCH_SECONDS,
  EPOCH_ZERO_START,
  epochIndexFor,
  epochStartOf,
} from "@matchbox/domain"
import type { Logger } from "@matchbox/logger"
import {
  finishRun,
  type RunTrigger,
  readCursor,
  secondsSinceLastOk,
  startRun,
  writeCursor,
} from "../cursors"
import { readEscrowSupply } from "../live/snapshot"
import {
  activityRows,
  type BuildContext,
  buildProtocol,
  buildProtocolActivity,
  buildProtocolHistory,
  buildWalletDocuments,
  escrowForContract,
  gaugeRefsFrom,
  vebtcVoterContracts,
} from "./build"
import { carryClaimable, type PreviousWallet } from "./carry-claimable"
import type { ChainLock, WalletChainReader } from "./chain"
import {
  type DailyFillResult,
  fillClaimValues,
  fillDailyPrices,
  type PriceHistoryFetch,
} from "./claim-prices"
import { buildGaugeHistories } from "./gauge-history"
import {
  type HistoryPlan,
  type HistoryWrites,
  historyTxsPerRun,
  historyWrites,
  openGaps,
  planHistory,
  postponedStates,
  storedClaims,
  type WalletWindow,
  windowOf,
  writeHistory,
} from "./history"
import keepClaimValues from "./keep-claim-values"
import {
  type ActivityEventRow,
  isExcludedWallet,
  type LockRow,
  type WarehouseReader,
} from "./reader"
import { anyFailure, readClaimable } from "./reward-sources"

// The warehouse snapshot: Neon projections into READ_DB documents. It runs
// inside the indexer's 15-minute wake window, chained after ingest through
// the JOBS service binding, so Neon's compute is never woken for it alone.
// The cron at :03, :18, :33 and :48 is a fallback that only runs when no
// chained run finished in the last 10 minutes.

const network = "mezo" as const
const job = "warehouse"
const blockCursor = "warehouse-block"
const sweepCursor = "warehouse-sweep"
const sweepSizeCursor = "warehouse-sweep-size"

/** A cron run is skipped when a run finished this recently. */
export const fallbackQuietSeconds = 10 * 60

/**
 * Kinds a run builds whole every time although few of them change: a
 * gauge's history moves when its votes or incentives do, and a past
 * protocol epoch never does. They are compared with what is stored and
 * only the changed ones are sent (see the store's `skipUnchanged`).
 */
const rarelyChanging: readonly ReadModelKind[] = [
  "gauge-history",
  "gauge-funding",
  "protocol",
  "protocol-activity",
  "protocol-history",
  "protocol-epoch",
]

/**
 * Latest wallet-facing events a wallet's document holds. The read asks for
 * one more, so a wallet with exactly this many is known to be whole.
 */
const eventsPerWallet = 80
/** Changed wallets rebuilt per run, at most. */
const maxChangedWallets = 300
/** Requested wallets read per run, at most; `requestedShare` takes fewer. */
const maxRequestedWallets = 100

/**
 * The sweep size adapts to keep a run near `targetMs` (the indexer's hook
 * window budget is about 30 s): smaller after a slow run, larger after a
 * fast one, never under `minSweep` or over the configured maximum.
 */
export const sweepTiming = { targetMs: 20_000, fastMs: 12_000, step: 25 }
const minSweep = 25
/** The first run's sweep, before any timing is known. */
const initialSweep = 150

export function nextSweepSize(
  size: number,
  durationMs: number,
  max: number,
): number {
  if (durationMs > sweepTiming.targetMs) {
    return Math.max(minSweep, Math.floor((size * 3) / 4))
  }
  if (durationMs < sweepTiming.fastMs) {
    return Math.min(max, size + sweepTiming.step)
  }
  return Math.min(max, size)
}

/**
 * Requested wallets (`wallet_requests`: built live by the API, or looked at
 * while their overview was over an hour old) a run of this sweep size
 * rebuilds at most. The rest stay queued, oldest first, for later runs.
 */
export function requestedShare(size: number): number {
  return size - Math.ceil(size / 2)
}

/**
 * Wallets the sweep reads in a run that also rebuilds `requested` wallets.
 * Requested wallets take their places from the sweep's share, and at most
 * `requestedShare` of them, so the two together never pass the sweep size:
 * people looking at wallets never makes a run rebuild more wallets (its
 * time, D1 writes and history budget stay as they were). The sweep keeps
 * at least half its share, so while requests keep coming its full cycle at
 * most doubles.
 */
export function sweepShare(size: number, requested: number): number {
  return size - Math.min(requested, requestedShare(size))
}

export type WarehouseSnapshotDeps = {
  db: D1Database
  kv: KVNamespace
  warehouse: WarehouseReader
  chain: WalletChainReader
  trigger: RunTrigger
  /** Most wallets swept per run (the adaptive size never exceeds it). */
  sweepWallets: number
  /**
   * Older transactions of one wallet read back into its stored history
   * per run (history.ts); null reads none, so histories only grow forward.
   */
  historyBackfillTxs?: number | null
  /**
   * Where BTC's and MEZO's daily history comes from, for claims' values
   * when claimed (claim-prices.ts). Absent or null: nothing is fetched,
   * and claims are valued from what is stored.
   */
  priceHistory?: {
    fetchHistory: PriceHistoryFetch
    /** A Demo or keyless key: CoinGecko serves the past 365 days. */
    limitedReach: boolean
  } | null
  nowSeconds: number
  logger: Logger
  /** Milliseconds, for the run's duration; defaults to `Date.now`. */
  clock?: () => number
  /**
   * Called once, right after the snapshot's last warehouse query and
   * before its D1 writes, so other Neon reads (the scan copy) land in the
   * same moment of the wake window. Its errors are ignored here.
   */
  afterWarehouseReads?: () => Promise<void>
}

export type WarehouseSnapshotResult =
  | { status: "skipped"; reason: string }
  | {
      status: "ok"
      block: number
      wallets: number
      documents: number
      changed: number
      durationMs: number
      sweepSize: number
    }

async function samplesSince(db: D1Database, since: number) {
  const result = await db
    .prepare(
      `SELECT token, sampled_at, usd FROM price_samples
       WHERE sampled_at >= ?1 ORDER BY sampled_at`,
    )
    .bind(since)
    .all<{ token: string; sampled_at: number; usd: string }>()
  return result.results
}

/** Nearest sample at or before `timestamp`, within two hours. */
function historicLookup(
  samples: readonly { token: string; sampled_at: number; usd: string }[],
): BuildContext["historicPrice"] {
  return function historicPrice(token, timestamp) {
    let best: string | null = null
    for (const sample of samples) {
      if (sample.token !== token || sample.sampled_at > timestamp) continue
      if (timestamp - sample.sampled_at <= 7_200) best = sample.usd
    }
    return best
  }
}

/**
 * One step of the daily price history, then every stored daily price.
 * Never throws: a failed fill only logs (the prices stored before still
 * value claims), and a failed read gives null (claims' values are unknown
 * this run, and Earned carries its previous figure).
 */
async function claimPricesFor(
  deps: WarehouseSnapshotDeps,
): Promise<{ prices: ClaimPrices | null; fill: DailyFillResult | null }> {
  let fill: DailyFillResult | null = null
  if (deps.priceHistory !== undefined && deps.priceHistory !== null) {
    try {
      fill = await fillDailyPrices({
        db: deps.db,
        fetchHistory: deps.priceHistory.fetchHistory,
        limitedReach: deps.priceHistory.limitedReach,
        nowSeconds: deps.nowSeconds,
        logger: deps.logger,
      })
    } catch (error) {
      deps.logger.warn({
        message: "claim_prices_fill_failed",
        detail: reason(error),
      })
    }
  }
  try {
    return { prices: await readClaimPrices(deps.db, network), fill }
  } catch (error) {
    deps.logger.warn({
      message: "claim_prices_read_failed",
      detail: reason(error),
    })
    return { prices: null, fill }
  }
}

/**
 * Stored claims written before their day was priced get their value when
 * claimed, within what the run's history budget left. Failures only log.
 */
async function storeClaimValues(
  deps: WarehouseSnapshotDeps,
  prices: ClaimPrices | null,
  historyRows: number,
): Promise<{ read: number; written: number } | null> {
  if (prices === null) return null
  try {
    return await fillClaimValues({
      db: deps.db,
      prices,
      budget: Math.max(0, historyTxsPerRun - historyRows),
      nowSeconds: deps.nowSeconds,
    })
  } catch (error) {
    deps.logger.warn({
      message: "claim_values_fill_failed",
      detail: reason(error),
    })
    return null
  }
}

/** The oldest requests first, so a wallet left for a later run leads it. */
async function requestedWallets(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT wallet FROM wallet_requests WHERE network = ?1
       ORDER BY requested_at, wallet LIMIT ?2`,
    )
    .bind(network, maxRequestedWallets)
    .all<{ wallet: string }>()
  return result.results.map((row) => row.wallet)
}

/** The pools PoolsVoter events name (its votes and incentives). */
function poolsNamedIn(
  events: readonly { source: string; gauge: string | null }[],
): string[] {
  return [
    ...new Set(
      events.flatMap((event) =>
        event.source === "POOLS_VOTER" && event.gauge !== null
          ? [event.gauge.toLowerCase()]
          : [],
      ),
    ),
  ]
}

/** The stored overview and rewards of these wallets, where they exist. */
async function previousWallets(
  db: D1Database,
  wallets: readonly string[],
): Promise<Map<string, PreviousWallet>> {
  const found = new Map<string, PreviousWallet>()
  // A few at a time: each is two D1 reads.
  for (let start = 0; start < wallets.length; start += 20) {
    await Promise.all(
      wallets.slice(start, start + 20).map(async (wallet) => {
        const [overview, rewards] = await Promise.all([
          readReadModel(db, network, "wallet-overview", wallet).catch(
            () => null,
          ),
          readReadModel(db, network, "wallet-rewards", wallet).catch(
            () => null,
          ),
        ])
        if (overview !== null && rewards !== null) {
          found.set(wallet, {
            overview: overview.data,
            rewards: rewards.data,
            block: overview.meta.block,
          })
        }
      }),
    )
  }
  return found
}

/** A run's time by what it was spent on, in milliseconds. */
export type RunTimings = {
  /** Warehouse (Neon) queries. */
  warehouseMs: number
  /** Chain reads other than `earned`: locks, voting power, the getters. */
  chainMs: number
  /** `earned` calls, retries and pauses included. */
  earnedMs: number
  /** Reading earlier documents to carry claimable from. */
  previousMs: number
  /** Writing the run's documents to D1. */
  writeMs: number
  /** Reading and writing wallet histories in D1 (history.ts). */
  historyMs: number
}

/**
 * `target` with every method timed: `spend` is told how long each call
 * took and which method it was. Nothing else about the calls changes.
 */
export function timedCalls<Target extends object>(
  target: Target,
  clock: () => number,
  spend: (ms: number, method: string) => void,
): Target {
  return new Proxy(target, {
    get(inner, property, receiver) {
      const value: unknown = Reflect.get(inner, property, receiver)
      if (typeof value !== "function" || typeof property !== "string") {
        return value
      }
      return (...args: unknown[]): unknown => {
        const started = clock()
        const done = (): void => spend(clock() - started, property)
        const result: unknown = Reflect.apply(value, inner, args)
        if (result instanceof Promise) {
          return result.finally(done)
        }
        done()
        return result
      }
    },
  })
}

/** { "wallet-overview": 50, "gauge-history": 782, ... } */
export function countByKind(
  writes: readonly { kind: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const write of writes) {
    counts[write.kind] = (counts[write.kind] ?? 0) + 1
  }
  return counts
}

/** Puts wallets on the list the next run rebuilds first. */
async function requestAgain(
  db: D1Database,
  wallets: readonly string[],
  nowSeconds: number,
): Promise<void> {
  if (wallets.length === 0) return
  await db.batch(
    wallets.map((wallet) =>
      db
        .prepare(
          `INSERT INTO wallet_requests (network, wallet, requested_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT (network, wallet) DO NOTHING`,
        )
        .bind(network, wallet, nowSeconds),
    ),
  )
}

async function clearRequests(
  db: D1Database,
  wallets: readonly string[],
): Promise<void> {
  if (wallets.length === 0) return
  await db.batch(
    wallets.map((wallet) =>
      db
        .prepare(
          "DELETE FROM wallet_requests WHERE network = ?1 AND wallet = ?2",
        )
        .bind(network, wallet),
    ),
  )
}

/** Stats past epoch documents already carry (frozen when they ended). */
async function frozenStats(
  db: D1Database,
  numbers: readonly number[],
): Promise<Map<number, ProtocolStats | null>> {
  const stored = await Promise.all(
    numbers.map((number) =>
      readReadModel(db, network, "protocol-epoch", String(number)).catch(
        () => null,
      ),
    ),
  )
  return new Map(
    numbers.map((number, index) => [number, stored[index]?.data.stats ?? null]),
  )
}

function escrowLocksOf(
  locks: readonly LockRow[],
): { escrow: Escrow; tokenId: string }[] {
  return locks.flatMap((lock) => {
    const escrow = escrowForContract(lock.contract_address)
    return escrow === null ? [] : [{ escrow, tokenId: lock.token_id }]
  })
}

/**
 * Lock rows with the chain's amount, end and permanence. A lock the chain
 * says is empty (withdrawn, or merged into another) is dropped; a lock whose
 * read failed keeps the warehouse's row.
 */
export function correctLocks(
  locks: readonly LockRow[],
  chain: ReadonlyMap<string, ChainLock>,
): LockRow[] {
  return locks.flatMap((lock) => {
    const escrow = escrowForContract(lock.contract_address)
    const read =
      escrow === null ? undefined : chain.get(`${escrow}:${lock.token_id}`)
    if (read === undefined) return [lock]
    if (read.amount === 0n && !read.isPermanent) return []
    return [
      {
        ...lock,
        amount: read.amount.toString(),
        unlock_at: read.isPermanent ? "0" : read.end.toString(),
        is_permanent: read.isPermanent,
      },
    ]
  })
}

/** Events by acting wallet (lower case), in the order read. */
function eventsByActor(
  events: readonly ActivityEventRow[],
): Map<string, ActivityEventRow[]> {
  const grouped = new Map<string, ActivityEventRow[]>()
  for (const event of events) {
    const actor = event.actor?.toLowerCase()
    if (actor === undefined) continue
    grouped.set(actor, [...(grouped.get(actor) ?? []), event])
  }
  return grouped
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown"
}

/**
 * Each truncated wallet's claims beyond its document, for its Earned:
 * those stored already and those this run stores (duplicates of the
 * document's own are dropped by id when it is built). Null when they
 * could not be read: Earned is then unknown for the plan's wallets.
 */
async function historyClaimsOf(
  db: D1Database,
  context: BuildContext,
  plan: HistoryPlan,
  writes: HistoryWrites | null,
  deps: WarehouseSnapshotDeps,
  spent: RunTimings,
  clock: () => number,
): Promise<Map<string, ActivityRow[]> | null> {
  const started = clock()
  try {
    const stored = await storedClaims(db, [...plan.windows.keys()])
    const claims = new Map<string, ActivityRow[]>()
    for (const [wallet, walletClaims] of stored) {
      const fresh = activityRows(
        context,
        writes?.events.get(wallet) ?? [],
      ).filter((row) => row.type === "claim")
      claims.set(wallet, [...walletClaims, ...fresh])
    }
    return claims
  } catch (error) {
    deps.logger.warn({
      message: "warehouse_history_claims_failed",
      detail: reason(error),
    })
    return null
  } finally {
    spent.historyMs += clock() - started
  }
}

/**
 * The stored document of a kind for these wallets (their previous Earned,
 * or their claims' values when claimed), null where a wallet has none
 * yet. A wallet whose read failed is left out.
 */
async function previousDocuments<
  Kind extends "wallet-rewards" | "wallet-activity",
>(
  db: D1Database,
  kind: Kind,
  wallets: readonly string[],
): Promise<Map<string, ReadModelData<Kind> | null>> {
  const found = new Map<string, ReadModelData<Kind> | null>()
  for (let start = 0; start < wallets.length; start += 20) {
    await Promise.all(
      wallets.slice(start, start + 20).map(async (wallet) => {
        try {
          const stored = await readReadModel(db, network, kind, wallet)
          found.set(wallet, stored?.data ?? null)
        } catch {
          // Unknown: what depends on it is not written.
        }
      }),
    )
  }
  return found
}

function sameEarned(
  a: WalletRewards["earned"],
  b: WalletRewards["earned"],
): boolean {
  const earned = walletRewardsSchema.shape.earned
  return JSON.stringify(earned.parse(a)) === JSON.stringify(earned.parse(b))
}

function sameRewards(a: WalletRewards, b: WalletRewards): boolean {
  return (
    JSON.stringify(walletRewardsSchema.parse(a)) ===
    JSON.stringify(walletRewardsSchema.parse(b))
  )
}

/** A truncated wallet's claims beyond its document, where they are known. */
function storedClaimsFor(
  claims: Map<string, ActivityRow[]> | null,
  wallet: string,
): { storedClaims?: ActivityRow[] } {
  const stored = claims?.get(wallet)
  return stored === undefined ? {} : { storedClaims: stored }
}

/**
 * Writes this run's history rows and states, or, after a failed warehouse
 * read, only moves the read wallets back in line. Failures only log.
 */
async function storeHistory(
  db: D1Database,
  context: BuildContext,
  plan: HistoryPlan,
  writes: HistoryWrites | null,
  deps: WarehouseSnapshotDeps,
): Promise<number> {
  try {
    if (writes === null) {
      await writeHistory(
        db,
        new Map(),
        postponedStates(plan, deps.nowSeconds),
        deps.nowSeconds,
      )
      return 0
    }
    const rows = new Map<string, ActivityRow[]>()
    for (const [wallet, walletEvents] of writes.events) {
      rows.set(wallet, activityRows(context, walletEvents))
    }
    return await writeHistory(db, rows, writes.states, deps.nowSeconds)
  } catch (error) {
    deps.logger.warn({
      message: "warehouse_history_write_failed",
      detail: reason(error),
    })
    return 0
  }
}

export async function runWarehouseSnapshot(
  deps: WarehouseSnapshotDeps,
): Promise<WarehouseSnapshotResult> {
  const { db, logger } = deps
  const clock = deps.clock ?? Date.now
  const startedMs = clock()
  // Where a run's time goes, for the log (see `timedCalls`).
  const spent: RunTimings = {
    warehouseMs: 0,
    chainMs: 0,
    earnedMs: 0,
    previousMs: 0,
    writeMs: 0,
    historyMs: 0,
  }
  const warehouse = timedCalls(deps.warehouse, clock, (ms) => {
    spent.warehouseMs += ms
  })
  const chain = timedCalls(deps.chain, clock, (ms, method) => {
    if (method === "earned") spent.earnedMs += ms
    else spent.chainMs += ms
  })
  if (deps.trigger === "cron") {
    const since = await secondsSinceLastOk(db, job, network, deps.nowSeconds)
    if (since !== null && since < fallbackQuietSeconds) {
      return { status: "skipped", reason: "A chained run finished recently" }
    }
  }
  const runId = await startRun(db, job, network, deps.trigger, deps.nowSeconds)
  try {
    const head = await warehouse.head()
    if (head === null) {
      await finishRun(db, runId, {
        status: "skipped",
        block: null,
        rowsWritten: 0,
        detail: "Warehouse is empty",
        nowSeconds: deps.nowSeconds,
      })
      return { status: "skipped", reason: "Warehouse is empty" }
    }
    // Beside the warehouse reads: a CoinGecko call about once a day.
    const claimPricesRead = claimPricesFor(deps)
    const [
      cursor,
      sweepFrom,
      storedSweepSize,
      prices,
      directory,
      samples,
      queued,
      supply,
    ] = await Promise.all([
      readCursor(db, blockCursor, network),
      readCursor(db, sweepCursor, network),
      readCursor(db, sweepSizeCursor, network),
      readPricesFromKv(deps.kv),
      readReadModel(db, network, "gauges", currentKey),
      samplesSince(db, deps.nowSeconds - 3 * 86_400),
      requestedWallets(db),
      readEscrowSupply(db).catch(() => ({ vebtc: null, vemezo: null })),
    ])
    const sweepSize = Math.min(
      deps.sweepWallets,
      Math.max(minSweep, Number(storedSweepSize ?? initialSweep) || minSweep),
    )
    // The zero and burn addresses are never built; their requests are
    // cleared below rather than left at the head of the queue.
    const excludedRequests = queued.filter(isExcludedWallet)
    const requested = queued
      .filter((wallet) => !isExcludedWallet(wallet))
      .slice(0, requestedShare(sweepSize))
    // Filled from the chain below, before any document is built.
    const poolGauges = new Map<string, string>()
    const context: BuildContext = {
      poolGauges,
      nowSeconds: deps.nowSeconds,
      prices: prices ?? { btc: null, mezo: null },
      gauges: gaugeRefsFrom(directory?.data ?? null),
      cards: gaugeCardsFrom(directory?.data ?? null),
      historicPrice: historicLookup(samples),
      // Set below, before the first claim is built.
      claimPrices: null,
      escrowSupply: supply,
    }

    // Wallets: everything touched since the last run, wallets the API had
    // to serve live, and a rotating sweep over every wallet with on-chain
    // activity, so each one is rebuilt within a few hours.
    const changed =
      cursor === null
        ? []
        : await warehouse.changedWallets(Number(cursor), maxChangedWallets)
    const sweepTake = sweepShare(sweepSize, requested.length)
    const swept = await warehouse.sweepWallets(sweepFrom ?? "0x", sweepTake)
    // Requested wallets first: someone opened them, or a run skipped them.
    // The oldest request leads (`requestedWallets` orders by time, and a
    // skipped wallet keeps its first time), so nobody waits behind the sweep.
    const wallets = [...new Set([...requested, ...changed, ...swept])].filter(
      (wallet) => !isExcludedWallet(wallet),
    )
    const nextSweep = swept.length < sweepTake ? "0x" : (swept.at(-1) ?? "0x")

    // The chain's locked() wins over the warehouse's lock positions, which
    // miss locks created before the indexer's escrow history and splits.
    const warehouseLocks = await warehouse.locksOf(wallets)
    const chainLocks = await chain
      .locked(escrowLocksOf(warehouseLocks))
      .catch(() => new Map<string, ChainLock>())
    const locks = correctLocks(warehouseLocks, chainLocks)
    const tokenIds = [...new Set(locks.map((lock) => lock.token_id))]
    const [warehouseVotes, read] = await Promise.all([
      warehouse.activeVotes(tokenIds),
      warehouse.activityOf(wallets, eventsPerWallet + 1),
    ])
    // Each wallet's latest events. A full read keeps whole seconds only, and
    // its wallet's older rows go to the stored history (history.ts).
    const windows = new Map<string, WalletWindow>()
    for (const [wallet, walletEvents] of eventsByActor(read)) {
      windows.set(wallet, windowOf(walletEvents, eventsPerWallet))
    }
    const events = [...windows.values()].flatMap((window) => window.events)
    // The stored history never fails a run: a failed step only logs, and
    // the wallets' documents and the cursors are written as always.
    const historyStarted = clock()
    let historyPlan: HistoryPlan | null = null
    // False when the history states could not be read for a reason other
    // than missing tables: the stored claims are then unknown too.
    let historyKnown = true
    try {
      historyPlan = await planHistory({
        db,
        windows,
        backfillTxs: deps.historyBackfillTxs ?? null,
      })
    } catch (error) {
      historyKnown = false
      logger.warn({
        message: "warehouse_history_plan_failed",
        detail: reason(error),
      })
    }
    spent.historyMs += clock() - historyStarted
    let historyRead: ActivityEventRow[][] = []
    // What the run stores; null when the read failed: nothing is stored.
    let historyStore: HistoryWrites | null = null
    // Truncated wallets whose stored history still stops short of their
    // document after this run (history.ts, `openGaps`).
    let historyOpen = new Set<string>()
    if (historyPlan !== null && historyPlan.requests.length > 0) {
      try {
        historyRead = await warehouse.walletHistory(historyPlan.requests)
        historyStore = historyWrites(historyPlan, historyRead, deps.nowSeconds)
        historyOpen = openGaps(historyPlan, historyRead)
      } catch (error) {
        logger.warn({
          message: "warehouse_history_read_failed",
          detail: reason(error),
          requests: historyPlan.requests.length,
          wallets: historyPlan.requests.map((request) => request.wallet),
        })
        historyOpen = openGaps(historyPlan, null)
      }
    } else if (historyPlan !== null) {
      historyStore = historyWrites(historyPlan, [], deps.nowSeconds)
      historyOpen = openGaps(historyPlan, [])
    }
    const escrowLocks = locks.flatMap((lock) => {
      const escrow = escrowForContract(lock.contract_address)
      return escrow === null ? [] : [{ escrow, tokenId: lock.token_id }]
    })
    // Claimable comes from the chain, for every gauge a lock votes now
    // (see reward-sources.ts). Under the cap, the wallets listed first
    // (requested, then changed, then swept) are read first.
    const walletRank = new Map(wallets.map((wallet, index) => [wallet, index]))
    const tokenRank = new Map(
      locks.map((lock) => [
        lock.token_id,
        walletRank.get(lock.owner.toLowerCase()) ?? wallets.length,
      ]),
    )
    const requestedSet = new Set(requested)
    const waitingTokens = new Set(
      locks
        .filter((lock) => requestedSet.has(lock.owner.toLowerCase()))
        .map((lock) => lock.token_id),
    )
    const [votingPower, claimable] = await Promise.all([
      chain.votingPower(escrowLocks),
      readClaimable(chain, warehouseVotes, {
        rank: (tokenId) => tokenRank.get(tokenId) ?? wallets.length,
        waiting: (tokenId) => waitingTokens.has(tokenId),
        otherPools: poolsNamedIn([...events, ...historyRead.flat()]),
      }),
    ])
    const { votes, sources, earned } = claimable
    for (const [pool, gauge] of claimable.poolGauges)
      poolGauges.set(pool, gauge)
    if (claimable.dropped > 0) {
      logger.warn({
        message: "warehouse_claimable_capped",
        dropped: claimable.dropped,
        wallets: wallets.length,
      })
    }
    // A lock whose reads did not come back has an unknown claimable. Its
    // wallet is still rebuilt, with that lock's figure carried over from
    // the wallet's last documents (carry-claimable.ts): the API reads
    // claimable live for whoever looks, so the stored figure is only the
    // fallback. A wallet with an unread lock and no earlier documents is
    // left out, and asked for again, since there is nothing to carry.
    const unreadWallets = new Set(
      locks
        .filter((lock) => claimable.unread.has(lock.token_id))
        .map((lock) => lock.owner.toLowerCase()),
    )
    if (anyFailure(claimable.failures)) {
      logger.warn({
        message: "warehouse_claimable_read_failed",
        ...claimable.failures,
        earnedAsked: claimable.asked,
        // Rebuilt with an earlier claimable carried over for some lock.
        walletsCarried: unreadWallets.size,
        // Requests, not calls: refused as malformed by an endpoint (a
        // fallback that cannot serve the call), and failed any other way.
        rejectedRequests: claimable.diagnostics.rejectedRequests,
        lostRequests: claimable.diagnostics.lostRequests,
        errors: claimable.diagnostics.errors,
      })
    }
    if (claimable.truncated.length > 0) {
      logger.warn({
        message: "warehouse_reward_tokens_truncated",
        contracts: claimable.truncated,
      })
    }
    const boosts = new Map(
      (directory?.data.gauges ?? []).flatMap((card) =>
        card.gauge.vebtcTokenId === null || card.boost === null
          ? []
          : [[card.gauge.vebtcTokenId, card.boost] as const],
      ),
    )

    // Documents are stamped with the block the run read the chain at, so
    // "as of block N" means "read at N". `head.block` is the warehouse's
    // last activity event, which stands still while nobody votes or locks
    // (40 minutes on 12 Nov 2026); it stays the cursor for changed wallets.
    const readBlock = (await chain.head()) ?? head.block
    const base = {
      network,
      block: readBlock,
      source: "warehouse" as const,
      updatedAt: deps.nowSeconds,
    }
    const writes: ReadModelWrite<ReadModelKind>[] = []
    const previousStarted = clock()
    const previous = await previousWallets(db, [...unreadWallets])
    spent.previousMs = clock() - previousStarted
    const unreadLocks = new Set(
      locks.flatMap((lock) => {
        const escrow = escrowForContract(lock.contract_address)
        return escrow !== null && claimable.unread.has(lock.token_id)
          ? [`${escrow}:${lock.token_id}`]
          : []
      }),
    )
    const claimPricing = await claimPricesRead
    context.claimPrices = claimPricing.prices
    const walletClaims =
      historyPlan === null
        ? null
        : await historyClaimsOf(
            db,
            context,
            historyPlan,
            historyStore,
            deps,
            spent,
            clock,
          )
    // Truncated wallets whose claims beyond the document are unknown this
    // run: the stored claims could not be read, or the stored history does
    // not reach the document yet (a gap left for a later run, a failed gap
    // read, a full one). Their Earned would miss those claims, so it
    // carries the previous one instead until the gap closes (a missing
    // history table is not unknown: there are no stored claims).
    // Without the daily prices every claim's value is unknown.
    const claimsUnknown = [...windows]
      .filter(
        ([wallet, window]) =>
          context.claimPrices === null ||
          (window.truncated &&
            (!historyKnown ||
              (historyPlan !== null &&
                (walletClaims === null || historyOpen.has(wallet))))),
      )
      .map(([wallet]) => wallet)
    // A token's daily history that never succeeded, or is more than a day
    // behind (a failing source, jobs deployed before migration 0008): its
    // claims are "not priced yet" for want of a call, and an Earned
    // without them would drop for a while. A wallet with a pending claim
    // waiting on such a history carries its previous Earned; its rows are
    // valued all the same. Each token on its own: MEZO's history behind
    // never holds back a wallet whose pending claims are BTC's.
    const claimPrices = context.claimPrices
    const historiesBehind =
      claimPrices === null
        ? []
        : historyTokens.filter(
            (token) => !historyCaughtUp(claimPrices, deps.nowSeconds, token),
          )
    const rewardsBefore = await previousDocuments(
      db,
      "wallet-rewards",
      historiesBehind.length > 0 ? [...windows.keys()] : claimsUnknown,
    )
    // Without the daily prices, the claims' values when claimed come from
    // the stored documents, so they are not written without them.
    const activityBefore =
      context.claimPrices === null
        ? await previousDocuments(db, "wallet-activity", [...windows.keys()])
        : new Map<string, WalletActivity | null>()
    const skipped: string[] = []
    for (const wallet of wallets) {
      const before = previous.get(wallet) ?? null
      if (unreadWallets.has(wallet) && before === null) {
        skipped.push(wallet)
        continue
      }
      const built = buildWalletDocuments(
        context,
        {
          wallet,
          locks: locks.filter((lock) => lock.owner.toLowerCase() === wallet),
          votes: votes.filter((vote) =>
            locks.some(
              (lock) =>
                lock.owner.toLowerCase() === wallet &&
                lock.token_id === vote.token_id,
            ),
          ),
          events: events.filter(
            (event) =>
              event.actor?.toLowerCase() === wallet ||
              event.recipient?.toLowerCase() === wallet,
          ),
          rewardSources: sources,
          votingPower,
          earned,
          ...storedClaimsFor(walletClaims, wallet),
        },
        boosts,
      )
      const claimable = carryClaimable({
        built,
        previous: before,
        unread: unreadLocks,
        block: readBlock,
        prices: context.prices,
      })
      const documents =
        context.claimPrices === null
          ? keepClaimValues(claimable, {
              activity: activityBefore.get(wallet),
              rewards: rewardsBefore.get(wallet),
            })
          : claimable
      const unknown =
        claimsUnknown.includes(wallet) ||
        built.waitingOn.some((token) => historiesBehind.includes(token))
      const rewardsThen = rewardsBefore.get(wallet)
      const earnedThen =
        rewardsThen === undefined ? undefined : (rewardsThen?.earned ?? null)
      writes.push({
        ...base,
        kind: "wallet-overview",
        key: wallet,
        data: documents.overview,
        // Someone asked for this wallet because its overview was old: the
        // row says it was checked now even when nothing in it changed, or
        // the API would ask for it again on the next view
        // (`wantsRebuild`). At most one row write a requested wallet, and
        // none when the document changed, as it usually does.
        ...(requestedSet.has(wallet) ? { touch: true } : {}),
      })
      // Unknown claims and no earlier figure read: the stored document
      // stays as it is rather than lose its older claims for a run.
      if (!unknown || earnedThen !== undefined) {
        // The same figure as before is not carried: a carried Earned's
        // basis differs, and would rewrite an unchanged document.
        const carried =
          unknown &&
          earnedThen !== null &&
          earnedThen !== undefined &&
          !sameEarned(earnedThen, documents.rewards.earned)
        const rewards = carried
          ? { ...documents.rewards, earned: earnedThen }
          : documents.rewards
        // A carried Earned's basis is not the stored one's: a document the
        // same as stored but for that is left alone, not rewritten.
        const unchanged =
          carried &&
          rewardsThen !== undefined &&
          rewardsThen !== null &&
          sameRewards(rewards, rewardsThen)
        if (!unchanged) {
          writes.push({
            ...base,
            kind: "wallet-rewards",
            key: wallet,
            data: rewards,
            // Earned's claims, which its USD alone would not write; a
            // carried Earned's are not known.
            etagBasis: carried ? "carried" : documents.earnedBasis,
          })
        }
      }
      writes.push({
        ...base,
        kind: "wallet-activity",
        key: wallet,
        data: documents.activity,
      })
    }

    const current = epochStartOf(deps.nowSeconds)
    const protocolRows = await warehouse.protocol({
      epochStart: current,
      sinceEpoch: Math.min(EPOCH_ZERO_START, current),
      vebtcVoters: vebtcVoterContracts,
      // Event rows, several to a transaction (a vote on four gauges is
      // four), so fewer rows of activity than this. Both the protocol
      // document's 20 rows and the `protocol-activity` document come from
      // them. Reading more means recording the test fixture again
      // (`record:warehouse`): the recording holds this query at 120.
      feedRows: 120,
    })
    // The feed names pools too; ask for the ones not known yet. A failed
    // read only leaves those rows on the pool's address.
    const feedPools = poolsNamedIn(protocolRows.feed).filter(
      (pool) => !poolGauges.has(pool),
    )
    if (feedPools.length > 0) {
      const read = await chain
        .poolGauges(feedPools)
        .catch(() => ({ gauges: new Map<string, string>(), failed: [] }))
      for (const [pool, gauge] of read.gauges) poolGauges.set(pool, gauge)
    }
    writes.push({
      ...base,
      kind: "protocol",
      key: currentKey,
      data: buildProtocol(context, protocolRows, directory?.data ?? null),
    })
    writes.push({
      ...base,
      kind: "protocol-activity",
      key: currentKey,
      data: buildProtocolActivity(context, protocolRows),
    })
    const pastEpochs: number[] = []
    for (
      let start = EPOCH_ZERO_START;
      start < current;
      start += EPOCH_SECONDS
    ) {
      pastEpochs.push(epochIndexFor(start))
    }
    const history = buildProtocolHistory(
      context,
      protocolRows,
      directory?.data ?? null,
      await frozenStats(db, pastEpochs),
    )
    writes.push({
      ...base,
      kind: "protocol-history",
      key: currentKey,
      data: history.history,
    })
    for (const epoch of history.epochs) {
      writes.push({
        ...base,
        kind: "protocol-epoch",
        key: String(epoch.epoch.number),
        data: epoch,
      })
    }

    // Every gauge's epoch-by-epoch votes and incentives, and how
    // consistently each is funded.
    const gaugeVotes = await warehouse.gaugeVotes(EPOCH_ZERO_START)
    await deps.afterWarehouseReads?.().catch(() => undefined)
    const gauges = buildGaugeHistories(
      context,
      gaugeVotes,
      protocolRows.deposits,
    )
    for (const gaugeHistory of gauges.histories) {
      writes.push({
        ...base,
        kind: "gauge-history",
        key: gaugeHistory.address,
        data: gaugeHistory,
      })
    }
    writes.push({
      ...base,
      kind: "gauge-funding",
      key: currentKey,
      data: gauges.funding,
    })

    const writeStarted = clock()
    const changedRows = await writeReadModels(db, writes, {
      skipUnchanged: rarelyChanging,
    })
    spent.writeMs = clock() - writeStarted
    const historyRows =
      historyPlan === null
        ? 0
        : await storeHistory(db, context, historyPlan, historyStore, deps)
    const claimValues = await storeClaimValues(
      deps,
      context.claimPrices,
      historyRows,
    )
    spent.historyMs += clock() - writeStarted - spent.writeMs
    await clearRequests(db, [
      ...requested.filter(
        (wallet) => wallets.includes(wallet) && !skipped.includes(wallet),
      ),
      ...excludedRequests,
    ])
    await requestAgain(db, skipped, deps.nowSeconds)
    const durationMs = clock() - startedMs
    const nextSize = nextSweepSize(sweepSize, durationMs, deps.sweepWallets)
    await Promise.all([
      writeCursor(
        db,
        blockCursor,
        network,
        String(head.block),
        deps.nowSeconds,
      ),
      writeCursor(db, sweepCursor, network, nextSweep, deps.nowSeconds),
      writeCursor(
        db,
        sweepSizeCursor,
        network,
        String(nextSize),
        deps.nowSeconds,
      ),
      // For the API: older history rows arrive only while this is on.
      writeCursor(
        db,
        historyBackfillCursor,
        network,
        String(deps.historyBackfillTxs ?? "off"),
        deps.nowSeconds,
      ),
    ])
    await finishRun(db, runId, {
      status: "ok",
      block: head.block,
      rowsWritten: changedRows,
      detail: `${wallets.length} wallets, ${durationMs} ms, sweep ${sweepSize}`,
      nowSeconds: deps.nowSeconds,
    })
    logger.info({
      message: "Warehouse snapshot written",
      trigger: deps.trigger,
      // The warehouse's last activity event, and the chain block the
      // documents are stamped with.
      block: head.block,
      readBlock,
      wallets: wallets.length,
      documents: writes.length,
      changed: changedRows,
      historyRows,
      historyRequests: historyPlan?.requests.length ?? null,
      // Truncated wallets left for a later run by the history budget.
      historyDeferred: historyPlan?.deferred.size ?? null,
      historyClaimsUnknown: claimsUnknown.length,
      // Claims' values when claimed: history calls and rows this run, and
      // stored claims read and given their value.
      claimPriceCalls: claimPricing.fill?.calls ?? null,
      claimPriceRows: claimPricing.fill?.rows ?? null,
      claimPricesFailed: claimPricing.fill?.failed ?? null,
      claimValuesRead: claimValues?.read ?? null,
      claimValuesWritten: claimValues?.written ?? null,
      requested: requested.length,
      // Requests left for later runs by the requested share (up to the
      // read's 100).
      requestsWaiting:
        queued.length - excludedRequests.length - requested.length,
      durationMs,
      sweepSize,
      // The sweep's share after the requested wallets took theirs.
      swept: swept.length,
      nextSweepSize: nextSize,
      // Where the time went. Each figure adds up the calls of its kind, and
      // calls that run side by side both count, so the sum can pass
      // `durationMs`; what is not listed is building documents in memory.
      ...spent,
      // What was written, by kind: most documents in a run are not wallets.
      documentsByKind: countByKind(writes),
    })
    return {
      status: "ok",
      block: head.block,
      wallets: wallets.length,
      documents: writes.length,
      changed: changedRows,
      durationMs,
      sweepSize,
    }
  } catch (error) {
    await finishRun(db, runId, {
      status: "failed",
      block: null,
      rowsWritten: null,
      detail: error instanceof Error ? error.message.slice(0, 300) : "Unknown",
      nowSeconds: deps.nowSeconds,
    })
    throw error
  }
}
