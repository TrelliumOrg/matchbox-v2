import { z } from "zod"
import type { QueryRunner } from "../warehouse/reader"

// The scan copy step's Neon reads: every table past its own checkpoint, in
// one READ ONLY transaction (one HTTP round trip), each capped at a row
// count. A capped read always ends on a whole block (or second, for
// activity), so the checkpoint never splits a block's rows: the bound is the
// cap-th row's position, and every row at that position is included.
// Numeric columns are cast to text in SQL; no amount passes through a JS
// number.

const network = "mezo"

const text = z.string()
const nullableText = z.string().nullable()
const integerText = z.string().regex(/^-?[0-9]+$/)
const nullableInteger = integerText.nullable()

export const neonActivityRowSchema = z.object({
  id: text,
  tx_hash: text,
  tx_from: nullableText,
  log_index: integerText,
  block_number: integerText,
  timestamp: integerText,
  action_type: text,
  source: text,
  contract_address: text,
  actor: nullableText,
  recipient: nullableText,
  token_id: nullableInteger,
  amount: nullableInteger,
  token: nullableText,
  /** The event's gauge column (PoolsVoter puts the pool here). */
  raw_gauge: nullableText,
  /** The gauge, with a PoolsVoter pool mapped to its gauge. */
  gauge: nullableText,
  pool: nullableText,
  reward_contract: nullableText,
  weight: nullableInteger,
  /** json_strip_nulls of the other decoded fields, numerics as text. */
  extra: text,
})

export type NeonActivityRow = z.infer<typeof neonActivityRowSchema>

export const neonLockRowSchema = z.object({
  contract_address: text,
  token_id: integerText,
  owner: nullableText,
  amount: integerText,
  unlock_at: nullableInteger,
  created_at: nullableInteger,
  last_extended_at: nullableInteger,
  withdrawn_at: nullableInteger,
  is_permanent: z.boolean(),
  is_withdrawn: z.boolean(),
  is_merged: z.boolean(),
  merged_into_token_id: nullableInteger,
  merged_at: nullableInteger,
  boost: nullableInteger,
  activity_count: integerText,
})

export type NeonLockRow = z.infer<typeof neonLockRowSchema>

export const neonDepositRowSchema = z.object({
  tx_hash: text,
  log_index: integerText,
  block_number: integerText,
  timestamp: integerText,
  tx_from: text,
  reward_contract: text,
  /** "Bribe" or "Fee" today; any other value passes through. */
  reward_type: text,
  voter_source: text,
  gauge: text,
  pool: nullableText,
  token: text,
  epoch_start: integerText,
  amount: integerText,
  depositor: text,
})

export type NeonDepositRow = z.infer<typeof neonDepositRowSchema>

export const neonTroveRowSchema = z.object({
  tx_hash: text,
  log_index: integerText,
  block_number: integerText,
  timestamp: integerText,
  tx_from: text,
  contract_address: text,
  /** BORROWER_OPERATIONS or TROVE_MANAGER today; others pass through. */
  emitter: text,
  borrower: text,
  operation: z.number().int(),
  action: text,
  principal: integerText,
  interest: integerText,
  coll: integerText,
  stake: integerText,
  interest_rate: z.number().int().nullable(),
  prev_principal: nullableInteger,
  prev_interest: nullableInteger,
  prev_coll: nullableInteger,
  accrued_interest: nullableInteger,
  debt_change: nullableInteger,
  coll_change: nullableInteger,
})

export type NeonTroveRow = z.infer<typeof neonTroveRowSchema>

export const neonMorphoRowSchema = z.object({
  tx_hash: text,
  log_index: integerText,
  block_number: integerText,
  timestamp: integerText,
  tx_from: text,
  market_id: text,
  action: text,
  caller: nullableText,
  on_behalf: nullableText,
  receiver: nullableText,
  assets: nullableInteger,
  shares: nullableInteger,
  seized_assets: nullableInteger,
  bad_debt_assets: nullableInteger,
  bad_debt_shares: nullableInteger,
  prev_borrow_rate: nullableInteger,
  fee_shares: nullableInteger,
  fee: nullableInteger,
})

export type NeonMorphoRow = z.infer<typeof neonMorphoRowSchema>

