import { CONTRACTS } from "@matchbox/chain"
import { activityExtraSchema } from "@matchbox/contracts/scan"
import { EPOCH_SECONDS, epochStartOf } from "@matchbox/domain"
import { z } from "zod"
import type {
  NeonActivityRow,
  NeonDepositRow,
  NeonEnclaveRow,
  NeonLockRow,
  NeonMorphoRow,
  NeonTroveRow,
} from "./neon"
import {
  chunkRows,
  type JsonRow,
  type SqlStatement,
  sortKey,
  type UpsertSpec,
  upsertStatements,
} from "./statements"

// Pure: Neon rows into scan rows and the statements that write them. No I/O,
// so the Worker's copy step and the first-fill script share every rule.

const vebtc = CONTRACTS.mainnet.veBTC.toLowerCase()
const vemezo = CONTRACTS.mainnet.veMEZO.toLowerCase()

/**
 * The escrow a row's token id belongs to: the escrow itself for its own
 * events; veBTC votes through the pools and validators voters and claims
 * pool rewards; veMEZO votes through the boost and third-party voters and
 * receives the MEZO rebase.
 */
const escrowBySource: Record<string, string> = {
  POOLS_VOTER: vebtc,
  VALIDATORS_VOTER: vebtc,
  BRIBE_VOTING_REWARD: vebtc,
  FEE_VOTING_REWARD: vebtc,
  BOOST_VOTER: vemezo,
  THIRD_PARTY_VOTER: vemezo,
  MEZO_REBASE_DISTRIBUTOR: vemezo,
}

export function lockEscrowOf(row: {
  source: string
  contract_address: string
  token_id: string | null
}): string | null {
  if (row.token_id === null) return null
  if (row.source === "VOTING_ESCROW") return row.contract_address.toLowerCase()
  return escrowBySource[row.source] ?? null
}

const day = 86_400

/** UTC calendar day of a unix timestamp, YYYY-MM-DD. */
export function dayOf(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

/** Unix seconds at 00:00 UTC of a YYYY-MM-DD day. */
export function dayStart(dayKey: string): number {
  const parsed = Date.parse(`${dayKey}T00:00:00Z`)
  if (Number.isNaN(parsed)) throw new Error(`Not a day: ${dayKey}`)
  return parsed / 1000
}

export function nextDay(dayKey: string): string {
  return dayOf(dayStart(dayKey) + day)
}

/** A Neon integer column that stays far below 2^53 (blocks, seconds). */
function int(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed)) throw new Error(`Not an integer: ${value}`)
  return parsed
}

function intOrNull(value: string | null): number | null {
  return value === null ? null : int(value)
}

function lower(value: string | null): string | null {
  return value === null ? null : value.toLowerCase()
}

/** JSON text validated against a schema (never a bare JSON.parse). */
export function parseJson<Schema extends z.ZodType>(
  schema: Schema,
  text: string,
): z.output<Schema> {
  return z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value)
      } catch {
        context.addIssue({ code: "custom", message: "Invalid JSON" })
        return z.NEVER
      }
    })
    .pipe(schema)
    .parse(text)
}

/**
 * An event table's upsert: a new row is inserted; an existing one is
 * rewritten only when a copied value differs, so re-reading or re-filling
 * rows repairs changed ones and costs no writes for the rest.
 */
function eventSpec(
  table: string,
  columns: readonly string[],
  key: readonly string[],
): UpsertSpec {
  return {
    table,
    columns,
    key,
    update: columns.filter((column) => !key.includes(column)),
  }
}

/** A row the copy could not take: recorded, skipped, never fatal alone. */
export type QuarantinedRow = {
  source: string
  rowKey: string
  reason: string
  payload: string
  /** The row's UTC day when known, for the daily count check. */
  day: string | null
}

/** Characters of a row kept as its quarantine payload. */
export const quarantinePayloadLimit = 1_000

