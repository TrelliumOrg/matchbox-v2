import {
  comparePoints,
  type HistoryPoint,
  type HistoryState,
  historyClaims,
  historyRowStatements,
  historyStateStatement,
  incompleteHistories,
  readHistoryStates,
} from "@matchbox/api/read-models/wallet-history"
import type { ActivityRow } from "@matchbox/contracts/read-models"
import type { ActivityEventRow, WalletHistoryRequest } from "./reader"

// Every row of a wallet's activity, for wallets with more than the
// snapshot reads (`eventsPerWallet`): READ_DB's wallet_activity_rows, which
// the API's internal activity route pages into after the wallet's document
// (apps/api/src/read-models/wallet-history.ts).
//
// Each run, for every such wallet it rebuilds, the rows newer than what is
// stored are added from the events already read for its document. If the
// wallet did more since its last rebuild than one read holds, the gap is
// read forward from the warehouse first. Separately, a run may read one
// wallet's older transactions back from the oldest stored one
// (`WAREHOUSE_HISTORY_BACKFILL_TXS`, off when unset), until nothing older
// exists. Rows are written only when they changed.
//
// All of it shares one budget a run (`historyTxsPerRun`): a wallet over it
// waits, its stored history unchanged, for a later run that rebuilds it.

const network = "mezo"

/** Transactions read forward per wallet to close a gap, per run, at most. */
export const gapTxs = 200

/**
 * Transactions a run adds to the stored histories, at most: new rows on
 * top of a history, gap reads, first stores and the backfill together.
 * Each is about one row: one upsert statement and one row written (two
 * for a claim), sent 50 to a D1 batch, and a batch is one query of the
 * 1,000 (Workers Paid; 50 on Free) an invocation may make. 300 is 6
 * batches and about 330 rows written a run, at most about 32,000 a day:
 * under the Free plan's 100,000 a day with the snapshot's other writes.
 * After a Worker rollback or a warehouse outage, when every busy wallet
 * has a gap, the catch-up spreads over runs instead of one run reading
 * and writing up to 26,000 transactions.
 */
export const historyTxsPerRun = 300

function pointOf(event: ActivityEventRow): HistoryPoint {
  return { ts: Number(event.timestamp), tx: event.tx_hash }
}

/** The events' transactions, newest and oldest; null without events. */
function span(
  events: readonly ActivityEventRow[],
): { low: HistoryPoint; high: HistoryPoint } | null {
  let low: HistoryPoint | null = null
  let high: HistoryPoint | null = null
  for (const event of events) {
    const point = pointOf(event)
    if (low === null || comparePoints(point, low) < 0) low = point
    if (high === null || comparePoints(point, high) > 0) high = point
  }
  return low === null || high === null ? null : { low, high }
}

/**
 * The events outside what is stored: newer than its high, and older than
 * its low. A window reaches below the low only when the warehouse lost
 * events since the history was stored (a re-index): its older events are
 * stored then too, while they are in hand, so the history stays whole.
 */
function unstored(
  events: readonly ActivityEventRow[],
  stored: HistoryState,
): ActivityEventRow[] {
  return events.filter((event) => {
    const point = pointOf(event)
    return (
      comparePoints(point, stored.high) > 0 ||
      comparePoints(point, stored.low) < 0
    )
  })
}

/** Distinct transactions among `events`. */
function txCount(events: readonly ActivityEventRow[]): number {
  return new Set(events.map((event) => event.tx_hash)).size
}

export type WalletWindow = {
  /** The wallet's events for its document, whole seconds only. */
  events: ActivityEventRow[]
  /** The read was full: older events exist than these. */
  truncated: boolean
}

/**
 * A wallet's latest events, newest first, for a document of `perWallet`.
 * The warehouse read asks for one more: a wallet with `perWallet` events
 * or fewer is whole. Over that, older events exist, and the read may end
 * inside a transaction, so its oldest second is left out whole: every
 * second the document holds is then complete, and the stored history goes
 * on strictly before it. A read of a single second keeps its latest
 * `perWallet` events (and is not archived).
 */