export const neonEnclaveRowSchema = z.object({
  tx_hash: text,
  log_index: integerText,
  ve_btc_token_id: integerText,
  block_number: integerText,
  timestamp: integerText,
  tx_from: text,
  contract_address: text,
  enclave: text,
  position_id: nullableText,
  borrower: nullableText,
  action: text,
  amount: nullableInteger,
  principal: nullableInteger,
  interest_rate: z.number().int().nullable(),
  originator_fee_rate: z.number().int().nullable(),
  warning_cr: nullableInteger,
  minimum_cr: nullableInteger,
  lock_duration: nullableInteger,
  other_ve_btc_token_id: nullableInteger,
  /** JSON array text of decimal strings. */
  pledged_ve_btc: text,
})

export type NeonEnclaveRow = z.infer<typeof neonEnclaveRowSchema>

export const neonContractRowSchema = z.object({
  address: text,
  kind: text,
  template: text,
  pool: nullableText,
  gauge: nullableText,
  /** The pool's tokens and type, from its PoolCreated row, when known. */
  token0: nullableText,
  token1: nullableText,
  pool_type: nullableText,
  /** Microsecond-precise ISO text, the contracts checkpoint. */
  discovered_at: text,
})

export type NeonContractRow = z.infer<typeof neonContractRowSchema>

/** Where each table's copy stopped. Positions are decimal strings. */
export type ScanCheckpoints = {
  /** Last copied activity second (activity_events.timestamp). */
  activity: string
  deposits: string
  troves: string
  morpho: string
  enclave: string
  /** Last copied contract, "<discovered_at ISO>|<address>"; "" before. */
  contracts: string
}

export type ScanTable = keyof ScanCheckpoints

export const scanTables: readonly ScanTable[] = [
  "activity",
  "deposits",
  "troves",
  "morpho",
  "enclave",
  "contracts",
]

export type ScanReadPlan = {
  checkpoints: ScanCheckpoints
  /** Rows per table per run, before completing the last block. */
  caps: Record<ScanTable, number>
  /** Tables to read; the others are skipped (their stream did not move). */
  tables: ReadonlySet<ScanTable>
  /**
   * The rotating lock sweep: the next `rows` lock positions after `after`
   * in primary key order, so every lock is re-read every few hours whether
   * or not an activity row named it (boost updates have none).
   */
  lockSweep: { after: string; rows: number } | null
  /** Re-read every contract (once a day): catches updated rows. */
  fullContracts: boolean
  /**
   * The rotating Enclave diff: the next `rows` Enclave rows after `after`
   * ("block|log|token id", "" from the start) in key order. Rows inserted
   * behind the checkpoint (an Enclave granted later has its earlier logs
   * back-filled) or rewritten are caught within ceil(N / rows) runs; a
   * table under `rows` is diffed whole every run.
   */
  enclaveSweep?: { after: string; rows: number } | null
  /** Tables the day counts cover (default: every counted table). */
  countTables?: readonly string[]
  /**
   * Once a day: per-day row counts of the copied tables from this UTC day
   * start on, for the count check against SCAN_DB. Null on other runs.
   */
  countsFrom?: number | null
}

/** A warehouse row that failed its schema: kept out, recorded, skipped. */
export type RejectedRow = {
  source: string
  rowKey: string
  reason: string
  payload: string
  /** Its timestamp, for the count check's quarantined-per-day figure. */
  timestamp: number | null
  /** Its position (timestamp or block), so the checkpoint still advances. */
  position: string | null
}

/** Rows per UTC day in a Neon table (the daily count check). */
export type DayCount = { table: string; dayStart: number; rows: number }

export type ScanRows = {
  activity: NeonActivityRow[]
  locks: NeonLockRow[]
  deposits: NeonDepositRow[]
  troves: NeonTroveRow[]
  morpho: NeonMorphoRow[]
  enclave: NeonEnclaveRow[]
  /** Contracts past the checkpoint (or all, on the daily full read). */
  contracts: NeonContractRow[]
  /** Contracts in the hour behind the checkpoint, re-read for repairs. */
  recheckedContracts: NeonContractRow[]
  /** Lock positions from the rotating sweep, in primary key order. */
  sweptLocks: NeonLockRow[]
  /** The sweep's last primary key; null when it wrapped or did not run. */
  sweepAfter: string | null
  /** Enclave rows from the rotating diff (never move the checkpoint). */
  sweptEnclave: NeonEnclaveRow[]
  /** The Enclave sweep's last key; null when it wrapped or did not run. */
  enclaveSweepAfter: string | null
  /**
   * "full" when this run's sweep read the whole Enclave table, "sweep"
   * when it read part of it, "window" when only rows past the checkpoint
   * were read, "none" when Enclave was not read.
   */
  enclaveMode: "full" | "sweep" | "window" | "none"
  /**
   * Rows each table's window returned past its checkpoint (the overlap
   * re-reads and full diffs excluded), for the cap.
   */
  windowCounts: Record<ScanTable, number>
  /** Rows that failed their Neon schema. */
  rejected: RejectedRow[]
  /** Per-day counts when the plan asked for them. */
  dayCounts: DayCount[]
}

