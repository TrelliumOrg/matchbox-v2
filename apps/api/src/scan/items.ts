import {
  activityExtraSchema,
  type ScanActivityItem,
  type ScanEnclaveEventItem,
  type ScanEpochItem,
  type ScanGaugeEpochItem,
  type ScanLabelItem,
  type ScanLockItem,
  type ScanLockVoteItem,
  scanActivityRowSchema,
  scanEnclaveEventRowSchema,
  scanEpochTotalsRowSchema,
  scanGaugeEpochRowSchema,
  scanIncentiveDepositRowSchema,
  scanLabelRowSchema,
  scanLockRowSchema,
  scanLockVoteRowSchema,
  scanMorphoEventRowSchema,
  scanTroveEventRowSchema,
  sourceMapSchema,
  tokenAmountMapSchema,
} from "@matchbox/contracts/scan"
import { EPOCH_SECONDS } from "@matchbox/domain"
import { z } from "zod"
import type { ScanQuery } from "./queries"

// D1 rows to /internal/scan items: every row is validated with its
// @matchbox/contracts/scan schema, JSON columns are parsed and validated,
// 0/1 flags become booleans and sort keys are dropped. A row that fails is
// never served wrong: lists skip it (logged with its table and key, and
// counted in the page's `meta.skipped`); a single-row read is a 500.

export class RowShapeError extends Error {
  constructor(readonly table: string) {
    super(`A ${table} row failed its schema`)
    this.name = "RowShapeError"
  }
}

/** Primary-key columns per table, for logging a skipped row. */
const primaryKeys: Record<string, readonly string[]> = {
  activity: ["id"],
  locks: ["escrow", "token_id"],
  lock_votes: ["epoch_start", "gauge", "escrow", "token_id"],
  incentive_deposits: ["tx_hash", "log_index"],
  trove_events: ["tx_hash", "log_index"],
  morpho_events: ["tx_hash", "log_index"],
  enclave_events: ["tx_hash", "log_index", "ve_btc_token_id"],
  labels: ["address"],
  epoch_totals: ["epoch_start"],
  gauge_epoch: ["gauge", "epoch_start"],
  morpho_markets: ["market_id"],
  morpho_positions: ["market_id", "account"],
  troves: ["owner"],
}

/** A failed row's primary key, as far as its columns can be read. */
export function rowKeyOf(table: string, raw: unknown): Record<string, unknown> {
  const columns = primaryKeys[table] ?? []
  const row =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  return Object.fromEntries(columns.map((column) => [column, row[column]]))
}

function parse<T>(schema: z.ZodType<T>, value: unknown, table: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RowShapeError(table)
  return parsed.data
}

function json<T>(schema: z.ZodType<T>, text: string, table: string): T {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new RowShapeError(table)
  }
  return parse(schema, raw, table)
}

/** Runs one registry statement and returns its rows unvalidated. */
export async function rowsOf(
  db: D1Database,
  query: ScanQuery,
  binds: readonly unknown[],
): Promise<unknown[]> {
  const result = await db
    .prepare(query.sql)
    .bind(...binds)
    .all()
  return result.results
}

export async function firstOf(
  db: D1Database,
  query: ScanQuery,
  binds: readonly unknown[],
): Promise<unknown | null> {
  return (await rowsOf(db, query, binds))[0] ?? null
}

const ridSchema = z.object({ rid: z.number().int().positive() })

export type ActivityWithRowid = { item: ScanActivityItem; rid: number }

export function activityItem(row: unknown): ActivityWithRowid {
  const { rid } = parse(ridSchema, row, "activity")
  const parsed = parse(scanActivityRowSchema, row, "activity")
  return {
    rid,
    item: {
      ...parsed,
      extra: json(activityExtraSchema, parsed.extra, "activity"),
    },
  }
}