export function windowOf(
  events: readonly ActivityEventRow[],
  perWallet: number,
): WalletWindow {
  if (events.length <= perWallet) {
    return { events: [...events], truncated: false }
  }
  const oldest = Math.min(...events.map((event) => Number(event.timestamp)))
  const kept = events.filter((event) => Number(event.timestamp) > oldest)
  return kept.length === 0
    ? { events: events.slice(0, perWallet), truncated: false }
    : { events: kept.slice(0, perWallet), truncated: true }
}

export type HistoryPlan = {
  /** Warehouse reads to make, in one round trip. */
  requests: WalletHistoryRequest[]
  /** Stored states, of the wallets above and of the backfill wallet. */
  states: Map<string, HistoryState>
  /** The truncated wallets rebuilt this run, with their windows. */
  windows: Map<string, WalletWindow>
  /** Wallets among `windows` left for a later run: over the budget. */
  deferred: Set<string>
}

/** A missing table: READ_DB has no history tables (before migration 0007). */
function isMissingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message)
}

/**
 * What this run reads for the history: a gap read for each rebuilt wallet
 * that did more than one read holds since it was stored, and the backfill
 * wallet's older transactions, within `budget`. Null when READ_DB has no
 * history tables; any other failure throws.
 */
export async function planHistory(input: {
  db: D1Database
  windows: Map<string, WalletWindow>
  backfillTxs: number | null
  budget?: number
}): Promise<HistoryPlan | null> {
  const truncated = new Map(
    [...input.windows].filter(([, window]) => window.truncated),
  )
  let states: Map<string, HistoryState>
  let backfill: { wallet: string; state: HistoryState }[] = []
  try {
    states = await readHistoryStates(input.db, network, [...truncated.keys()])
    if (input.backfillTxs !== null) {
      backfill = await incompleteHistories(input.db, network, 1)
    }
  } catch (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return allocateHistory({
    windows: truncated,
    states,
    backfill: backfill[0] ?? null,
    backfillTxs: input.backfillTxs,
    budget: input.budget ?? historyTxsPerRun,
  })
}

/**
 * Shares `budget` transactions between the wallets' needs, each counted at
 * its most: first the new rows on top of a history that reaches the
 * document (a few each, and they keep the history from falling behind),
 * then gaps and first stores, the longest waiting first (never stored,
 * then by when the history was last written; a wallet left over keeps its
 * time, so it leads when it is rebuilt again), then the backfill with what
 * is left. A wallet that does not fit is deferred whole.
 */
export function allocateHistory(input: {
  windows: Map<string, WalletWindow>
  states: Map<string, HistoryState>
  backfill: { wallet: string; state: HistoryState } | null
  backfillTxs: number | null
  budget: number
}): HistoryPlan {
  const { states } = input
  let remaining = input.budget
  const requests: WalletHistoryRequest[] = []
  const deferred = new Set<string>()
  const current: { wallet: string; cost: number }[] = []
  const waiting: {
    wallet: string
    window: WalletWindow
    held: { low: HistoryPoint; high: HistoryPoint }
    stored: HistoryState | undefined
  }[] = []
  for (const [wallet, window] of input.windows) {
    const held = span(window.events)
    if (held === null) continue
    const stored = states.get(wallet)
    if (stored !== undefined && comparePoints(stored.high, held.low) >= 0) {
      current.push({ wallet, cost: txCount(unstored(window.events, stored)) })
    } else {
      waiting.push({ wallet, window, held, stored })
    }
  }
  for (const { wallet, cost } of current) {
    if (cost > remaining) deferred.add(wallet)
    else remaining -= cost
  }
  // Stable: wallets with the same time keep the run's order.
  waiting.sort(
    (a, b) => (a.stored?.updatedAt ?? 0) - (b.stored?.updatedAt ?? 0),
  )
  for (const { wallet, window, held, stored } of waiting) {
    const windowCost = txCount(window.events)
    if (stored === undefined) {
      if (windowCost > remaining) deferred.add(wallet)
      else remaining -= windowCost
      continue
    }
    // The gap read, then the window once the gap is closed.
    const limit = Math.min(gapTxs, remaining - windowCost)
    if (limit < 1) {
      deferred.add(wallet)
      continue
    }
    requests.push({
      wallet,
      direction: "newer",
      from: stored.high,
      until: held.low,
      limit,
    })
    remaining -= limit + windowCost
  }
  const { backfill } = input
  if (backfill !== null && input.backfillTxs !== null) {
    const limit = Math.min(input.backfillTxs, remaining)
    if (limit >= 1) {
      states.set(backfill.wallet, states.get(backfill.wallet) ?? backfill.state)
      requests.push({
        wallet: backfill.wallet,
        direction: "older",
        from: backfill.state.low,
        limit,
      })
    }
  }
  return { requests, states, windows: input.windows, deferred }
}

/** A full gap read: more may lie between what it read and the window. */
function gapStillOpen(
  request: WalletHistoryRequest,
  rows: readonly ActivityEventRow[],
): boolean {
  return txCount(rows) >= request.limit
}

/**
 * The plan's wallets whose stored history still stops short of their
 * document after this run: the wallet was left for a later run, its gap
 * read failed (`results` null), or the read came back full. Their claims
 * in between are in neither, so their Earned is unknown this run. Each
 * closes once a gap read comes back short.
 */
export function openGaps(
  plan: HistoryPlan,
  results: readonly ActivityEventRow[][] | null,
): Set<string> {
  const open = new Set<string>()
  for (const [wallet, window] of plan.windows) {
    const held = span(window.events)
    const stored = plan.states.get(wallet)
    // Never stored, or stored up to the window: nothing is missing.
    if (held === null || stored === undefined) continue
    if (comparePoints(stored.high, held.low) >= 0) continue
    if (plan.deferred.has(wallet) || results === null) {
      open.add(wallet)
      continue
    }
    const index = plan.requests.findIndex(
      (request) => request.wallet === wallet && request.direction === "newer",
    )
    const request = plan.requests[index]
    if (request === undefined || gapStillOpen(request, results[index] ?? [])) {
      open.add(wallet)
    }
  }
  return open
}

export type HistoryWrites = {
  /** Events to store, by wallet (whole transactions). */
  events: Map<string, ActivityEventRow[]>
  /** States to store, by wallet. */
  states: Map<string, HistoryState>
}

/** What to store, given the plan and what its reads returned. */
export function historyWrites(
  plan: HistoryPlan,
  results: readonly ActivityEventRow[][],
  nowSeconds: number,
): HistoryWrites {
  const events = new Map<string, ActivityEventRow[]>()
  const states = new Map<string, HistoryState>()
  const add = (wallet: string, more: readonly ActivityEventRow[]): void => {
    events.set(wallet, [...(events.get(wallet) ?? []), ...more])
  }
  const gaps = new Map<
    string,
    { request: WalletHistoryRequest; rows: ActivityEventRow[] }
  >()
  plan.requests.forEach((request, index) => {
    if (request.direction === "newer") {
      gaps.set(request.wallet, { request, rows: results[index] ?? [] })
    }
  })

  // Newer: the rebuilt wallets, but those left for a later run.
  for (const [wallet, window] of plan.windows) {
    if (plan.deferred.has(wallet)) continue
    const held = span(window.events)
    if (held === null) continue
    const stored = plan.states.get(wallet)
    if (stored === undefined) {
      add(wallet, window.events)
      states.set(wallet, {
        low: held.low,
        high: held.high,
        complete: false,
        updatedAt: nowSeconds,
      })
      continue
    }
    const gap = gaps.get(wallet)
    let high = stored.high
    if (gap !== undefined) {
      add(wallet, gap.rows)
      const filled = span(gap.rows)
      if (gapStillOpen(gap.request, gap.rows)) {
        // Still a gap: the stored history moves up to what was read.
        if (filled !== null) high = filled.high
        states.set(wallet, { ...stored, high, updatedAt: nowSeconds })
        continue
      }
    }
    add(wallet, unstored(window.events, stored))
    if (comparePoints(held.high, high) > 0) high = held.high
    // Down to the window's oldest when it reaches below what is stored
    // (its older events are stored above). The window is a full read, so
    // older events exist again: the backfill looks once more.
    const lower = comparePoints(held.low, stored.low) < 0
    const low = lower ? held.low : stored.low
    if (lower || comparePoints(high, stored.high) !== 0) {
      states.set(wallet, {
        ...stored,
        low,
        high,
        complete: stored.complete && !lower,
        updatedAt: nowSeconds,
      })
    }
  }

  // Older: the backfill wallet.
  plan.requests.forEach((request, index) => {
    if (request.direction !== "older") return
    const older = results[index] ?? []
    const base = states.get(request.wallet) ?? plan.states.get(request.wallet)
    if (base === undefined) return
    add(request.wallet, older)
    const reached = span(older)
    states.set(request.wallet, {
      ...base,
      low: reached === null ? base.low : reached.low,
      complete: txCount(older) < request.limit,
      updatedAt: nowSeconds,
    })
  })
  return { events, states }
}

/**
 * After the plan's warehouse read failed: the states of the wallets it
 * read for, unchanged but for their time, so the backfill and the gaps
 * turn to other wallets first and one wallet whose read keeps failing
 * cannot hold the others back.
 */
export function postponedStates(
  plan: HistoryPlan,
  nowSeconds: number,
): Map<string, HistoryState> {
  const postponed = new Map<string, HistoryState>()
  for (const request of plan.requests) {
    const state = plan.states.get(request.wallet)
    if (state !== undefined) {
      postponed.set(request.wallet, { ...state, updatedAt: nowSeconds })
    }
  }
  return postponed
}

/** Every stored claim of each wallet, for its earned total. */
export async function storedClaims(
  db: D1Database,
  wallets: readonly string[],
): Promise<Map<string, ActivityRow[]>> {
  const found = new Map<string, ActivityRow[]>()
  // A few at a time, as the snapshot reads earlier documents.
  for (let start = 0; start < wallets.length; start += 20) {
    await Promise.all(
      wallets.slice(start, start + 20).map(async (wallet) => {
        found.set(wallet, await historyClaims(db, network, wallet))
      }),
    )
  }
  return found
}

/** D1 accepts this many statements per batch comfortably. */
const batchSize = 50

/** Writes the rows, then the states; returns the rows that changed. */
export async function writeHistory(
  db: D1Database,
  rows: Map<string, ActivityRow[]>,
  states: Map<string, HistoryState>,
  nowSeconds: number,
): Promise<number> {
  const statements: D1PreparedStatement[] = []
  for (const [wallet, walletRows] of rows) {
    statements.push(
      ...(await historyRowStatements(
        db,
        network,
        wallet,
        walletRows,
        nowSeconds,
      )),
    )
  }
  let changed = 0
  for (let start = 0; start < statements.length; start += batchSize) {
    const results = await db.batch(statements.slice(start, start + batchSize))
    for (const result of results) changed += result.meta.changes
  }
  // States last: a state never claims rows that are not stored.
  const updates = [...states].map(([wallet, state]) =>
    historyStateStatement(db, network, wallet, state),
  )
  for (let start = 0; start < updates.length; start += batchSize) {
    await db.batch(updates.slice(start, start + batchSize))
  }
  return changed
}
