import {
  type ActivityCategory,
  type ActivityRow,
  activityCategory,
  activityRowSchema,
} from "@matchbox/contracts/read-models"
import { EPOCH_ZERO_START, epochIndexFor, epochStartOf } from "@matchbox/domain"
import { z } from "zod"
import { type ReadDatabase, readModelEtag } from "./store"

// A wallet's whole activity history in READ_DB (`wallet_activity_rows` and
// `wallet_history_state`, apps/jobs/migrations/0007_wallet_history.sql).
// The `wallet-activity` document holds a wallet's latest rows; for a wallet
// with more, the warehouse snapshot keeps every row here and the API's
// internal activity route pages on into them, newest first.

/** A transaction's place in the warehouse's order: timestamp, then hash. */
export type HistoryPoint = { ts: number; tx: string }

/** -1 when `a` comes before `b`, 1 after, 0 for the same transaction. */
export function comparePoints(a: HistoryPoint, b: HistoryPoint): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1
  if (a.tx === b.tx) return 0
  return a.tx < b.tx ? -1 : 1
}

export type HistoryState = {
  /** Every transaction from `low` to `high`, both included, is stored. */
  low: HistoryPoint
  high: HistoryPoint
  /** Nothing older than `low` exists. */
  complete: boolean
  updatedAt: number
}

const stateRowSchema = z.object({
  low_ts: z.number().int(),
  low_tx: z.string(),
  high_ts: z.number().int(),
  high_tx: z.string(),
  complete: z.number().int(),
  updated_at: z.number().int(),
})

function stateOf(row: z.output<typeof stateRowSchema>): HistoryState {
  return {
    low: { ts: row.low_ts, tx: row.low_tx },
    high: { ts: row.high_ts, tx: row.high_tx },
    complete: row.complete === 1,
    updatedAt: row.updated_at,
  }
}

export async function readHistoryState(
  db: ReadDatabase,
  network: string,
  wallet: string,
): Promise<HistoryState | null> {
  const row = await db
    .prepare(
      `SELECT low_ts, low_tx, high_ts, high_tx, complete, updated_at
       FROM wallet_history_state WHERE network = ?1 AND wallet = ?2`,
    )
    .bind(network, wallet)
    .first()
  return row === null ? null : stateOf(stateRowSchema.parse(row))
}

/** The states of these wallets, where they exist. Throws without the table. */
export async function readHistoryStates(
  db: ReadDatabase,
  network: string,
  wallets: readonly string[],
): Promise<Map<string, HistoryState>> {
  const found = new Map<string, HistoryState>()
  // D1 binds at most 100 parameters a statement.
  for (let start = 0; start < wallets.length; start += 90) {
    const slice = wallets.slice(start, start + 90)
    const marks = slice.map((_, index) => `?${index + 2}`).join(", ")
    const { results } = await db
      .prepare(
        `SELECT wallet, low_ts, low_tx, high_ts, high_tx, complete, updated_at
         FROM wallet_history_state WHERE network = ?1 AND wallet IN (${marks})`,
      )
      .bind(network, ...slice)
      .all()
    for (const row of results) {
      const parsed = stateRowSchema.extend({ wallet: z.string() }).parse(row)
      found.set(parsed.wallet, stateOf(parsed))
    }
  }
  return found
}

/** Wallets whose history is not complete yet, the longest waiting first. */
export async function incompleteHistories(
  db: ReadDatabase,
  network: string,
  limit: number,
): Promise<{ wallet: string; state: HistoryState }[]> {
  const { results } = await db
    .prepare(
      `SELECT wallet, low_ts, low_tx, high_ts, high_tx, complete, updated_at
       FROM wallet_history_state WHERE network = ?1 AND complete = 0
       ORDER BY updated_at LIMIT ?2`,
    )
    .bind(network, limit)
    .all()
  return results.map((row) => {
    const parsed = stateRowSchema.extend({ wallet: z.string() }).parse(row)
    return { wallet: parsed.wallet, state: stateOf(parsed) }
  })
}

/**
 * The `job_cursors` row where each warehouse snapshot run records its
 * `WAREHOUSE_HISTORY_BACKFILL_TXS`: "off", or the transactions a run.
 * Older rows that are not stored yet arrive only while it is on.
 */
export const historyBackfillCursor = "warehouse-history-backfill"

/** Whether the snapshot's last run read histories back. False when unknown. */
export async function readHistoryBackfill(
  db: ReadDatabase,
  network: string,
): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT value FROM job_cursors WHERE job = ?1 AND network = ?2")
      .bind(historyBackfillCursor, network)
      .first<{ value: string }>()
    return row !== null && row.value !== "off"
  } catch {
    return false
  }
}

