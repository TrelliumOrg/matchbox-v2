import { readPricesFromKv } from "@matchbox/api/read-models/prices-kv"
import { gaugeCardsFrom } from "@matchbox/api/read-models/wallet-extras"
import {
  currentKey,
  type ReadModelKind,
  type ReadModelWrite,
  readReadModel,
  writeReadModels,
} from "@matchbox/api/read-store"
import type { Escrow, ProtocolStats } from "@matchbox/contracts/read-models"
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
import { buildGaugeHistories } from "./gauge-history"
import { isExcludedWallet, type LockRow, type WarehouseReader } from "./reader"
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

/** Latest wallet-facing events read per wallet. */
const eventsPerWallet = 80
/** Changed wallets rebuilt per run, at most. */
const maxChangedWallets = 300
/** Wallets the API served live, rebuilt per run, at most. */
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

export type WarehouseSnapshotDeps = {
  db: D1Database
  kv: KVNamespace
  warehouse: WarehouseReader
  chain: WalletChainReader
  trigger: RunTrigger
  /** Most wallets swept per run (the adaptive size never exceeds it). */
  sweepWallets: number
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

async function requestedWallets(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT wallet FROM wallet_requests WHERE network = ?1
       ORDER BY requested_at LIMIT ?2`,
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
    const [
      cursor,
      sweepFrom,
      storedSweepSize,
      prices,
      directory,
      samples,
      requested,
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
    // Filled from the chain below, before any document is built.
    const poolGauges = new Map<string, string>()
    const context: BuildContext = {
      poolGauges,
      nowSeconds: deps.nowSeconds,
      prices: prices ?? { btc: null, mezo: null },
      gauges: gaugeRefsFrom(directory?.data ?? null),
      cards: gaugeCardsFrom(directory?.data ?? null),
      historicPrice: historicLookup(samples),
      escrowSupply: supply,
    }

    // Wallets: everything touched since the last run, wallets the API had
    // to serve live, and a rotating sweep over every wallet with on-chain
    // activity, so each one is rebuilt within a few hours.
    const changed =
      cursor === null
        ? []
        : await warehouse.changedWallets(Number(cursor), maxChangedWallets)
    const swept = await warehouse.sweepWallets(sweepFrom ?? "0x", sweepSize)
    // Requested wallets first: someone opened them, or a run skipped them.
    // The oldest request leads (`requestedWallets` orders by time, and a
    // skipped wallet keeps its first time), so nobody waits behind the sweep.
    const wallets = [...new Set([...requested, ...changed, ...swept])].filter(
      (wallet) => !isExcludedWallet(wallet),
    )
    const nextSweep = swept.length < sweepSize ? "0x" : (swept.at(-1) ?? "0x")

    // The chain's locked() wins over the warehouse's lock positions, which
    // miss locks created before the indexer's escrow history and splits.
    const warehouseLocks = await warehouse.locksOf(wallets)
    const chainLocks = await chain
      .locked(escrowLocksOf(warehouseLocks))
      .catch(() => new Map<string, ChainLock>())
    const locks = correctLocks(warehouseLocks, chainLocks)
    const tokenIds = [...new Set(locks.map((lock) => lock.token_id))]
    const [warehouseVotes, events] = await Promise.all([
      warehouse.activeVotes(tokenIds),
      warehouse.activityOf(wallets, eventsPerWallet),
    ])
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
        otherPools: poolsNamedIn(events),
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
        },
        boosts,
      )
      const documents = carryClaimable({
        built,
        previous: before,
        unread: unreadLocks,
        block: readBlock,
        prices: context.prices,
      })
      writes.push(
        {
          ...base,
          kind: "wallet-overview",
          key: wallet,
          data: documents.overview,
        },
        {
          ...base,
          kind: "wallet-rewards",
          key: wallet,
          data: documents.rewards,
        },
        {
          ...base,
          kind: "wallet-activity",
          key: wallet,
          data: documents.activity,
        },
      )
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
    await clearRequests(
      db,
      requested.filter(
        (wallet) => wallets.includes(wallet) && !skipped.includes(wallet),
      ),
    )
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
      requested: requested.length,
      durationMs,
      sweepSize,
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