export type ScanWarehouseReader = {
  read(plan: ScanReadPlan): Promise<ScanRows>
}

const maxBigint = "9223372036854775807"

/** The highest position a capped read may include. */
function boundSql(table: string, column: string, cap: string): string {
  return `coalesce((SELECT ${column} FROM ${table}
    WHERE network = $1 AND ${column} > $2::bigint
    ORDER BY ${column} LIMIT 1 OFFSET ${cap}), ${maxBigint})`
}

const activityExtra = `json_strip_nulls(json_build_object(
    'boost_context', e.boost_context,
    'duration', e.duration::text,
    'prev_amount', e.prev_amount::text,
    'prev_duration', e.prev_duration::text,
    'prev_is_permanent', e.prev_is_permanent,
    'post_amount', e.post_amount::text,
    'post_duration', e.post_duration::text,
    'post_is_permanent', e.post_is_permanent,
    'merge_source_token_id', e.merge_source_token_id::text,
    'merge_dest_token_id', e.merge_dest_token_id::text,
    'merge_dest_prev_amount', e.merge_dest_prev_amount::text,
    'merge_dest_prev_duration', e.merge_dest_prev_duration::text,
    'merge_dest_prev_is_permanent', e.merge_dest_prev_is_permanent,
    'reward_type', e.reward_type,
    'metadata', e.metadata,
    'boostable_token_id', e.boostable_token_id::text,
    'boost', e.boost::text,
    'total_weight', e.total_weight::text,
    'poke_method', e.poke_method,
    'period', e.period::text,
    'new_period', e.new_period::text,
    'first_recipient_amount', e.first_recipient_amount::text,
    'second_recipient_amount', e.second_recipient_amount::text,
    'old_rate', e.old_rate::text,
    'new_rate', e.new_rate::text,
    'emission', e.emission::text,
    'rebase', e.rebase::text,
    'rewards', e.rewards::text,
    'total_supply', e.total_supply::text,
    'epoch_index', e.epoch_index::text,
    'epoch_start', e.epoch_start::text,
    'epoch_end', e.epoch_end::text,
    'distribution_id', e.distribution_id::text,
    'merkle_root', e.merkle_root
  ))::text`

/** Activity rows past the checkpoint, bounded to whole seconds. */
function activitySelect(where: string, tail: string): string {
  return `WITH pools AS (
             SELECT DISTINCT pool, gauge FROM matchbox.contracts
             WHERE network = $1 AND kind = 'gauge'
               AND pool IS NOT NULL AND gauge IS NOT NULL
           ),
           bound AS (SELECT ${boundSql("matchbox.activity_events", "timestamp", "$3")} AS ts)
           SELECT e.id, e.tx_hash, e.tx_from, e.log_index::text,
             e.block_number::text, e.timestamp::text, e.action_type, e.source,
             e.contract_address, e.actor, e.recipient, e.token_id::text,
             e.amount::text, e.token, e.gauge AS raw_gauge,
             coalesce(p.gauge, e.gauge) AS gauge,
             coalesce(e.pool, CASE WHEN p.gauge IS NOT NULL THEN e.gauge END) AS pool,
             e.reward_contract, e.weight::text, ${activityExtra} AS extra
           FROM matchbox.activity_events e
           CROSS JOIN bound
           LEFT JOIN pools p ON p.pool = e.gauge
           WHERE e.network = $1 AND ${where}
           ORDER BY e.block_number, e.log_index, e.id${tail}`
}

export function activityQuery(checkpoint: string, cap: number) {
  return {
    text: activitySelect(
      "e.timestamp > $2::bigint AND e.timestamp <= bound.ts",
      "",
    ),
    params: [network, checkpoint, cap - 1],
  }
}

/** Seconds of activity re-read behind the checkpoint every run. */
export const activityOverlapSeconds = 300
/** Blocks re-read behind the block-windowed checkpoints every run. */
export const blockOverlap = 100
/** Most rows one overlap re-read returns. */
export const overlapRows = 1_000