/**
 * Rows one table may quarantine in one run. Past it the failure is
 * systematic (a decoder or schema change), so the table's copy stops for
 * the run, loudly, instead of quarantining everything it reads.
 */
export const quarantineCap = 50

function dayOfRow(row: unknown): string | null {
  const parsed = z
    .object({ timestamp: z.union([z.string(), z.number()]) })
    .safeParse(row)
  if (!parsed.success) return null
  const seconds = Number(parsed.data.timestamp)
  return Number.isSafeInteger(seconds) && seconds > 0 ? dayOf(seconds) : null
}

/** Collects quarantined rows while transforming and validating a batch. */
export class Quarantine {
  readonly rows: QuarantinedRow[] = []
  readonly #seen = new Set<string>()

  /**
   * Records a row once per (source, row key): a row read twice in one run
   * (an Enclave row in both the window and the rotating diff) is one bad
   * row, and counts once toward the halt.
   */
  add(row: QuarantinedRow) {
    const key = `${row.source}|${row.rowKey}`
    if (this.#seen.has(key)) return
    this.#seen.add(key)
    this.rows.push({
      ...row,
      reason: row.reason.slice(0, 300),
      payload: row.payload.slice(0, quarantinePayloadLimit),
    })
  }

  attempt<Row, Out>(
    source: string,
    rowKey: (row: Row) => string,
    row: Row,
    transform: (row: Row) => Out,
  ): Out[] {
    try {
      return [transform(row)]
    } catch (error) {
      this.add({
        source,
        rowKey: rowKey(row),
        reason: error instanceof Error ? error.message : "Unknown",
        payload: JSON.stringify(row),
        day: dayOfRow(row),
      })
      return []
    }
  }

  /**
   * Keeps only the rows that parse with the schema the API reads them
   * with, so no stored row can fail an API list; the rest are quarantined.
   */
  conform(
    rows: readonly JsonRow[],
    schema: z.ZodType,
    source: string,
    rowKey: (row: JsonRow) => string,
  ): JsonRow[] {
    return rows.filter((row) => {
      const parsed = schema.safeParse(row)
      if (parsed.success) return true
      this.add({
        source,
        rowKey: rowKey(row),
        reason: `API schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
        payload: JSON.stringify(row),
        day: dayOfRow(row),
      })
      return false
    })
  }

  /** Quarantined rows per source. */
  counts(): Map<string, number> {
    const counts = new Map<string, number>()
    for (const row of this.rows) {
      counts.set(row.source, (counts.get(row.source) ?? 0) + 1)
    }
    return counts
  }
}

/**
 * Records quarantined rows (first and last seen) in scan_quarantine, at
 * most `quarantineCap` per source, chunked like every other upsert.
 */
export const quarantineSpec: UpsertSpec = {
  table: "scan_quarantine",
  columns: [
    "source",
    "row_key",
    "reason",
    "payload",
    "day",
    "first_seen",
    "last_seen",
  ],
  key: ["source", "row_key"],
  update: ["reason", "payload", "day", "last_seen"],
}

/**
 * Quarantine upserts, at most `cap` rows a source: the halt threshold, so
 * every row of a table that did not halt is recorded (the count check adds
 * them to SCAN_DB's counts).
 */
export function quarantineStatements(
  rows: readonly QuarantinedRow[],
  nowSeconds: number,
  cap = quarantineCap,
): SqlStatement[] {
  const kept = new Map<string, number>()
  const capped = rows.filter((row) => {
    const seen = kept.get(row.source) ?? 0
    kept.set(row.source, seen + 1)
    return seen < cap
  })
  return upsertStatements(
    quarantineSpec,
    capped.map((row) => ({
      source: row.source,
      row_key: row.rowKey,
      reason: row.reason,
      payload: row.payload,
      day: row.day,
      first_seen: nowSeconds,
      last_seen: nowSeconds,
    })),
  )
}

const txLogKey = (row: { tx_hash: string; log_index: string }) =>
  `${row.tx_hash}-${row.log_index}`

// ---- activity ---------------------------------------------------------

export const activitySpec: UpsertSpec = eventSpec(
  "activity",
  [
    "id",
    "tx_hash",
    "log_index",
    "block_number",
    "timestamp",
    "epoch_start",
    "action_type",
    "source",
    "contract_address",
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
    "extra",
  ],
  ["id"],
)

export function activityRows(
  rows: readonly NeonActivityRow[],
  quarantine = new Quarantine(),
): JsonRow[] {
  return rows.flatMap((input) =>
    quarantine.attempt(
      "activity",
      (row) => row.id,
      input,
      (row): JsonRow => {
        const timestamp = int(row.timestamp)
        // A vote weight must fit the 40-digit sort key; checked here so a bad
        // row is quarantined instead of failing the lock-vote plan.
        if (row.weight !== null) sortKey(row.weight)
        // Validated, then stored compact.
        const extra = JSON.stringify(parseJson(activityExtraSchema, row.extra))
        return {
          id: row.id,
          tx_hash: row.tx_hash.toLowerCase(),
          log_index: int(row.log_index),
          block_number: int(row.block_number),
          timestamp,
          epoch_start: epochStartOf(timestamp),
          action_type: row.action_type,
          source: row.source,
          contract_address: row.contract_address.toLowerCase(),
          tx_from: lower(row.tx_from),
          actor: lower(row.actor),
          recipient: lower(row.recipient),
          lock_escrow: lockEscrowOf(row),
          token_id: row.token_id,
          amount: row.amount,
          token: lower(row.token),
          gauge: lower(row.gauge),
          pool: lower(row.pool),
          reward_contract: lower(row.reward_contract),
          weight: row.weight,
          extra,
        }
      },
    ),
  )
}

// ---- locks ------------------------------------------------------------

export const lockSpec: UpsertSpec = {
  table: "locks",
  columns: [
    "escrow",
    "token_id",
    "owner",
    "amount",
    "amount_key",
    "unlock_at",
    "created_at",
    "last_extended_at",
    "withdrawn_at",
    "is_permanent",
    "is_withdrawn",
    "is_merged",
    "merged_into_token_id",
    "merged_at",
    "boost",
    "activity_count",
    "updated_at",
  ],
  key: ["escrow", "token_id"],
  update: [
    "owner",
    "amount",
    "amount_key",
    "unlock_at",
    "created_at",
    "last_extended_at",
    "withdrawn_at",
    "is_permanent",
    "is_withdrawn",
    "is_merged",
    "merged_into_token_id",
    "merged_at",
    "boost",
    "activity_count",
    "updated_at",
  ],
}

export function lockRows(
  rows: readonly NeonLockRow[],
  nowSeconds: number,
  quarantine = new Quarantine(),
): JsonRow[] {
  const key = (row: NeonLockRow) => `${row.contract_address}-${row.token_id}`
  return rows.flatMap((input) =>
    quarantine.attempt(
      "locks",
      key,
      input,
      (row): JsonRow => ({
        escrow: row.contract_address.toLowerCase(),
        token_id: row.token_id,
        owner: lower(row.owner),
        amount: row.amount,
        amount_key: sortKey(row.amount),
        unlock_at: intOrNull(row.unlock_at),
        created_at: intOrNull(row.created_at),
        last_extended_at: intOrNull(row.last_extended_at),
        withdrawn_at: intOrNull(row.withdrawn_at),
        is_permanent: row.is_permanent ? 1 : 0,
        is_withdrawn: row.is_withdrawn ? 1 : 0,
        is_merged: row.is_merged ? 1 : 0,
        merged_into_token_id: row.merged_into_token_id,
        merged_at: intOrNull(row.merged_at),
        boost: row.boost,
        activity_count: int(row.activity_count),
        updated_at: nowSeconds,
      }),
    ),
  )
}

// ---- lock votes -------------------------------------------------------

export const lockVoteSpec: UpsertSpec = {
  table: "lock_votes",
  columns: [
    "epoch_start",
    "gauge",
    "escrow",
    "token_id",
    "source",
    "pool",
    "weight",
    "weight_key",
    "voted_at",
    "carried",
  ],
  key: ["epoch_start", "gauge", "escrow", "token_id"],
  update: ["source", "pool", "weight", "weight_key", "voted_at", "carried"],
}

/** Copies every vote of `from` into `to` (the lock did not re-vote yet). */
export function carryStatement(from: number, to: number): SqlStatement {
  return {
    sql: `INSERT INTO lock_votes (epoch_start, gauge, escrow, token_id, source,
  pool, weight, weight_key, voted_at, carried)
SELECT ?2, gauge, escrow, token_id, source, pool, weight, weight_key,
  voted_at, 1
FROM lock_votes WHERE epoch_start = ?1
ON CONFLICT (epoch_start, gauge, escrow, token_id) DO NOTHING`,
    params: [from, to],
  }
}

/**
 * Removes votes by key, chunked: the first fill inlines the JSON parameter
 * into its SQL, and D1 caps a statement at 100 KB (about 770 keys).
 */
export function deleteVotesStatements(
  keys: readonly JsonRow[],
): SqlStatement[] {
  return chunkRows(keys).map((chunk) => ({
    sql: `DELETE FROM lock_votes
WHERE (epoch_start, gauge, escrow, token_id) IN (
  SELECT json_extract(value, '$.epoch_start'), json_extract(value, '$.gauge'),
    json_extract(value, '$.escrow'), json_extract(value, '$.token_id')
  FROM json_each(?1))`,
    params: [JSON.stringify(chunk)],
  }))
}

export type LockVotePlan = {
  statements: SqlStatement[]
  /** The newest epoch lock_votes holds after these statements. */
  materialized: number | null
  /** Epochs whose votes changed (cast, removed or carried). */
  epochs: number[]
}

/**
 * Lock votes from vote and abstain rows, in (block, log) order. A lock's
 * votes carry into each new epoch until it votes again or resets: before
 * the first event of a later epoch, every vote of the epoch before is
 * copied forward, then that epoch's events apply, the last event per
 * (gauge, lock) deciding (a vote sets the weight, an abstain removes it).
 * Votes are carried up to the epoch of `copiedThrough`, the newest second
 * the copy has fully read, so a quiet epoch still gets its carried votes.
 */
export function planLockVotes(
  rows: readonly JsonRow[],
  materialized: number | null,
  copiedThrough: number | null,
): LockVotePlan {
  const statements: SqlStatement[] = []
  const epochs = new Set<number>()
  let current = materialized
  function carryTo(target: number) {
    if (current === null) {
      current = target
      return
    }
    while (current < target) {
      statements.push(carryStatement(current, current + EPOCH_SECONDS))
      current += EPOCH_SECONDS
      epochs.add(current)
    }
  }
  type Effect = { vote: JsonRow | null; key: JsonRow }
  const byEpoch = new Map<number, Map<string, Effect>>()
  for (const row of rows) {
    const action = row.action_type
    if (action !== "BOOST_VOTE" && action !== "BOOST_ABSTAIN") continue
    const { gauge, lock_escrow: escrow, token_id: tokenId } = row
    if (
      typeof gauge !== "string" ||
      typeof escrow !== "string" ||
      typeof tokenId !== "string" ||
      typeof row.epoch_start !== "number"
    ) {
      continue
    }
    const epoch = row.epoch_start
    const effects = byEpoch.get(epoch) ?? new Map<string, Effect>()
    byEpoch.set(epoch, effects)
    const key = { epoch_start: epoch, gauge, escrow, token_id: tokenId }
    const weight = typeof row.weight === "string" ? row.weight : "0"
    effects.set(`${gauge}:${escrow}:${tokenId}`, {
      key,
      vote:
        action === "BOOST_VOTE"
          ? {
              ...key,
              source: row.source ?? null,
              pool: row.pool ?? null,
              weight,
              weight_key: sortKey(weight),
              voted_at: row.timestamp ?? null,
              carried: 0,
            }
          : null,
    })
  }
  for (const epoch of [...byEpoch.keys()].sort((a, b) => a - b)) {
    if (current !== null && epoch < current) {
      // A late row for an epoch already carried forward: apply it to its
      // own epoch only. The first fill script replays history in order, so
      // this only happens after a warehouse backfill of old blocks.
    } else {
      carryTo(epoch)
    }
    const effects = [...(byEpoch.get(epoch)?.values() ?? [])]
    const removed = effects.filter((effect) => effect.vote === null)
    const cast = effects.flatMap((effect) =>
      effect.vote === null ? [] : [effect.vote],
    )
    if (removed.length > 0) {
      statements.push(
        ...deleteVotesStatements(removed.map((effect) => effect.key)),
      )
    }
    statements.push(...upsertStatements(lockVoteSpec, cast))
    epochs.add(epoch)
  }
  if (copiedThrough !== null && current !== null) {
    carryTo(epochStartOf(copiedThrough))
  }
  return { statements, materialized: current, epochs: [...epochs] }
}

// ---- reward deposits, troves, Morpho, Enclave -------------------------

export const depositSpec: UpsertSpec = eventSpec(
  "incentive_deposits",
  [
    "tx_hash",
    "log_index",
    "block_number",
    "timestamp",
    "epoch_start",
    "tx_from",
    "reward_contract",
    "reward_type",
    "voter_source",
    "gauge",
    "pool",
    "token",
    "amount",
    "depositor",
  ],
  ["tx_hash", "log_index"],
)

export function depositRows(
  rows: readonly NeonDepositRow[],
  quarantine = new Quarantine(),
): JsonRow[] {
  return rows.flatMap((input) =>
    quarantine.attempt(
      "deposits",
      txLogKey,
      input,
      (row): JsonRow => ({
        tx_hash: row.tx_hash.toLowerCase(),
        log_index: int(row.log_index),
        block_number: int(row.block_number),
        timestamp: int(row.timestamp),
        epoch_start: int(row.epoch_start),
        tx_from: row.tx_from.toLowerCase(),
        reward_contract: row.reward_contract.toLowerCase(),
        reward_type: row.reward_type,
        voter_source: row.voter_source,
        gauge: row.gauge.toLowerCase(),
        pool: lower(row.pool),
        token: row.token.toLowerCase(),
        amount: row.amount,
        depositor: row.depositor.toLowerCase(),
      }),
    ),
  )
}

export const troveSpec: UpsertSpec = eventSpec(
  "trove_events",
  [
    "tx_hash",
    "log_index",
    "block_number",
    "timestamp",
    "tx_from",
    "contract_address",
    "emitter",
    "borrower",
    "operation",
    "action",
    "principal",
    "interest",
    "coll",
    "stake",
    "interest_rate",
    "prev_principal",
    "prev_interest",
    "prev_coll",
    "accrued_interest",
    "debt_change",
    "coll_change",
  ],
  ["tx_hash", "log_index"],
)

export function troveRows(
  rows: readonly NeonTroveRow[],
  quarantine = new Quarantine(),
): JsonRow[] {
  return rows.flatMap((input) =>
    quarantine.attempt(
      "troves",
      txLogKey,
      input,
      (row): JsonRow => ({
        tx_hash: row.tx_hash.toLowerCase(),
        log_index: int(row.log_index),
        block_number: int(row.block_number),
        timestamp: int(row.timestamp),
        tx_from: row.tx_from.toLowerCase(),
        contract_address: row.contract_address.toLowerCase(),
        emitter: row.emitter,
        borrower: row.borrower.toLowerCase(),
        operation: row.operation,
        action: row.action,
        principal: row.principal,
        interest: row.interest,
        coll: row.coll,
        stake: row.stake,
        interest_rate: row.interest_rate,
        prev_principal: row.prev_principal,
        prev_interest: row.prev_interest,
        prev_coll: row.prev_coll,
        accrued_interest: row.accrued_interest,
        debt_change: row.debt_change,
        coll_change: row.coll_change,
      }),
    ),
  )
}

export const morphoSpec: UpsertSpec = eventSpec(
  "morpho_events",
  [
    "tx_hash",
    "log_index",
    "block_number",
    "timestamp",
    "tx_from",
    "market_id",
    "action",
    "caller",
    "on_behalf",
    "receiver",
    "assets",
    "shares",
    "seized_assets",
    "bad_debt_assets",
    "bad_debt_shares",
    "prev_borrow_rate",
    "fee_shares",
    "fee",
  ],
  ["tx_hash", "log_index"],
)

export function morphoRows(
  rows: readonly NeonMorphoRow[],
  quarantine = new Quarantine(),
): JsonRow[] {
  return rows.flatMap((input) =>
    quarantine.attempt(
      "morpho",
      txLogKey,
      input,
      (row): JsonRow => ({
        tx_hash: row.tx_hash.toLowerCase(),
        log_index: int(row.log_index),
        block_number: int(row.block_number),
        timestamp: int(row.timestamp),
        tx_from: row.tx_from.toLowerCase(),
        market_id: row.market_id.toLowerCase(),
        action: row.action,
        caller: lower(row.caller),
        on_behalf: lower(row.on_behalf),
        receiver: lower(row.receiver),
        assets: row.assets,
        shares: row.shares,
        seized_assets: row.seized_assets,
        bad_debt_assets: row.bad_debt_assets,
        bad_debt_shares: row.bad_debt_shares,
        prev_borrow_rate: row.prev_borrow_rate,
        fee_shares: row.fee_shares,
        fee: row.fee,
      }),
    ),
  )
}

export const enclaveSpec: UpsertSpec = eventSpec(
  "enclave_events",
  [
    "tx_hash",
    "log_index",
    "ve_btc_token_id",
    "block_number",
    "timestamp",
    "tx_from",
    "contract_address",
    "enclave",
    "position_id",
    "borrower",
    "action",
    "amount",
    "principal",
    "interest_rate",
    "originator_fee_rate",
    "warning_cr",
    "minimum_cr",
    "lock_duration",
    "other_ve_btc_token_id",
    "pledged_ve_btc",
  ],
  ["tx_hash", "log_index", "ve_btc_token_id"],
)

export function enclaveRows(
  rows: readonly NeonEnclaveRow[],
  quarantine = new Quarantine(),
): JsonRow[] {
  return rows.flatMap((input) =>
    quarantine.attempt(
      "enclave",
      (row) => `${txLogKey(row)}-${row.ve_btc_token_id}`,
      input,
      (row): JsonRow => {
        parseJson(z.array(z.string().regex(/^[0-9]+$/)), row.pledged_ve_btc)
        return {
          tx_hash: row.tx_hash.toLowerCase(),
          log_index: int(row.log_index),
          ve_btc_token_id: row.ve_btc_token_id,
          block_number: int(row.block_number),
          timestamp: int(row.timestamp),
          tx_from: row.tx_from.toLowerCase(),
          contract_address: row.contract_address.toLowerCase(),
          enclave: row.enclave.toLowerCase(),
          position_id: row.position_id,
          borrower: lower(row.borrower),
          action: row.action,
          amount: row.amount,
          principal: row.principal,
          interest_rate: row.interest_rate,
          originator_fee_rate: row.originator_fee_rate,
          warning_cr: row.warning_cr,
          minimum_cr: row.minimum_cr,
          lock_duration: intOrNull(row.lock_duration),
          other_ve_btc_token_id: row.other_ve_btc_token_id,
          pledged_ve_btc: row.pledged_ve_btc,
        }
      },
    ),
  )
}

// ---- pools ---------------------------------------------------------------

export const poolSpec: UpsertSpec = {
  table: "pools",
  columns: ["pool", "token0", "token1", "kind", "source", "updated_at"],
  key: ["pool"],
  update: ["token0", "token1", "kind", "source", "updated_at"],
}

/** Basic pools from PoolCreated rows (token0 in token, token1 in recipient). */
export function poolRows(
  activity: readonly JsonRow[],
  nowSeconds: number,
): JsonRow[] {
  return activity.flatMap((row) =>
    row.action_type === "POOL_CREATED" &&
    typeof row.pool === "string" &&
    typeof row.token === "string" &&
    typeof row.recipient === "string"
      ? [
          {
            pool: row.pool,
            token0: row.token,
            token1: row.recipient,
            kind: "basic",
            source: "warehouse",
            updated_at: nowSeconds,
          },
        ]
      : [],
  )
}

// ---- dirty epochs and days --------------------------------------------

/** Activity actions that feed a `daily` metric. */
export const dailyActions = new Set([
  "SWAP",
  "BOOST_VOTE",
  "LOCK_CREATED",
  "LOCK_AMOUNT_INCREASED",
  "LOCK_WITHDRAWN",
  "EPOCH_PROCESSED",
  "SAVINGS_DEPOSIT",
  "SAVINGS_WITHDRAW",
  "SAVINGS_YIELD_CLAIMED",
])

/** The epoch an EpochProcessed row reports for: its period, else its own. */
export function emissionEpochOf(row: {
  epoch_start: number
  extra: string
}): number {
  const extra = parseJson(activityExtraSchema, row.extra)
  const period = extra.period
  if (typeof period === "string" && /^[0-9]+$/.test(period)) {
    return epochStartOf(Number.parseInt(period, 10))
  }
  return row.epoch_start
}

export function dirtyFrom(input: {
  activity: readonly JsonRow[]
  deposits: readonly JsonRow[]
  troves: readonly JsonRow[]
  morpho: readonly JsonRow[]
  voteEpochs: readonly number[]
}): { epochs: string[]; days: string[] } {
  const epochs = new Set<number>(input.voteEpochs)
  const days = new Set<string>()
  for (const row of input.activity) {
    const timestamp = row.timestamp
    if (typeof timestamp !== "number") continue
    const action = String(row.action_type)
    if (action === "BOOST_VOTE" && typeof row.epoch_start === "number") {
      epochs.add(row.epoch_start)
    }
    if (
      action === "EPOCH_PROCESSED" &&
      typeof row.epoch_start === "number" &&
      typeof row.extra === "string"
    ) {
      epochs.add(
        emissionEpochOf({ epoch_start: row.epoch_start, extra: row.extra }),
      )
    }
    // A kill or revive changes its epoch's ranks; later epochs read the
    // gauge's state as of their own end.
    if (
      (action === "GAUGE_KILLED" || action === "GAUGE_REVIVED") &&
      typeof row.epoch_start === "number"
    ) {
      epochs.add(row.epoch_start)
    }
    if (dailyActions.has(action)) days.add(dayOf(timestamp))
  }
  for (const row of input.deposits) {
    if (typeof row.epoch_start === "number") epochs.add(row.epoch_start)
    if (typeof row.timestamp === "number") days.add(dayOf(row.timestamp))
  }
  for (const row of [...input.troves, ...input.morpho]) {
    if (typeof row.timestamp === "number") days.add(dayOf(row.timestamp))
  }
  return {
    epochs: [...epochs].map(String),
    days: [...days],
  }
}
