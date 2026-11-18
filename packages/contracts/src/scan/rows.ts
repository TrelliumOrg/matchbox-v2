import { z } from "zod"
import { addressSchema, decimalStringSchema } from "../common"
import { fixedDecimalSchema } from "../market"
import { txHashSchema, unixSecondsSchema } from "../read-models/primitives"

// Rows of the matchbox-scan D1 database (apps/jobs/scan-migrations), as the
// jobs Worker writes them and the API's /internal/scan routes read them.
// Amounts, weights and token ids are base-unit integers as decimal strings;
// signed changes may start with '-'. Block numbers, log indexes and unix
// seconds are integers. USD is never stored: apply price_daily at read time.

/** Base-unit integer that may be negative (debt and collateral changes). */
export const signedIntegerStringSchema = z
  .string()
  .regex(/^(0|-?[1-9][0-9]*)$/, "Expected an integer string")

/** A base-unit integer left-padded to 40 digits, for numeric TEXT order. */
export const sortKeySchema = z.string().regex(/^[0-9]{40}$/)

/** UTC calendar day, YYYY-MM-DD. */
export const scanDaySchema = z.iso.date()

const blockNumber = z.number().int().nonnegative()
const logIndex = z.number().int().nonnegative()
const nullableAddress = addressSchema.nullable()
const nullableAmount = decimalStringSchema.nullable()
const sqliteBoolean = z.union([z.literal(0), z.literal(1)])

/** JSON column holding {token address: base-unit amount}. */
export const tokenAmountMapSchema = z.record(addressSchema, decimalStringSchema)

/** JSON column holding {voter source: weight} or {voter source: gauge}. */
export const sourceMapSchema = z.record(z.string(), z.string())

/** Other decoded fields of an activity row: decimal strings and flags. */
export const activityExtraSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean()]),
)

export const scanActivityRowSchema = z.object({
  id: z.string().min(1),
  tx_hash: txHashSchema,
  log_index: logIndex,
  block_number: blockNumber,
  timestamp: unixSecondsSchema,
  epoch_start: unixSecondsSchema,
  action_type: z.string().min(1),
  source: z.string().min(1),
  contract_address: addressSchema,
  tx_from: nullableAddress,
  actor: nullableAddress,
  recipient: nullableAddress,
  lock_escrow: nullableAddress,
  token_id: nullableAmount,
  amount: nullableAmount,
  token: nullableAddress,
  gauge: nullableAddress,
  pool: nullableAddress,
  reward_contract: nullableAddress,
  weight: nullableAmount,
  /** JSON text; parse with `activityExtraSchema`. */
  extra: z.string(),
})

export type ScanActivityRow = z.infer<typeof scanActivityRowSchema>

export const scanLockRowSchema = z.object({
  escrow: addressSchema,
  token_id: decimalStringSchema,
  owner: nullableAddress,
  amount: decimalStringSchema,
  amount_key: sortKeySchema,
  unlock_at: z.number().int().nonnegative().nullable(),
  created_at: unixSecondsSchema.nullable(),
  last_extended_at: unixSecondsSchema.nullable(),
  withdrawn_at: unixSecondsSchema.nullable(),
  is_permanent: sqliteBoolean,
  is_withdrawn: sqliteBoolean,
  is_merged: sqliteBoolean,
  merged_into_token_id: nullableAmount,
  merged_at: unixSecondsSchema.nullable(),
  boost: nullableAmount,
  activity_count: z.number().int().nonnegative(),
  updated_at: unixSecondsSchema,
})

export type ScanLockRow = z.infer<typeof scanLockRowSchema>

export const scanLockVoteRowSchema = z.object({
  epoch_start: unixSecondsSchema,
  gauge: addressSchema,
  escrow: addressSchema,
  token_id: decimalStringSchema,
  source: z.string().min(1),
  pool: nullableAddress,
  weight: decimalStringSchema,
  weight_key: sortKeySchema,
  voted_at: unixSecondsSchema,
  carried: sqliteBoolean,
})

export type ScanLockVoteRow = z.infer<typeof scanLockVoteRowSchema>

export const scanIncentiveDepositRowSchema = z.object({
  tx_hash: txHashSchema,
  log_index: logIndex,
  block_number: blockNumber,
  timestamp: unixSecondsSchema,
  epoch_start: unixSecondsSchema,
  tx_from: addressSchema,
  reward_contract: addressSchema,
  /** "Bribe" (incentives) or "Fee" today; other values pass through. */
  reward_type: z.string().min(1),
  voter_source: z.string().min(1),
  gauge: addressSchema,
  pool: nullableAddress,
  token: addressSchema,
  amount: decimalStringSchema,
  depositor: addressSchema,
})

export type ScanIncentiveDepositRow = z.infer<
  typeof scanIncentiveDepositRowSchema
>