/**
 * Activity rows in the overlap behind the checkpoint. A second whose rows
 * committed after the copy read it (two blocks with one timestamp across
 * an indexer tick) is caught here; unchanged rows cost no writes, and the
 * window replays in (block, log) order together with the new rows.
 */
export function activityRecheckQuery(checkpoint: string) {
  return {
    text: activitySelect(
      `e.timestamp > $2::bigint - ${activityOverlapSeconds} AND e.timestamp <= $2::bigint`,
      ` LIMIT ${overlapRows}`,
    ),
    params: [network, checkpoint, 0],
  }
}

function blockRecheck(table: string, columns: string, order: string) {
  return function query(checkpoint: string) {
    return {
      text: `SELECT ${columns} FROM ${table}
             WHERE network = $1 AND block_number > $2::bigint - ${blockOverlap}
               AND block_number <= $2::bigint
             ORDER BY ${order} LIMIT ${overlapRows}`,
      params: [network, checkpoint],
    }
  }
}

/** The escrows whose lock positions the copy reads. */
const escrows = [
  "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279", // veBTC
  "0xb90fdad3dfd180458d62cc6acedc983d78e20122", // veMEZO
]

const lockColumns = `contract_address, token_id::text, owner, amount::text,
  unlock_at::text, created_at::text, last_extended_at::text,
  withdrawn_at::text, is_permanent, is_withdrawn, is_merged,
  merged_into_token_id::text, merged_at::text, boost::text,
  activity_count::text`

/**
 * Lock positions touched by the same activity window: every token id the
 * rows name (lock, merge source and destination, boosted veBTC), on either
 * escrow, looked up by primary key (id = escrow || '-' || token id).
 */
export function touchedLocksQuery(checkpoint: string, cap: number) {
  return {
    text: `WITH bound AS (SELECT ${boundSql("matchbox.activity_events", "timestamp", "$3")} AS ts),
           touched AS (
             SELECT DISTINCT t.id FROM matchbox.activity_events e
             CROSS JOIN bound
             CROSS JOIN LATERAL unnest(ARRAY[e.token_id,
               e.merge_source_token_id, e.merge_dest_token_id,
               e.boostable_token_id]) AS t(id)
             WHERE e.network = $1 AND e.timestamp > $2::bigint
               AND e.timestamp <= bound.ts AND t.id IS NOT NULL
           )
           SELECT ${lockColumns}
           FROM matchbox.lock_positions
           WHERE network = $1 AND id IN (
             SELECT escrow || '-' || t.id::text
             FROM touched t CROSS JOIN unnest($4::text[]) AS escrow
           )
           ORDER BY contract_address, token_id`,
    params: [network, checkpoint, cap - 1, escrows],
  }
}

/** The next lock positions after `after` by primary key (the sweep). */
export function lockSweepQuery(after: string, rows: number) {
  return {
    text: `SELECT ${lockColumns}, id AS sweep_id
           FROM matchbox.lock_positions
           WHERE network = $1 AND id > $2
           ORDER BY id LIMIT $3`,
    params: [network, after, rows],
  }
}

function blockWindow(table: string, columns: string, order: string) {
  return function query(checkpoint: string, cap: number) {
    return {
      text: `SELECT ${columns} FROM ${table}
             WHERE network = $1 AND block_number > $2::bigint
               AND block_number <= ${boundSql(table, "block_number", "$3")}
             ORDER BY ${order}`,
      params: [network, checkpoint, cap - 1],
    }
  }
}

const depositsArgs = [
  "matchbox.reward_deposits",
  `tx_hash, log_index::text, block_number::text, timestamp::text, tx_from,
   reward_contract, reward_type, voter_source, gauge, pool, token,
   epoch_start::text, amount::text, depositor`,
  "block_number, log_index",
] as const

export const depositsQuery = blockWindow(...depositsArgs)
/** The overlap re-read behind the deposits checkpoint. */
export const depositsRecheckQuery = blockRecheck(...depositsArgs)

const trovesArgs = [
  "matchbox.trove_updates",
  `tx_hash, log_index::text, block_number::text, timestamp::text, tx_from,
   contract_address, emitter, borrower, operation::int AS operation, action,
   principal::text, interest::text, coll::text, stake::text, interest_rate,
   prev_principal::text, prev_interest::text, prev_coll::text,
   accrued_interest::text, debt_change::text, coll_change::text`,
  "block_number, log_index",
] as const