/**
 * A live lock whose end is 0 is permanent (auto max): the escrows keep
 * `locked.end` at 0 only for a permanent lock, and a Deposit or Merge into
 * one carries that 0. The flag alone misses it on a warehouse built with
 * decoder v2, which never saw the LockPermanent of a lock made permanent
 * before the explorer's start block (7,739,500); `order=unlock` already
 * reads unlock_at 0 as permanent.
 */
function permanent(parsed: {
  is_permanent: number
  is_withdrawn: number
  is_merged: number
  unlock_at: number | null
}): boolean {
  if (parsed.is_permanent === 1) return true
  return (
    parsed.unlock_at === 0 &&
    parsed.is_withdrawn === 0 &&
    parsed.is_merged === 0
  )
}

export function lockItem(row: unknown): ScanLockItem & { amount_key: string } {
  const parsed = parse(scanLockRowSchema, row, "locks")
  return {
    ...parsed,
    is_permanent: permanent(parsed),
    is_withdrawn: parsed.is_withdrawn === 1,
    is_merged: parsed.is_merged === 1,
  }
}

/** Drops the sort key from a lock before it is served. */
export function servedLock(
  lock: ScanLockItem & { amount_key: string },
): ScanLockItem {
  const { amount_key: _key, ...rest } = lock
  return rest
}

export function voteItem(
  row: unknown,
): ScanLockVoteItem & { weight_key: string } {
  const parsed = parse(scanLockVoteRowSchema, row, "lock_votes")
  return { ...parsed, carried: parsed.carried === 1 }
}

export function servedVote(
  vote: ScanLockVoteItem & { weight_key: string },
): ScanLockVoteItem {
  const { weight_key: _key, ...rest } = vote
  return rest
}

export function depositItem(row: unknown) {
  return parse(scanIncentiveDepositRowSchema, row, "incentive_deposits")
}

export function gaugeEpochItem(row: unknown): ScanGaugeEpochItem {
  const parsed = parse(scanGaugeEpochRowSchema, row, "gauge_epoch")
  const { weight_key: _key, ...rest } = parsed
  return {
    ...rest,
    incentives: json(tokenAmountMapSchema, parsed.incentives, "gauge_epoch"),
    fees: json(tokenAmountMapSchema, parsed.fees, "gauge_epoch"),
  }
}

export function epochItem(
  row: unknown,
  nowSeconds: number,
  dirtyEpochs: ReadonlySet<string>,
): ScanEpochItem {
  const parsed = parse(scanEpochTotalsRowSchema, row, "epoch_totals")
  return {
    ...parsed,
    vote_weight: json(sourceMapSchema, parsed.vote_weight, "epoch_totals"),
    incentives: json(tokenAmountMapSchema, parsed.incentives, "epoch_totals"),
    fees: json(tokenAmountMapSchema, parsed.fees, "epoch_totals"),
    top_gauge: json(sourceMapSchema, parsed.top_gauge, "epoch_totals"),
    killed_weight: json(sourceMapSchema, parsed.killed_weight, "epoch_totals"),
    sealed: parsed.epoch_start + EPOCH_SECONDS <= nowSeconds,
    complete: !dirtyEpochs.has(String(parsed.epoch_start)),
  }
}

export function troveEventItem(row: unknown) {
  return parse(scanTroveEventRowSchema, row, "trove_events")
}

export function morphoEventItem(row: unknown) {
  return parse(scanMorphoEventRowSchema, row, "morpho_events")
}

export function enclaveItem(row: unknown): ScanEnclaveEventItem {
  const parsed = parse(scanEnclaveEventRowSchema, row, "enclave_events")
  return {
    ...parsed,
    pledged_ve_btc: json(
      z.array(z.string().regex(/^(0|[1-9][0-9]*)$/)),
      parsed.pledged_ve_btc,
      "enclave_events",
    ),
  }
}

export function labelItem(row: unknown): ScanLabelItem {
  const parsed = parse(scanLabelRowSchema, row, "labels")
  const { name_lower: _lower, ...rest } = parsed
  return { ...rest, tags: json(z.array(z.string()), parsed.tags, "labels") }
}