export function historyStateStatement(
  db: ReadDatabase,
  network: string,
  wallet: string,
  state: HistoryState,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO wallet_history_state
         (network, wallet, low_ts, low_tx, high_ts, high_tx, complete, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (network, wallet) DO UPDATE SET
         low_ts = excluded.low_ts, low_tx = excluded.low_tx,
         high_ts = excluded.high_ts, high_tx = excluded.high_tx,
         complete = excluded.complete, updated_at = excluded.updated_at`,
    )
    .bind(
      network,
      wallet,
      state.low.ts,
      state.low.tx,
      state.high.ts,
      state.high.tx,
      state.complete ? 1 : 0,
      state.updatedAt,
    )
}

/**
 * The epoch a row falls in by its time, -1 before Epoch 0. A claim names
 * the epoch it pays (the one before); pages are cut by time.
 */
export function rowEpoch(timestamp: number): number {
  return timestamp < EPOCH_ZERO_START
    ? -1
    : epochIndexFor(epochStartOf(timestamp))
}

/** Upserts that leave a row whose price-free content is unchanged alone. */
export async function historyRowStatements(
  db: ReadDatabase,
  network: string,
  wallet: string,
  rows: readonly ActivityRow[],
  nowSeconds: number,
): Promise<D1PreparedStatement[]> {
  return Promise.all(
    rows.map(async (input) => {
      const row = activityRowSchema.parse(input)
      return db
        .prepare(
          `INSERT INTO wallet_activity_rows
             (network, wallet, sort_ts, row_id, tx_hash, epoch, category, body,
              etag, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT (network, wallet, sort_ts, row_id) DO UPDATE SET
             body = excluded.body, etag = excluded.etag,
             category = excluded.category, epoch = excluded.epoch,
             updated_at = excluded.updated_at
           WHERE wallet_activity_rows.etag <> excluded.etag
             -- A claim valued when claimed is never replaced by one
             -- built without the daily prices (a failed price read).
             AND NOT (
               json_extract(wallet_activity_rows.body, '$.atClaim') IS NOT NULL
               AND json_extract(excluded.body, '$.atClaim') IS NULL
             )`,
        )
        .bind(
          network,
          wallet,
          row.timestamp,
          row.id,
          row.txHash,
          rowEpoch(row.timestamp),
          activityCategory(row.type),
          JSON.stringify(row),
          await readModelEtag(row),
          nowSeconds,
        )
    }),
  )
}

/**
 * The partial index of claim rows (migration 0007). Named, because without
 * ANALYZE statistics SQLite keeps to the primary key and reads every row of
 * the wallet. It applies only where the query says `category = 'claims'`
 * as a literal.
 */
const claimsIndex = "INDEXED BY wallet_activity_rows_claims"

/** Every stored claim of a wallet, newest first: `?1` network, `?2` wallet. */
export const historyClaimsSql = `SELECT body FROM wallet_activity_rows ${claimsIndex}
  WHERE network = ?1 AND wallet = ?2 AND category = 'claims'
  ORDER BY sort_ts DESC, row_id DESC`

/** Every stored claim of a wallet, newest first. */
export async function historyClaims(
  db: ReadDatabase,
  network: string,
  wallet: string,
): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare(historyClaimsSql)
    .bind(network, wallet)
    .all<{ body: string }>()
  return results.map((row) => activityRowSchema.parse(JSON.parse(row.body)))
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** Rows a page holds at most, whatever was asked. */
export const historyPageMax = 100

/**
 * Where an archive page starts: before `ts` (the oldest second the
 * document holds, all of which it holds), or before the row `(ts, id)`.
 */
export type HistoryCursor = { ts: number; id: string | null }

const cursorPattern = /^h\.(\d{1,12})(?:\.(0x[0-9a-f]{64}-\d{1,6}))?$/

export function parseHistoryCursor(value: string): HistoryCursor | null {
  const match = cursorPattern.exec(value)
  if (match === null) return null
  return { ts: Number(match[1]), id: match[2] ?? null }
}

export function historyCursor(cursor: HistoryCursor): string {
  return cursor.id === null ? `h.${cursor.ts}` : `h.${cursor.ts}.${cursor.id}`
}

export function isHistoryCursor(value: string): boolean {
  return value.startsWith("h.")
}

const pageRowSchema = z.object({
  body: z.string(),
  sort_ts: z.number().int(),
  row_id: z.string(),
  epoch: z.number().int(),
})

export type HistoryPage = {
  rows: ActivityRow[]
  nextCursor: string | null
  /**
   * The last page of what is stored, older rows are not stored yet, and
   * the backfill is on, so they will be.
   */
  pending: boolean
}

/**
 * Takes at least `limit` rows, then the rest of the last row's epoch, up
 * to `max`: a page ends where an epoch does unless one epoch outgrows it.
 */
export function epochCut(
  epochs: readonly number[],
  limit: number,
  max: number,
): number {
  let take = Math.min(limit, max, epochs.length)
  while (
    take > 0 &&
    take < epochs.length &&
    take < max &&
    epochs[take] === epochs[take - 1]
  ) {
    take += 1
  }
  return take
}

type HistoryPageInput = {
  network: string
  wallet: string
  category: ActivityCategory | undefined
  cursor: HistoryCursor
  limit: number
  state: HistoryState
  /** The backfill is on (`readHistoryBackfill`). */
  backfill: boolean
}

/**
 * The query of one page. The Claims filter goes through the claims index;
 * the others walk the wallet's rows by the primary key from the cursor
 * until the page is full, which reads at most the wallet's rows.
 */
export function historyPageQuery(input: HistoryPageInput): {
  sql: string
  params: (string | number)[]
} {
  const { cursor } = input
  const conditions = ["network = ?1", "wallet = ?2"]
  const params: (string | number)[] = [input.network, input.wallet]
  if (input.category === "claims") {
    conditions.push("category = 'claims'")
  } else if (input.category !== undefined) {
    params.push(input.category)
    conditions.push(`category = ?${params.length}`)
  }
  params.push(cursor.ts)
  const ts = `?${params.length}`
  if (cursor.id === null) {
    conditions.push(`sort_ts < ${ts}`)
  } else {
    params.push(cursor.id)
    conditions.push(
      `(sort_ts < ${ts} OR (sort_ts = ${ts} AND row_id < ?${params.length}))`,
    )
  }
  params.push(historyPageMax + 1)
  return {
    sql: `SELECT body, sort_ts, row_id, epoch FROM wallet_activity_rows
       ${input.category === "claims" ? claimsIndex : ""}
       WHERE ${conditions.join(" AND ")}
       ORDER BY sort_ts DESC, row_id DESC LIMIT ?${params.length}`,
    params,
  }
}

/** One page of the stored history, older than `cursor`. */
export async function readHistoryPage(
  db: ReadDatabase,
  input: HistoryPageInput,
): Promise<HistoryPage> {
  const query = historyPageQuery(input)
  const { results } = await db
    .prepare(query.sql)
    .bind(...query.params)
    .all()
  const found = results.map((row) => pageRowSchema.parse(row))
  const take = epochCut(
    found.map((row) => row.epoch),
    Math.min(input.limit, historyPageMax),
    historyPageMax,
  )
  const page = found.slice(0, take)
  const last = page.at(-1)
  const more = found.length > take && last !== undefined
  return {
    rows: page.map((row) => activityRowSchema.parse(JSON.parse(row.body))),
    nextCursor: more
      ? historyCursor({ ts: last.sort_ts, id: last.row_id })
      : null,
    pending: !more && !input.state.complete && input.backfill,
  }
}

/**
 * Where paging goes after the last page of a wallet's document. `oldest`
 * is the document's oldest row time: every row at that second is in the
 * document (the snapshot leaves a cut second out), so the archive goes on
 * strictly before it. `pending` only where older rows are on their way:
 * a gap the snapshot fills by itself, or older rows while the backfill is
 * on (`backfill`).
 */
export function afterDocument(
  oldest: number | null,
  state: HistoryState | null,
  backfill: boolean,
): { nextCursor: string | null; pending: boolean } {
  if (oldest === null || state === null) {
    return { nextCursor: null, pending: false }
  }
  // Nothing older than the document is stored, and nothing older exists.
  if (state.complete && state.low.ts >= oldest) {
    return { nextCursor: null, pending: false }
  }
  // The stored rows end before the document begins: a gap is being filled.
  if (state.high.ts < oldest) return { nextCursor: null, pending: true }
  if (state.low.ts >= oldest) return { nextCursor: null, pending: backfill }
  return { nextCursor: historyCursor({ ts: oldest, id: null }), pending: false }
}

/**
 * Whether an answer after the document may say `pending`, so the backfill
 * setting is worth reading: the history is not complete.
 */
export function mayBePending(state: HistoryState | null): boolean {
  return state !== null && !state.complete
}