export const trovesQuery = blockWindow(...trovesArgs)
/** The overlap re-read behind the troves checkpoint. */
export const trovesRecheckQuery = blockRecheck(...trovesArgs)

const morphoArgs = [
  "matchbox.morpho_events",
  `tx_hash, log_index::text, block_number::text, timestamp::text, tx_from,
   market_id, action, caller, on_behalf, receiver, assets::text,
   shares::text, seized_assets::text, bad_debt_assets::text,
   bad_debt_shares::text, prev_borrow_rate::text, fee_shares::text,
   fee::text`,
  "block_number, log_index",
] as const

export const morphoQuery = blockWindow(...morphoArgs)
/** The overlap re-read behind the Morpho checkpoint. */
export const morphoRecheckQuery = blockRecheck(...morphoArgs)

const enclaveColumns = `tx_hash, log_index::text, ve_btc_token_id::text, block_number::text,
   timestamp::text, tx_from, contract_address, enclave, position_id, borrower,
   action, amount::text, principal::text, interest_rate, originator_fee_rate,
   warning_cr::text, minimum_cr::text, lock_duration::text,
   other_ve_btc_token_id::text,
   array_to_json(pledged_ve_btc::text[])::text AS pledged_ve_btc`

export const enclaveQuery = blockWindow(
  "matchbox.enclave_events",
  enclaveColumns,
  "block_number, log_index, ve_btc_token_id",
)

/**
 * Enclave rows re-read per run by the rotating diff, in key order: a table
 * this small is diffed whole every run, a larger one every ceil(N / rows)
 * runs, so there is no size past which rows behind the checkpoint are
 * missed.
 */
export const enclaveSweepRows = 1_000

/** The sweep key of an Enclave row: "block|log|token id". */
export function enclaveSweepKey(row: {
  block_number: string
  log_index: string
  ve_btc_token_id: string
}): string {
  return `${row.block_number}|${row.log_index}|${row.ve_btc_token_id}`
}

export function enclaveSweepQuery(after: string, rows: number) {
  const [block = "-1", log = "-1", token = "-1"] =
    after === "" ? [] : after.split("|")
  return {
    text: `SELECT ${enclaveColumns} FROM matchbox.enclave_events
           WHERE network = $1
             AND (block_number, log_index, ve_btc_token_id)
               > ($2::numeric, $3::numeric, $4::numeric)
           ORDER BY block_number, log_index, ve_btc_token_id
           LIMIT $5`,
    params: [network, block, log, token, rows],
  }
}

/** Seconds of commit skew absorbed by re-reading recent contracts. */
export const contractsLookbackSeconds = 3_600

const contractFrom = `c.address, c.kind, c.template, c.pool, c.gauge,
  pc.token AS token0, pc.recipient AS token1, pc.metadata AS pool_type,
  to_char(c.discovered_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS discovered_at
  FROM matchbox.contracts c
  LEFT JOIN LATERAL (
    SELECT token, recipient, metadata FROM matchbox.activity_events
    WHERE network = $1 AND action_type = 'POOL_CREATED'
      AND pool = coalesce(c.pool, c.address)
    LIMIT 1
  ) pc ON true`

/**
 * Contracts discovered after a checkpoint ("<discovered_at>|<address>", ""
 * for the start), with their pool's tokens. One transaction registers many
 * contracts with the same discovered_at, so the address breaks ties.
 */
export function contractsQuery(checkpoint: string, cap: number) {
  const [at = "", address = ""] = checkpoint.split("|")
  return {
    text: `SELECT ${contractFrom}
           WHERE c.network = $1
             AND (c.discovered_at, c.address) >
               (coalesce(nullif($2, '')::timestamptz, '-infinity'), $3)
           ORDER BY c.discovered_at, c.address
           LIMIT $4`,
    params: [network, at, address, cap],
  }
}

/** The ISO time an hour before a contracts checkpoint, "" for none. */
export function contractsLookback(checkpoint: string): string {
  const [at = ""] = checkpoint.split("|")
  if (at === "") return ""
  const parsed = Date.parse(at)
  if (Number.isNaN(parsed)) return ""
  return new Date(parsed - contractsLookbackSeconds * 1000).toISOString()
}

/** Contracts re-checked behind the checkpoint per run, at most. */
export const contractsRecheckRows = 500

/**
 * Contracts registered in the hour before the checkpoint, re-read every
 * run apart from the capped forward read. discovered_at is the
 * registering transaction's start time, so one that committed after a
 * later one can carry an earlier time; unchanged rows cost no writes.
 */
