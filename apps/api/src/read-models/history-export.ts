import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import {
  type ActivityRow,
  activityCategory,
  activityRowSchema,
} from "@matchbox/contracts/read-models"
import {
  type HistoryCsvKind,
  historyCsvLines,
  historyCsvNote,
  historyCsvStart,
} from "@matchbox/contracts/read-models/history-csv"
import { z } from "zod"
import { type ClaimPrices, withClaimValue } from "./claim-prices"
import type { ReadDatabase } from "./store"
import {
  afterDocument,
  type HistoryCursor,
  type HistoryState,
  parseHistoryCursor,
} from "./wallet-history"

// A wallet's whole stored activity, or its claims, as one CSV download
// (`/internal/pro/wallets/{address}/activity.csv` and `rewards.csv`): the
// wallet-activity document's rows, then the stored history's older rows
// (wallet-history.ts), read `exportPageSize` at a time inside the one
// response and written as they come. Claims carry their value when claimed;
// a stored claim written before its day was priced is valued from the
// daily prices on the way out (claim-prices.ts).
//
// Cost for the busiest wallet (about 4,500 rows): the document, the
// history state, the daily prices (about 700 rows) and 9 pages of 500,
// each a range of the primary key (the claims index for rewards): about
// 5,200 rows read in 12 queries. `exportRowCap` bounds any wallet.

/** Activity rows a file holds at most; the file says when it stops. */
export const exportRowCap = 20_000

/** Stored rows read a query. */
export const exportPageSize = 500

/**
 * One visitor's downloads (end-user key from Pro): a file reads up to a
 * few thousand D1 rows, so a few a minute is plenty.
 */
export const exportEndUserPolicy: RateLimitPolicy = {
  perMinute: 6,
  perDay: 200,
}

/** Every visitor Pro sends without an end-user key, together. */
export const exportAnonymousPolicy: RateLimitPolicy = {
  perMinute: 60,
  perDay: 3_000,
}

const pageRowSchema = z.object({
  body: z.string(),
  sort_ts: z.number().int(),
  row_id: z.string(),
})

/** One page of stored rows older than `cursor`, newest first. */
export function exportPageQuery(input: {
  network: string
  wallet: string
  kind: HistoryCsvKind
  cursor: HistoryCursor
  limit: number
}): { sql: string; params: (string | number)[] } {
  const claims = input.kind === "rewards"
  const params: (string | number)[] = [
    input.network,
    input.wallet,
    input.cursor.ts,
  ]
  let before = "sort_ts < ?3"
  if (input.cursor.id !== null) {
    params.push(input.cursor.id)
    before = "(sort_ts < ?3 OR (sort_ts = ?3 AND row_id < ?4))"
  }
  params.push(input.limit)
  return {
    // The claims index applies only with the literal category (migration
    // 0007); the rest is a range of the primary key.
    sql: `SELECT body, sort_ts, row_id FROM wallet_activity_rows
      ${claims ? "INDEXED BY wallet_activity_rows_claims" : ""}
      WHERE network = ?1 AND wallet = ?2
        ${claims ? "AND category = 'claims'" : ""}
        AND ${before}
      ORDER BY sort_ts DESC, row_id DESC LIMIT ?${params.length}`,
    params,
  }
}

export type ExportInput = {
  db: ReadDatabase
  network: string
  wallet: string
  kind: HistoryCsvKind
  /** The wallet-activity document's rows, newest first. */
  documentRows: readonly ActivityRow[]
  state: HistoryState | null
  /** The backfill is on (`readHistoryBackfill`). */
  backfill: boolean
  /** Null when they could not be read: pending claims say so. */
  prices: ClaimPrices | null
  /** When the file is made, unix seconds: an old estimate is pending. */
  nowSeconds: number
  /** Overrides for tests. */
  cap?: number
  pageSize?: number
}

/** What a finished file holds, for logs and tests. */
export type ExportSummary = {
  rows: number
  queries: number
  note: "pending" | "capped" | null
}

function fits(row: ActivityRow, kind: HistoryCsvKind): boolean {
  return kind === "activity" || activityCategory(row.type) === "claims"
}

/**
 * The file, a chunk at a time: the header and the document's rows, then
 * a page of stored rows each pull. A failed page read errors the stream,
 * which the client sees as a broken download, never as a short file
 * passed off as whole.
 */
export function historyCsvStream(
  input: ExportInput,
  onDone?: (summary: ExportSummary) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const cap = input.cap ?? exportRowCap
  const pageSize = input.pageSize ?? exportPageSize
  const value = (row: ActivityRow): ActivityRow =>
    input.prices === null ? row : withClaimValue(row, input.prices)
  let rows = 0
  let queries = 0
  let started = false
  const after = afterDocument(
    input.documentRows.at(-1)?.timestamp ?? null,
    input.state,
    input.backfill,
  )
  let cursor: HistoryCursor | null =
    after.nextCursor === null ? null : parseHistoryCursor(after.nextCursor)
  // Older rows exist that are not stored yet: the file says so at the end.
  const pending =
    after.pending ||
    (input.state !== null && !input.state.complete && input.backfill)
  const finish = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    note: ExportSummary["note"],
  ): void => {
    if (note !== null) {
      controller.enqueue(
        encoder.encode(
          historyCsvNote(
            note === "capped" ? { kind: "capped", rows: cap } : { kind: note },
          ),
        ),
      )
    }
    controller.close()
    onDone?.({ rows, queries, note })
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true
        let text = historyCsvStart
        for (const row of input.documentRows) {
          if (!fits(row, input.kind)) continue
          if (rows >= cap) {
            controller.enqueue(encoder.encode(text))
            finish(controller, "capped")
            return
          }
          text += historyCsvLines(value(row), input.nowSeconds)
          rows += 1
        }
        controller.enqueue(encoder.encode(text))
        if (cursor === null) finish(controller, pending ? "pending" : null)
        return
      }
      if (cursor === null) return
      const limit = Math.min(pageSize, cap - rows + 1)
      const query = exportPageQuery({
        network: input.network,
        wallet: input.wallet,
        kind: input.kind,
        cursor,
        limit,
      })
      queries += 1
      const { results } = await input.db
        .prepare(query.sql)
        .bind(...query.params)
        .all()
      const page = results.map((row) => pageRowSchema.parse(row))
      let text = ""
      for (const row of page) {
        if (rows >= cap) {
          controller.enqueue(encoder.encode(text))
          finish(controller, "capped")
          return
        }
        text += historyCsvLines(
          value(activityRowSchema.parse(JSON.parse(row.body))),
          input.nowSeconds,
        )
        rows += 1
      }
      if (text !== "") controller.enqueue(encoder.encode(text))
      const last = page.at(-1)
      if (page.length < limit || last === undefined) {
        cursor = null
        finish(controller, pending ? "pending" : null)
        return
      }
      cursor = { ts: last.sort_ts, id: last.row_id }
    },
  })
}