export const scanTroveEventRowSchema = z.object({
  tx_hash: txHashSchema,
  log_index: logIndex,
  block_number: blockNumber,
  timestamp: unixSecondsSchema,
  tx_from: addressSchema,
  contract_address: addressSchema,
  /** BORROWER_OPERATIONS or TROVE_MANAGER today; others pass through. */
  emitter: z.string().min(1),
  borrower: addressSchema,
  operation: z.number().int().nonnegative(),
  action: z.string().min(1),
  principal: decimalStringSchema,
  interest: decimalStringSchema,
  coll: decimalStringSchema,
  stake: decimalStringSchema,
  interest_rate: z.number().int().nullable(),
  prev_principal: nullableAmount,
  prev_interest: nullableAmount,
  prev_coll: nullableAmount,
  accrued_interest: nullableAmount,
  debt_change: signedIntegerStringSchema.nullable(),
  coll_change: signedIntegerStringSchema.nullable(),
})

export type ScanTroveEventRow = z.infer<typeof scanTroveEventRowSchema>

export const scanMorphoEventRowSchema = z.object({
  tx_hash: txHashSchema,
  log_index: logIndex,
  block_number: blockNumber,
  timestamp: unixSecondsSchema,
  tx_from: addressSchema,
  market_id: z.string().regex(/^0x[0-9a-f]{64}$/),
  action: z.string().min(1),
  caller: nullableAddress,
  on_behalf: nullableAddress,
  receiver: nullableAddress,
  assets: nullableAmount,
  shares: nullableAmount,
  seized_assets: nullableAmount,
  bad_debt_assets: nullableAmount,
  bad_debt_shares: nullableAmount,
  prev_borrow_rate: nullableAmount,
  fee_shares: nullableAmount,
  fee: nullableAmount,
})

export type ScanMorphoEventRow = z.infer<typeof scanMorphoEventRowSchema>

export const scanEnclaveEventRowSchema = z.object({
  tx_hash: txHashSchema,
  log_index: logIndex,
  ve_btc_token_id: decimalStringSchema,
  block_number: blockNumber,
  timestamp: unixSecondsSchema,
  tx_from: addressSchema,
  contract_address: addressSchema,
  enclave: addressSchema,
  position_id: z.string().nullable(),
  borrower: nullableAddress,
  action: z.string().min(1),
  amount: nullableAmount,
  principal: nullableAmount,
  interest_rate: z.number().int().nullable(),
  originator_fee_rate: z.number().int().nullable(),
  warning_cr: nullableAmount,
  minimum_cr: nullableAmount,
  lock_duration: z.number().int().nullable(),
  other_ve_btc_token_id: nullableAmount,
  /** JSON array of veBTC token ids (decimal strings). */
  pledged_ve_btc: z.string(),
})

export type ScanEnclaveEventRow = z.infer<typeof scanEnclaveEventRowSchema>

export const scanLabelSourceSchema = z.enum(["curated", "contracts"])

export const scanLabelRowSchema = z.object({
  address: addressSchema,
  name: z.string().min(1),
  name_lower: z.string().min(1),
  kind: z.string().min(1),
  /** JSON array of strings. */
  tags: z.string(),
  source: scanLabelSourceSchema,
  pool: nullableAddress,
  gauge: nullableAddress,
  updated_at: unixSecondsSchema,
})

export type ScanLabelRow = z.infer<typeof scanLabelRowSchema>

export const scanEpochTotalsRowSchema = z.object({
  epoch_start: unixSecondsSchema,
  emission: nullableAmount,
  rebase: nullableAmount,
  gauge_rewards: nullableAmount,
  total_supply: nullableAmount,
  vote_transactions: z.number().int().nonnegative(),
  voters: z.number().int().nonnegative(),
  /** JSON {voter source: weight}. */
  vote_weight: z.string(),
  gauges: z.number().int().nonnegative(),
  /** JSON {token: amount}: incentive (Bribe) deposits for the epoch. */
  incentives: z.string(),
  /** JSON {token: amount}: fees passed to voters (Fee deposits). */
  fees: z.string(),
  /** JSON {voter source: gauge}; killed gauges are never the top. */
  top_gauge: z.string(),
  /** JSON {voter source: weight} on killed gauges (also in vote_weight). */
  killed_weight: z.string().default("{}"),
  updated_at: unixSecondsSchema,
})

export type ScanEpochTotalsRow = z.infer<typeof scanEpochTotalsRowSchema>

export const scanGaugeEpochRowSchema = z.object({
  epoch_start: unixSecondsSchema,
  gauge: addressSchema,
  source: z.string().min(1),
  pool: nullableAddress,
  vote_weight: decimalStringSchema,
  weight_key: sortKeySchema,
  voters: z.number().int().nonnegative(),
  incentives: z.string(),
  fees: z.string(),
  /** Null for a killed gauge and for one with deposits but no votes. */
  rank: z.number().int().positive().nullable(),
  /** 1 when the gauge was killed as of the epoch's end. */
  killed: sqliteBoolean.default(0),
  updated_at: unixSecondsSchema,
})

export type ScanGaugeEpochRow = z.infer<typeof scanGaugeEpochRowSchema>

/**
 * A `daily` row. The metrics, their dimensions, units and definitions are
 * the registry in series.ts (`scanMetrics`, `scanMetricNotes`), the one
 * list the jobs writers and the API share. `source` names the writer:
 * 'warehouse' (copy step), 'live' (closing values), 'blockscout',
 * 'earn-pools', 'fees', 'bridge-in', 'bridge-out' (once a day) or
 * 'backfill:<script>'; a backfilled row never replaces another source's.
 */