export function contractsRecheckQuery(checkpoint: string) {
  const [at = "", address = ""] = checkpoint.split("|")
  return {
    text: `SELECT ${contractFrom}
           WHERE c.network = $1 AND $2 <> ''
             AND c.discovered_at >= nullif($2, '')::timestamptz - interval '${contractsLookbackSeconds} seconds'
             AND (c.discovered_at, c.address) <=
               (nullif($2, '')::timestamptz, $3)
           ORDER BY c.discovered_at, c.address
           LIMIT $4`,
    params: [network, at, address, contractsRecheckRows],
  }
}

/** Every contract, for the daily full diff (pool and gauge links set later). */
export function allContractsQuery(cap: number) {
  return {
    text: `SELECT ${contractFrom}
           WHERE c.network = $1
           ORDER BY c.discovered_at, c.address
           LIMIT $2`,
    params: [network, cap],
  }
}

/**
 * Every row of a result, each validated on its own: one malformed row (a
 * NULL where a value is required, an amount printed "12.0") is rejected
 * with its key and reason instead of failing the whole read, and the copy
 * goes on with the rest.
 */
function lenient<Schema extends z.ZodType>(
  schema: Schema,
  result: unknown[] | undefined,
  source: string,
  rejected: RejectedRow[],
  keyOf: (row: Record<string, unknown>) => string,
  positionField: "timestamp" | "block_number" | null,
): z.output<Schema>[] {
  const accepted: z.output<Schema>[] = []
  for (const raw of result ?? []) {
    const parsed = schema.safeParse(raw)
    if (parsed.success) {
      accepted.push(parsed.data)
      continue
    }
    const loose = z.record(z.string(), z.unknown()).safeParse(raw)
    const record = loose.success ? loose.data : {}
    const value = (field: string): string | null => {
      const item = record[field]
      return typeof item === "string" || typeof item === "number"
        ? String(item)
        : null
    }
    const position = positionField === null ? null : value(positionField)
    const timestamp = value("timestamp")
    rejected.push({
      source,
      rowKey: keyOf(record),
      reason: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
        .slice(0, 300),
      payload: JSON.stringify(raw ?? null).slice(0, quarantinePayloadChars),
      timestamp:
        timestamp !== null && /^[0-9]+$/.test(timestamp)
          ? Number.parseInt(timestamp, 10)
          : null,
      position:
        position !== null && /^[0-9]+$/.test(position) ? position : null,
    })
  }
  return accepted
}

/** Characters of a rejected row kept as its quarantine payload. */
export const quarantinePayloadChars = 1_000

const keyText = (record: Record<string, unknown>, field: string) => {
  const value = record[field]
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "?"
}
const byId = (record: Record<string, unknown>) => keyText(record, "id")
const byTxLog = (record: Record<string, unknown>) =>
  `${keyText(record, "tx_hash")}-${keyText(record, "log_index")}`
const byLock = (record: Record<string, unknown>) =>
  `${keyText(record, "contract_address")}-${keyText(record, "token_id")}`
const byEnclave = (record: Record<string, unknown>) =>
  `${byTxLog(record)}-${keyText(record, "ve_btc_token_id")}`
const byAddress = (record: Record<string, unknown>) =>
  keyText(record, "address")

const sweptLockSchema = neonLockRowSchema.extend({ sweep_id: text })
const dayCountSchema = z.object({
  day_start: integerText,
  rows: z.number().int(),
})

type EntryKey =
  | "activity"
  | "activityRecheck"
  | "locks"
  | "sweptLocks"
  | "deposits"
  | "depositsRecheck"
  | "troves"
  | "trovesRecheck"
  | "morpho"
  | "morphoRecheck"
  | "enclave"
  | "enclaveSweep"
  | "contracts"
  | "contractsRecheck"
  | `count:${string}`

/** Tables in the daily count check, and their Neon names. */
export const countedTables = {
  activity: "matchbox.activity_events",
  deposits: "matchbox.reward_deposits",
  troves: "matchbox.trove_updates",
  morpho: "matchbox.morpho_events",
  enclave: "matchbox.enclave_events",
} as const

export function dayCountQuery(table: string, from: number) {
  return {
    text: `SELECT ((timestamp / 86400) * 86400)::text AS day_start,
             count(*)::int AS rows
           FROM ${table}
           WHERE network = $1 AND timestamp >= $2::bigint
           GROUP BY 1 ORDER BY 1`,
    params: [network, from],
  }
}

/** Merges re-read rows into a window's rows, by key, in copy order. */
function merged<Row>(
  window: Row[],
  recheck: Row[],
  keyOf: (row: Row) => string,
  order: (a: Row, b: Row) => number,
): Row[] {
  const byKey = new Map<string, Row>()
  for (const row of [...recheck, ...window]) byKey.set(keyOf(row), row)
  return [...byKey.values()].sort(order)
}

const blockOrder = (
  a: { block_number: string; log_index: string },
  b: { block_number: string; log_index: string },
) =>
  Number(a.block_number) - Number(b.block_number) ||
  Number(a.log_index) - Number(b.log_index)

export function createScanWarehouseReader(
  run: QueryRunner,
): ScanWarehouseReader {
  return {
    async read(plan) {
      const { checkpoints, caps, tables } = plan
      const entries: {
        key: EntryKey
        query: { text: string; params: unknown[] }
      }[] = []
      if (tables.has("activity")) {
        entries.push(
          {
            key: "activity",
            query: activityQuery(checkpoints.activity, caps.activity),
          },
          {
            key: "activityRecheck",
            query: activityRecheckQuery(checkpoints.activity),
          },
          {
            key: "locks",
            query: touchedLocksQuery(checkpoints.activity, caps.activity),
          },
        )
      }
      if (plan.lockSweep !== null) {
        entries.push({
          key: "sweptLocks",
          query: lockSweepQuery(plan.lockSweep.after, plan.lockSweep.rows),
        })
      }
      if (tables.has("deposits")) {
        entries.push(
          {
            key: "deposits",
            query: depositsQuery(checkpoints.deposits, caps.deposits),
          },
          {
            key: "depositsRecheck",
            query: depositsRecheckQuery(checkpoints.deposits),
          },
        )
      }
      if (tables.has("troves")) {
        entries.push(
          {
            key: "troves",
            query: trovesQuery(checkpoints.troves, caps.troves),
          },
          {
            key: "trovesRecheck",
            query: trovesRecheckQuery(checkpoints.troves),
          },
        )
      }
      if (tables.has("morpho")) {
        entries.push(
          {
            key: "morpho",
            query: morphoQuery(checkpoints.morpho, caps.morpho),
          },
          {
            key: "morphoRecheck",
            query: morphoRecheckQuery(checkpoints.morpho),
          },
        )
      }
      if (tables.has("enclave")) {
        entries.push({
          key: "enclave",
          query: enclaveQuery(checkpoints.enclave, caps.enclave),
        })
        const sweep = plan.enclaveSweep ?? null
        if (sweep !== null) {
          entries.push({
            key: "enclaveSweep",
            query: enclaveSweepQuery(sweep.after, sweep.rows),
          })
        }
      }
      if (tables.has("contracts")) {
        if (plan.fullContracts) {
          entries.push({
            key: "contracts",
            query: allContractsQuery(caps.contracts * 10),
          })
        } else {
          entries.push(
            {
              key: "contracts",
              query: contractsQuery(checkpoints.contracts, caps.contracts),
            },
            {
              key: "contractsRecheck",
              query: contractsRecheckQuery(checkpoints.contracts),
            },
          )
        }
      }
      const countsFrom = plan.countsFrom ?? null
      if (countsFrom !== null) {
        const counted = plan.countTables ?? Object.keys(countedTables)
        for (const [name, table] of Object.entries(countedTables)) {
          if (!counted.includes(name)) continue
          entries.push({
            key: `count:${name}`,
            query: dayCountQuery(table, countsFrom),
          })
        }
      }
      const result: ScanRows = {
        activity: [],
        locks: [],
        deposits: [],
        troves: [],
        morpho: [],
        enclave: [],
        contracts: [],
        recheckedContracts: [],
        sweptLocks: [],
        sweepAfter: null,
        sweptEnclave: [],
        enclaveSweepAfter: null,
        enclaveMode: "none",
        windowCounts: {
          activity: 0,
          deposits: 0,
          troves: 0,
          morpho: 0,
          enclave: 0,
          contracts: 0,
        },
        rejected: [],
        dayCounts: [],
      }
      if (entries.length === 0) return result
      const answers = await run(entries.map((entry) => entry.query))
      const rejected = result.rejected
      const parts: Partial<Record<EntryKey, unknown[]>> = {}
      entries.forEach((entry, index) => {
        parts[entry.key] = answers[index] ?? []
      })
      const activityWindow = lenient(
        neonActivityRowSchema,
        parts.activity,
        "activity",
        rejected,
        byId,
        "timestamp",
      )
      result.windowCounts.activity = (parts.activity ?? []).length
      result.activity = merged(
        activityWindow,
        lenient(
          neonActivityRowSchema,
          parts.activityRecheck,
          "activity",
          rejected,
          byId,
          "timestamp",
        ),
        (row) => row.id,
        (a, b) => blockOrder(a, b) || a.id.localeCompare(b.id),
      )
      result.locks = lenient(
        neonLockRowSchema,
        parts.locks,
        "locks",
        rejected,
        byLock,
        null,
      )
      if (parts.sweptLocks !== undefined) {
        const swept = lenient(
          sweptLockSchema,
          parts.sweptLocks,
          "locks",
          rejected,
          byLock,
          null,
        )
        result.sweptLocks = swept.map(({ sweep_id: _id, ...lock }) => lock)
        const lastRaw = z
          .object({ sweep_id: text })
          .safeParse(parts.sweptLocks.at(-1))
        result.sweepAfter =
          plan.lockSweep !== null &&
          lastRaw.success &&
          parts.sweptLocks.length >= plan.lockSweep.rows
            ? lastRaw.data.sweep_id
            : null
      }
      function blockTable<
        Schema extends z.ZodType<{
          tx_hash: string
          log_index: string
          block_number: string
        }>,
      >(
        schema: Schema,
        table: "deposits" | "troves" | "morpho",
        windowKey: EntryKey,
        recheckKey: EntryKey,
      ): z.output<Schema>[] {
        result.windowCounts[table] = (parts[windowKey] ?? []).length
        return merged(
          lenient(
            schema,
            parts[windowKey],
            table,
            rejected,
            byTxLog,
            "block_number",
          ),
          lenient(
            schema,
            parts[recheckKey],
            table,
            rejected,
            byTxLog,
            "block_number",
          ),
          (row) => `${row.tx_hash}-${row.log_index}`,
          blockOrder,
        )
      }
      result.deposits = blockTable(
        neonDepositRowSchema,
        "deposits",
        "deposits",
        "depositsRecheck",
      )
      result.troves = blockTable(
        neonTroveRowSchema,
        "troves",
        "troves",
        "trovesRecheck",
      )
      result.morpho = blockTable(
        neonMorphoRowSchema,
        "morpho",
        "morpho",
        "morphoRecheck",
      )
      if (parts.enclave !== undefined) {
        result.windowCounts.enclave = parts.enclave.length
        result.enclave = lenient(
          neonEnclaveRowSchema,
          parts.enclave,
          "enclave",
          rejected,
          byEnclave,
          "block_number",
        )
        const sweep = plan.enclaveSweep ?? null
        const swept = parts.enclaveSweep
        if (sweep === null || swept === undefined) {
          result.enclaveMode = "window"
        } else {
          // A swept row may lie past a capped window: no position, so it
          // never moves the checkpoint.
          result.sweptEnclave = lenient(
            neonEnclaveRowSchema,
            swept,
            "enclave",
            rejected,
            byEnclave,
            null,
          )
          const last = z
            .object({
              block_number: text,
              log_index: text,
              ve_btc_token_id: text,
            })
            .safeParse(swept.at(-1))
          const wrapped = swept.length < sweep.rows || !last.success
          result.enclaveSweepAfter = wrapped ? null : enclaveSweepKey(last.data)
          result.enclaveMode = sweep.after === "" && wrapped ? "full" : "sweep"
        }
      }
      if (parts.contracts !== undefined) {
        result.windowCounts.contracts = parts.contracts.length
        result.contracts = lenient(
          neonContractRowSchema,
          parts.contracts,
          "contracts",
          rejected,
          byAddress,
          null,
        )
      }
      result.recheckedContracts = lenient(
        neonContractRowSchema,
        parts.contractsRecheck,
        "contracts",
        rejected,
        byAddress,
        null,
      )
      for (const name of Object.keys(countedTables)) {
        const answer = parts[`count:${name}`]
        if (answer === undefined) continue
        for (const row of z.array(dayCountSchema).parse(answer)) {
          result.dayCounts.push({
            table: name,
            dayStart: Number.parseInt(row.day_start, 10),
            rows: row.rows,
          })
        }
      }
      return result
    },
  }
}