export const scanDailyRowSchema = z.object({
  metric: z.string().regex(/^[a-z_]+\.[a-z_0-9]+$/),
  dimension: z.string(),
  day: scanDaySchema,
  value: signedIntegerStringSchema,
  source: z.string().min(1),
  /**
   * 1 while the value can still change: a copy-derived row whose day the
   * copy has not read to its end, or a closing value of a day not over.
   */
  partial: sqliteBoolean.default(0),
  updated_at: unixSecondsSchema,
})

export type ScanDailyRow = z.infer<typeof scanDailyRowSchema>

export const scanPriceDailyRowSchema = z.object({
  /** 'btc' or 'mezo'. */
  token: z.string().min(1),
  day: scanDaySchema,
  /** USD per whole token. */
  price: fixedDecimalSchema,
  source: z.string().min(1),
  updated_at: unixSecondsSchema,
})

export type ScanPriceDailyRow = z.infer<typeof scanPriceDailyRowSchema>

export const scanPoolRowSchema = z.object({
  pool: addressSchema,
  token0: addressSchema,
  token1: addressSchema,
  kind: z.enum(["basic", "cl"]),
  /** 'warehouse' (PoolCreated rows) or 'earn-pools' (Mezo's subgraph). */
  source: z.string().min(1),
  updated_at: unixSecondsSchema,
})

export type ScanPoolRow = z.infer<typeof scanPoolRowSchema>

/**
 * The status row (id 1) the copy step rewrites after every run, for readers
 * to tell partial or stale data from complete. Key caches on
 * `data_version`, never on `last_run_at`. Stale data: `halted_tables` not
 * null, or `last_ok_at` old.
 */
export const scanStatusRowSchema = z.object({
  id: z.literal(1),
  /** The last copy run: 'ok', 'skipped' (nothing to copy) or 'failed'. */
  last_run_status: z.enum(["ok", "skipped", "failed"]),
  last_run_at: unixSecondsSchema,
  /**
   * The last ok copy run that left no table halted (a halted table's rows
   * stop at its checkpoint, so the data is not current). Not a data-change
   * signal: aggregates, closing values and daily series also change
   * between ok runs (see data_version).
   */
  last_ok_at: unixSecondsSchema.nullable(),
  consecutive_failures: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  /** Newest activity second copied; copy-derived days end here. */
  copied_through: unixSecondsSchema.nullable(),
  dirty_epochs: z.number().int().nonnegative(),
  dirty_days: z.number().int().nonnegative(),
  /** 1 when no epoch or day waits for its aggregates. */
  aggregates_complete: sqliteBoolean,
  /** 1 once the one-time first fill has been applied. */
  history_filled: sqliteBoolean,
  /** 1 after a warehouse rebuild under a new decoder: re-fill needed. */
  refill_required: sqliteBoolean,
  refill_reason: z.string().nullable(),
  /** Rows the copy could not transform (scan_quarantine). */
  quarantined_rows: z.number().int().nonnegative(),
  /**
   * Rises (never falls) in the same D1 batch as any write that changed a
   * served row: the copied tables, labels, pools, epoch_totals,
   * gauge_epoch, lock_votes, daily and price_daily. Equal values mean
   * identical served rows, so it is the cache key for every scan answer.
   * Absent before scan-migrations 0003 (the new columns all tolerate that).
   */
  data_version: z.number().int().nonnegative().optional(),
  /** Internal to the writer (total_changes() at the batch start). */
  change_mark: z.number().int().nonnegative().optional(),
  /**
   * JSON {table: reason} of the tables halted now (a run quarantined too
   * many of their rows: a systematic failure); null when none. Kept through
   * skipped and failed runs; cleared per table only by a run that reads
   * that table and copies it with no halt. A halted table's rows (for
   * activity also locks, lock votes, pools and the aggregates from them)
   * stop at its checkpoint.
   */
  halted_tables: z.string().nullable().default(null),
  /** Copy runs that failed (or crashed) in the last 24 hours. */
  failed_runs_24h: z.number().int().nonnegative().default(0),
  /**
   * 1 when the last run's rotating Enclave diff covered the whole table
   * (under 1,000 rows); 0 when it rotates over several runs.
   */
  enclave_full_diff: sqliteBoolean.default(1),
  updated_at: unixSecondsSchema,
})

export type ScanStatusRow = z.infer<typeof scanStatusRowSchema>

export const scanQuarantineRowSchema = z.object({
  /** The Neon table: activity, locks, deposits, troves, morpho, enclave. */
  source: z.string().min(1),
  row_key: z.string().min(1),
  reason: z.string(),
  /** The Neon row as JSON (truncated to 1,000 characters). */
  payload: z.string(),
  /** The UTC day of the row (the count check counts it), when known. */
  day: z.string().nullable().default(null),
  first_seen: unixSecondsSchema,
  last_seen: unixSecondsSchema,
})

export type ScanQuarantineRow = z.infer<typeof scanQuarantineRowSchema>
