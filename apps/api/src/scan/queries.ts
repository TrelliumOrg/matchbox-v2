import { EPOCH_ZERO_START } from "@matchbox/domain"

// Every SQL statement the /internal/scan routes run, in one place so a test
// can EXPLAIN QUERY PLAN each of them (scan/queries.workers.test.ts): each
// must be a primary-key lookup or one range scan of the index named beside
// it, with no full table scan and no temporary sort.
//
// Keyset pages use a sentinel for the first page (the largest key for a
// newest-first list), so one statement serves every page. Ties on the
// order columns are broken by a final column the index also carries, with
// a residual `NOT (... <= ...)` term so the range itself stays indexable.

/** Larger than any block, log index, timestamp or rowid. */
export const maxKey = 9_007_199_254_740_991
/** Larger than any 40-digit sort key. */
export const maxSortKey = "9".repeat(40)

/**
 * Epoch 0 starts Thu 11 Dec 2025 (EPOCH_ZERO_START). Votes cast the week
 * before it (31 transactions) put an epoch -1 row in the aggregates; it is
 * not an epoch (`/epochs/:epoch` already answers 404 for it), so no epoch
 * list serves it.
 */
const firstEpoch = `epoch_start >= ${EPOCH_ZERO_START}`

export type ScanDatabase = "scan" | "read"

export type ScanQuery = {
  db: ScanDatabase
  sql: string
  /** The index (or primary key) the plan must use. */
  index: string
  /**
   * An index the jobs schema has yet to add. Until it exists the plan may
   * end in a partial sort (`USE TEMP B-TREE FOR LAST N TERMS`, bounded by
   * one group); with it, none (queries.workers.test.ts checks both).
   */
  pendingIndex?: { name: string; sql: string }
}

function query(
  db: ScanDatabase,
  index: string,
  sql: string,
  pendingIndex?: ScanQuery["pendingIndex"],
): ScanQuery {
  return {
    db,
    index,
    sql: sql.replace(/\s+/g, " ").trim(),
    ...(pendingIndex === undefined ? {} : { pendingIndex }),
  }
}

/**
 * For the owner's votes: locks_owner holds the same columns, but is not
 * declared UNIQUE, so SQLite cannot tell each (escrow, token id) comes
 * once per owner and sorts each lock's votes itself. (owner, escrow,
 * token_id) is unique because (escrow, token_id) is the primary key.
 */
const locksOwnerLock = {
  name: "locks_owner_lock",
  sql: "CREATE UNIQUE INDEX IF NOT EXISTS locks_owner_lock ON locks (owner, escrow, token_id);",
}

const activityColumns = `rowid AS rid, id, tx_hash, log_index, block_number,
  timestamp, epoch_start, action_type, source, contract_address, tx_from,
  actor, recipient, lock_escrow, token_id, amount, token, gauge, pool,
  reward_contract, weight, extra`

/**
 * Newest first by (block, log) on one filter column, ties by rowid. Binds:
 * ?1 filter, ?2 block, ?3 log, ?4 rowid, ?5 limit.
 */
function activityBy(column: string, index: string): ScanQuery {
  return query(
    "scan",
    index,
    `SELECT ${activityColumns} FROM activity
     WHERE ${column} = ?1
       AND (block_number, log_index) <= (?2, ?3)
       AND NOT (block_number = ?2 AND log_index = ?3 AND rowid <= ?4)
     ORDER BY block_number DESC, log_index DESC, rowid
     LIMIT ?5`,
  )
}

const lockColumns = `escrow, token_id, owner, amount, amount_key, unlock_at,
  created_at, last_extended_at, withdrawn_at, is_permanent, is_withdrawn,
  is_merged, merged_into_token_id, merged_at, boost, activity_count,
  updated_at`

const voteColumns = `epoch_start, gauge, escrow, token_id, source, pool,
  weight, weight_key, voted_at, carried`

const ownerVoteColumns = `v.epoch_start, v.gauge, v.escrow, v.token_id,
  v.source, v.pool, v.weight, v.weight_key, v.voted_at, v.carried`

const depositColumns = `tx_hash, log_index, block_number, timestamp,
  epoch_start, tx_from, reward_contract, reward_type, voter_source, gauge,
  pool, token, amount, depositor`

const troveEventColumns = `tx_hash, log_index, block_number, timestamp,
  tx_from, contract_address, emitter, borrower, operation, action,
  principal, interest, coll, stake, interest_rate, prev_principal,
  prev_interest, prev_coll, accrued_interest, debt_change, coll_change`

const morphoEventColumns = `tx_hash, log_index, block_number, timestamp,
  tx_from, market_id, action, caller, on_behalf, receiver, assets, shares,
  seized_assets, bad_debt_assets, bad_debt_shares, prev_borrow_rate,
  fee_shares, fee`

const enclaveColumns = `tx_hash, log_index, ve_btc_token_id, block_number,
  timestamp, tx_from, contract_address, enclave, position_id, borrower,
  action, amount, principal, interest_rate, originator_fee_rate,
  warning_cr, minimum_cr, lock_duration, other_ve_btc_token_id,
  pledged_ve_btc`

const gaugeEpochColumns = `epoch_start, gauge, source, pool, vote_weight,
  weight_key, voters, incentives, fees, rank, killed, updated_at`

const epochColumns = `epoch_start, emission, rebase, gauge_rewards,
  total_supply, vote_transactions, voters, vote_weight, gauges, incentives,
  fees, top_gauge, killed_weight, updated_at`

const labelColumns = `address, name, name_lower, kind, tags, source, pool,
  gauge, updated_at`

/** Enclave events newest first on one column. Binds as activityBy. */
function enclaveBy(column: string, index: string): ScanQuery {
  return query(
    "scan",
    index,
    `SELECT ${enclaveColumns} FROM enclave_events
     WHERE ${column} = ?1
       AND (block_number, log_index) <= (?2, ?3)
       AND NOT (block_number = ?2 AND log_index = ?3 AND ve_btc_token_id <= ?4)
     ORDER BY block_number DESC, log_index DESC, tx_hash, ve_btc_token_id
     LIMIT ?5`,
  )
}

/**
 * The borrower-facing actions Latest borrowing lists, per table: what a
 * borrower did or had done to them. Market creation, interest accrual,
 * fee and rate settings, rewards applied and merges stay out. The queries
 * filter with `+action`, so the time index orders the scan (the action
 * index would sort).
 */
const sqlList = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(", ")

export const borrowerActions = {
  trove: sqlList([
    "LOAN_OPENED",
    "LOAN_BORROWED",
    "LOAN_REPAID",
    "LOAN_COLL_ADDED",
    "LOAN_COLL_WITHDRAWN",
    "LOAN_ADJUSTED",
    "LOAN_REFINANCED",
    "LOAN_CLOSED",
    "LOAN_LIQUIDATED",
    "LOAN_REDEEMED",
  ]),
  morpho: sqlList([
    "COLLATERAL_SUPPLIED",
    "COLLATERAL_WITHDRAWN",
    "BORROWED",
    "REPAID",
    "LIQUIDATED",
  ]),
  enclave: sqlList([
    "POSITION_OPENED",
    "DEBT_INCREASED",
    "DEBT_REPAID",
    "POSITION_CLOSED",
    "COLLATERAL_PLEDGED",
    "COLLATERAL_RELEASED",
    "VEBTC_LOCKED",
    "VEBTC_INCREASED",
    "VEBTC_WITHDRAWN",
  ]),
} as const

export const scanQueries = {
  // -- activity ------------------------------------------------------------
  /** ?1 ts, ?2 block, ?3 log, ?4 rowid, ?5 limit. */
  activityFeed: query(
    "scan",
    "activity_time",
    `SELECT ${activityColumns} FROM activity
     WHERE (timestamp, block_number, log_index) <= (?1, ?2, ?3)
       AND NOT (timestamp = ?1 AND block_number = ?2 AND log_index = ?3
                AND rowid <= ?4)
     ORDER BY timestamp DESC, block_number DESC, log_index DESC, rowid
     LIMIT ?5`,
  ),
  /** ?1 tx hash, ?2 log, ?3 rowid, ?4 limit. Oldest log first. */
  activityByTx: query(
    "scan",
    "activity_tx",
    `SELECT ${activityColumns} FROM activity
     WHERE tx_hash = ?1 AND (log_index, rowid) > (?2, ?3)
     ORDER BY log_index, rowid
     LIMIT ?4`,
  ),
  activityByActor: activityBy("actor", "activity_actor"),
  activityByRecipient: activityBy("recipient", "activity_recipient"),
  /** Rows an address only sent (keeper pokes, routed swaps). */
  activityByTxFrom: activityBy("tx_from", "activity_tx_from"),
  activityByGauge: activityBy("gauge", "activity_gauge"),
  activityByEpoch: activityBy("epoch_start", "activity_epoch"),
  /** ?1 escrow, ?2 token id, ?3 block, ?4 log, ?5 rowid, ?6 limit. */
  activityByLock: query(
    "scan",
    "activity_lock",
    `SELECT ${activityColumns} FROM activity
     WHERE lock_escrow = ?1 AND token_id = ?2
       AND (block_number, log_index) <= (?3, ?4)
       AND NOT (block_number = ?3 AND log_index = ?4 AND rowid <= ?5)
     ORDER BY block_number DESC, log_index DESC, rowid
     LIMIT ?6`,
  ),
  /** ?1 action, ?2 ts, ?3 block, ?4 log, ?5 rowid, ?6 limit. */
  activityByAction: query(
    "scan",
    "activity_action",
    `SELECT ${activityColumns} FROM activity
     WHERE action_type = ?1
       AND (timestamp, block_number, log_index) <= (?2, ?3, ?4)
       AND NOT (timestamp = ?2 AND block_number = ?3 AND log_index = ?4
                AND rowid <= ?5)
     ORDER BY timestamp DESC, block_number DESC, log_index DESC, rowid
     LIMIT ?6`,
  ),

  // -- locks ---------------------------------------------------------------
  /** ?1 escrow, ?2 token id. */
  lock: query(
    "scan",
    "locks primary key",
    `SELECT ${lockColumns} FROM locks WHERE escrow = ?1 AND token_id = ?2`,
  ),
  /** ?1 escrow, ?2 amount key, ?3 token id, ?4 limit. Live locks. */
  locksByAmount: query(
    "scan",
    "locks_by_amount",
    `SELECT ${lockColumns} FROM locks
     WHERE escrow = ?1 AND is_withdrawn = 0 AND is_merged = 0
       AND amount_key <= ?2
       AND NOT (amount_key = ?2 AND token_id <= ?3)
     ORDER BY amount_key DESC, token_id
     LIMIT ?4`,
  ),
  // `order=unlock` reads three ranges of locks_by_unlock in turn: timed
  // locks soonest first, then permanent locks (unlock_at = 0), then live
  // locks with no unlock time recorded (NULL), each by token id. The
  // token-id ranges name their index: the planner would otherwise walk
  // the primary key and filter.
  /** ?1 escrow, ?2 unlock, ?3 token id, ?4 limit. Timed live locks. */
  locksByUnlock: query(
    "scan",
    "locks_by_unlock",
    `SELECT ${lockColumns} FROM locks
     WHERE escrow = ?1 AND is_withdrawn = 0 AND is_merged = 0
       AND unlock_at > 0 AND (unlock_at, token_id) > (?2, ?3)
     ORDER BY unlock_at, token_id
     LIMIT ?4`,
  ),
  /** ?1 escrow, ?2 token id, ?3 limit. Permanent live locks. */
  locksPermanent: query(
    "scan",
    "locks_by_unlock",
    `SELECT ${lockColumns} FROM locks INDEXED BY locks_by_unlock
     WHERE escrow = ?1 AND is_withdrawn = 0 AND is_merged = 0
       AND unlock_at = 0 AND token_id > ?2
     ORDER BY token_id
     LIMIT ?3`,
  ),
  /** ?1 escrow, ?2 token id, ?3 limit. Live locks with no unlock time. */
  locksUnlockUnknown: query(
    "scan",
    "locks_by_unlock",
    `SELECT ${lockColumns} FROM locks INDEXED BY locks_by_unlock
     WHERE escrow = ?1 AND is_withdrawn = 0 AND is_merged = 0
       AND unlock_at IS NULL AND token_id > ?2
     ORDER BY token_id
     LIMIT ?3`,
  ),
  // `order=created` reads two ranges of locks_by_created: newest first,
  // then the locks with no creation time (the early locks), by token id.
  /** ?1 escrow, ?2 created, ?3 token id, ?4 limit. Newest first. */
  locksByCreated: query(
    "scan",
    "locks_by_created",
    `SELECT ${lockColumns} FROM locks
     WHERE escrow = ?1 AND created_at <= ?2
       AND NOT (created_at = ?2 AND token_id <= ?3)
     ORDER BY created_at DESC, token_id
     LIMIT ?4`,
  ),
  /** ?1 escrow, ?2 token id, ?3 limit. Locks with no creation time. */
  locksCreatedUnknown: query(
    "scan",
    "locks_by_created",
    `SELECT ${lockColumns} FROM locks INDEXED BY locks_by_created
     WHERE escrow = ?1 AND created_at IS NULL AND token_id > ?2
     ORDER BY token_id
     LIMIT ?3`,
  ),
  /** ?1 owner, ?2 escrow, ?3 token id, ?4 limit. */
  /**
   * ?1 owner, ?2 escrow, ?3 token id: one withdrawn or merged lock of the
   * owner past that key, if any (the address page's "more locks").
   */
  settledLockAfter: query(
    "scan",
    "locks_owner",
    `SELECT 1 AS found FROM locks
     WHERE owner = ?1 AND (escrow, token_id) > (?2, ?3)
       AND (is_withdrawn = 1 OR is_merged = 1)
     LIMIT 1`,
  ),
  locksByOwner: query(
    "scan",
    "locks_owner",
    `SELECT ${lockColumns} FROM locks
     WHERE owner = ?1 AND (escrow, token_id) > (?2, ?3)
     ORDER BY escrow, token_id
     LIMIT ?4`,
  ),
  /** ?1 escrow, ?2 token id, ?3 epoch, ?4 gauge, ?5 limit. */
  votesByLock: query(
    "scan",
    "lock_votes_lock",
    `SELECT ${voteColumns} FROM lock_votes
     WHERE escrow = ?1 AND token_id = ?2 AND epoch_start <= ?3
       AND NOT (epoch_start = ?3 AND gauge <= ?4)
     ORDER BY epoch_start DESC, gauge
     LIMIT ?5`,
  ),

  /**
   * ?1 owner, ?2 escrow, ?3 token id, ?4 epoch, ?5 gauge, ?6 limit. The
   * votes of every lock the address owns now (locks.owner): the owner's
   * locks in locks_owner order, each lock's votes newest epoch first from
   * lock_votes_lock (WITHOUT ROWID, so its entries end in gauge). Both
   * indexes exist; nothing is sorted.
   */
  votesByOwner: query(
    "scan",
    "locks_owner",
    `SELECT ${ownerVoteColumns} FROM locks l
     JOIN lock_votes v INDEXED BY lock_votes_lock
       ON v.escrow = l.escrow AND v.token_id = l.token_id
     WHERE l.owner = ?1 AND (l.escrow, l.token_id) >= (?2, ?3)
       AND NOT (l.escrow = ?2 AND l.token_id = ?3
                AND (v.epoch_start > ?4
                     OR (v.epoch_start = ?4 AND v.gauge <= ?5)))
     ORDER BY l.escrow, l.token_id, v.epoch_start DESC, v.gauge
     LIMIT ?6`,
    locksOwnerLock,
  ),
  /**
   * ?1 owner, ?2 epoch, ?3 escrow, ?4 token id, ?5 gauge, ?6 limit. The
   * same, in one epoch: an equality on lock_votes_lock per lock.
   */
  votesByOwnerInEpoch: query(
    "scan",
    "locks_owner",
    `SELECT ${ownerVoteColumns} FROM locks l
     JOIN lock_votes v INDEXED BY lock_votes_lock
       ON v.escrow = l.escrow AND v.token_id = l.token_id
       AND v.epoch_start = ?2
     WHERE l.owner = ?1 AND (l.escrow, l.token_id) >= (?3, ?4)
       AND NOT (l.escrow = ?3 AND l.token_id = ?4 AND v.gauge <= ?5)
     ORDER BY l.escrow, l.token_id, v.gauge
     LIMIT ?6`,
    locksOwnerLock,
  ),

  // -- gauges and incentives -----------------------------------------------
  /**
   * ?1 epoch, ?2 gauge, ?3 weight key, ?4 token id, ?5 escrow, ?6 limit.
   * Ties on weight and token id (a veBTC and a veMEZO lock with the same
   * id) break on escrow: lock_votes is WITHOUT ROWID, so the index's
   * entries already end in the rest of the primary key (escrow).
   */
  votersByGauge: query(
    "scan",
    "lock_votes_gauge_weight",
    `SELECT ${voteColumns} FROM lock_votes
     WHERE epoch_start = ?1 AND gauge = ?2 AND weight_key <= ?3
       AND NOT (weight_key = ?3
                AND (token_id < ?4 OR (token_id = ?4 AND escrow <= ?5)))
     ORDER BY weight_key DESC, token_id, escrow
     LIMIT ?6`,
  ),
  /** ?1 gauge, ?2 epoch, ?3 block, ?4 log, ?5 limit. */
  incentivesByGauge: query(
    "scan",
    "incentive_deposits_gauge",
    `SELECT ${depositColumns} FROM incentive_deposits
     WHERE gauge = ?1
       AND (epoch_start, block_number, log_index) < (?2, ?3, ?4)
     ORDER BY epoch_start DESC, block_number DESC, log_index DESC
     LIMIT ?5`,
  ),
  /** ?1 epoch, ?2 block, ?3 log, ?4 limit. */
  incentivesByEpoch: query(
    "scan",
    "incentive_deposits_epoch",
    `SELECT ${depositColumns} FROM incentive_deposits
     WHERE epoch_start = ?1 AND (block_number, log_index) < (?2, ?3)
     ORDER BY block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /** ?1 depositor, ?2 block, ?3 log, ?4 limit. */
  incentivesByDepositor: query(
    "scan",
    "incentive_deposits_depositor",
    `SELECT ${depositColumns} FROM incentive_deposits
     WHERE depositor = ?1 AND (block_number, log_index) < (?2, ?3)
     ORDER BY block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /** ?1 gauge, ?2 epoch, ?3 limit. Newest epoch first. */
  gaugeHistory: query(
    "scan",
    "gauge_epoch primary key",
    `SELECT ${gaugeEpochColumns} FROM gauge_epoch
     WHERE gauge = ?1 AND epoch_start < ?2 AND ${firstEpoch}
     ORDER BY epoch_start DESC
     LIMIT ?3`,
  ),
  /** ?1 epoch, ?2 source, ?3 rank, ?4 limit. Rank 1 first. */
  gaugeRanking: query(
    "scan",
    "gauge_epoch_rank",
    `SELECT ${gaugeEpochColumns} FROM gauge_epoch
     WHERE epoch_start = ?1 AND source = ?2 AND rank > ?3
     ORDER BY rank
     LIMIT ?4`,
  ),

  /**
   * ?1 epoch, ?2 source. Killed gauges of an epoch: unranked, so they are
   * the rank IS NULL rows of the same index, filtered to killed.
   */
  killedGauges: query(
    "scan",
    "gauge_epoch_rank",
    `SELECT ${gaugeEpochColumns} FROM gauge_epoch
     WHERE epoch_start = ?1 AND source = ?2 AND rank IS NULL AND killed = 1
     ORDER BY gauge
     LIMIT 100`,
  ),

  // -- epochs --------------------------------------------------------------
  /** ?1 epoch, ?2 limit. Newest first. */
  epochs: query(
    "scan",
    "epoch_totals primary key",
    `SELECT ${epochColumns} FROM epoch_totals
     WHERE epoch_start < ?1 AND ${firstEpoch}
     ORDER BY epoch_start DESC
     LIMIT ?2`,
  ),
  /** ?1 epoch. */
  epoch: query(
    "scan",
    "epoch_totals primary key",
    `SELECT ${epochColumns} FROM epoch_totals WHERE epoch_start = ?1`,
  ),

  // -- borrow history ------------------------------------------------------
  /** ?1 borrower, ?2 block, ?3 log, ?4 limit. */
  troveEventsByBorrower: query(
    "scan",
    "trove_events_borrower",
    `SELECT ${troveEventColumns} FROM trove_events
     WHERE borrower = ?1 AND (block_number, log_index) < (?2, ?3)
     ORDER BY block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /** ?1 action, ?2 block, ?3 log, ?4 limit. Liquidations, redemptions. */
  troveEventsByAction: query(
    "scan",
    "trove_events_action",
    `SELECT ${troveEventColumns} FROM trove_events
     WHERE action = ?1 AND (block_number, log_index) < (?2, ?3)
     ORDER BY block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /**
   * ?1 timestamp, ?2 block, ?3 log, ?4 limit. Newest first across every
   * borrower, for the homepage's Latest borrowing (/borrow/events).
   */
  troveEventsByTime: query(
    "scan",
    "trove_events_time",
    `SELECT ${troveEventColumns} FROM trove_events
     WHERE (timestamp, block_number, log_index) < (?1, ?2, ?3)
       AND +action IN (${borrowerActions.trove})
     ORDER BY timestamp DESC, block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /** ?1 timestamp, ?2 block, ?3 log, ?4 limit. As troveEventsByTime. */
  morphoEventsByTime: query(
    "scan",
    "morpho_events_time",
    `SELECT ${morphoEventColumns} FROM morpho_events
     WHERE (timestamp, block_number, log_index) < (?1, ?2, ?3)
       AND +action IN (${borrowerActions.morpho})
     ORDER BY timestamp DESC, block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /**
   * ?1 timestamp, ?2 block, ?3 log, ?4 limit, from that event's own rows
   * on (inclusive): an event pledging several veBTC is one row per lock,
   * and a page that stops inside one is read again from its start.
   */
  enclaveEventsByTime: query(
    "scan",
    "enclave_events_time",
    `SELECT ${enclaveColumns} FROM enclave_events
     WHERE (timestamp, block_number, log_index) <= (?1, ?2, ?3)
       AND +action IN (${borrowerActions.enclave})
     ORDER BY timestamp DESC, block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /** ?1 market, ?2 block, ?3 log, ?4 limit. */
  morphoEventsByMarket: query(
    "scan",
    "morpho_events_market",
    `SELECT ${morphoEventColumns} FROM morpho_events
     WHERE market_id = ?1 AND (block_number, log_index) < (?2, ?3)
     ORDER BY block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /** ?1 action, ?2 block, ?3 log, ?4 limit. Morpho liquidations. */
  morphoEventsByAction: query(
    "scan",
    "morpho_events_action",
    `SELECT ${morphoEventColumns} FROM morpho_events
     WHERE action = ?1 AND (block_number, log_index) < (?2, ?3)
     ORDER BY block_number DESC, log_index DESC
     LIMIT ?4`,
  ),
  /** ?1 account, ?2 market, ?3 block, ?4 log, ?5 limit. */
  morphoEventsByPosition: query(
    "scan",
    "morpho_events_position",
    `SELECT ${morphoEventColumns} FROM morpho_events
     WHERE on_behalf = ?1 AND market_id = ?2
       AND (block_number, log_index) < (?3, ?4)
     ORDER BY block_number DESC, log_index DESC
     LIMIT ?5`,
  ),
  enclaveByPosition: enclaveBy("position_id", "enclave_events_position"),
  enclaveByBorrower: enclaveBy("borrower", "enclave_events_borrower"),
  /** A veBTC's Enclave rows, newest first. Binds as enclaveByPosition. */
  enclaveByToken: enclaveBy("ve_btc_token_id", "enclave_events_lock"),
  /**
   * ?1 position id, ?2 limit. The events of the positions after ?1, by
   * position then newest first: one range of enclave_events_position for
   * a page of positions with their histories.
   */
  enclavePositionEvents: query(
    "scan",
    "enclave_events_position",
    `SELECT ${enclaveColumns} FROM enclave_events
     WHERE position_id > ?1
     ORDER BY position_id, block_number DESC, log_index DESC, tx_hash,
       ve_btc_token_id
     LIMIT ?2`,
  ),
  /**
   * ?1 position id. The latest event of the first position after ?1: one
   * row of enclave_events_position, so walking every position (from '')
   * reads one row per position, not its history.
   */
  enclaveNextPosition: query(
    "scan",
    "enclave_events_position",
    `SELECT ${enclaveColumns} FROM enclave_events
     WHERE position_id > ?1
     ORDER BY position_id, block_number DESC, log_index DESC
     LIMIT 1`,
  ),

  // -- labels --------------------------------------------------------------
  /** ?1 lower bound, ?2 upper bound, ?3 limit. */
  labelsByName: query(
    "scan",
    "labels_name",
    `SELECT ${labelColumns} FROM labels
     WHERE name_lower >= ?1 AND name_lower < ?2
     ORDER BY name_lower, address
     LIMIT ?3`,
  ),
  /** ?1 lower bound, ?2 upper bound, ?3 limit. */
  labelsByAddressPrefix: query(
    "scan",
    "labels primary key",
    `SELECT ${labelColumns} FROM labels
     WHERE address >= ?1 AND address < ?2
     ORDER BY address
     LIMIT ?3`,
  ),

  // -- series --------------------------------------------------------------
  /** ?1 metric, ?2 dimension, ?3 from, ?4 to. */
  dailyRange: query(
    "scan",
    "daily primary key",
    `SELECT day, value, partial FROM daily
     WHERE metric = ?1 AND dimension = ?2 AND day >= ?3 AND day <= ?4
     ORDER BY day`,
  ),
  /** ?1 metric, ?2 dimension. */
  dailyFirst: query(
    "scan",
    "daily primary key",
    `SELECT day FROM daily WHERE metric = ?1 AND dimension = ?2
     ORDER BY day LIMIT 1`,
  ),
  dailyLast: query(
    "scan",
    "daily primary key",
    `SELECT day FROM daily WHERE metric = ?1 AND dimension = ?2
     ORDER BY day DESC LIMIT 1`,
  ),
  /** ?1 metric, ?2 dimension. The latest close, with its value. */
  dailyLatest: query(
    "scan",
    "daily primary key",
    `SELECT day, value, partial FROM daily
     WHERE metric = ?1 AND dimension = ?2
     ORDER BY day DESC LIMIT 1`,
  ),
  /** ?1 metric, ?2 dimension. The latest row, with its day. */
  dailyLatestOf: query(
    "scan",
    "daily primary key",
    `SELECT dimension, day, value FROM daily
     WHERE metric = ?1 AND dimension = ?2
     ORDER BY day DESC LIMIT 1`,
  ),
  /**
   * ?1 metric. The newest day the metric has any row (across dimensions):
   * one seek of daily_by_day (metric, day, dimension), scan-migrations 0001.
   */
  dailyLatestDay: query(
    "scan",
    "daily_by_day",
    "SELECT max(day) AS day FROM daily WHERE metric = ?1",
  ),
  /**
   * ?1 metric, ?2 day. Every dimension's row on one day. daily_by_day is
   * named: the planner would walk the primary key, whose order matches the
   * ORDER BY, through every row of the metric.
   */
  dailyOnDay: query(
    "scan",
    "daily_by_day",
    `SELECT dimension, value, partial FROM daily INDEXED BY daily_by_day
     WHERE metric = ?1 AND day = ?2
     ORDER BY dimension`,
  ),
  /**
   * ?1 metric, ?2 from, ?3 to, ?4 limit. Every dimension's rows over a
   * range, newest day first: one range scan of daily_by_day (metric, day,
   * dimension) backwards, so no sort, and a limit cuts the oldest days
   * (/series/split).
   */
  dailySplitRange: query(
    "scan",
    "daily_by_day",
    `SELECT dimension, day, value, partial FROM daily INDEXED BY daily_by_day
     WHERE metric = ?1 AND day >= ?2 AND day <= ?3
     ORDER BY day DESC, dimension DESC
     LIMIT ?4`,
  ),
  /** ?1 metric, ?2 dimension, ?3 day. One day's row. */
  dailyOn: query(
    "scan",
    "daily primary key",
    `SELECT value, partial FROM daily
     WHERE metric = ?1 AND dimension = ?2 AND day = ?3`,
  ),
  /** ?1 metric. Every dimension the metric has rows for. */
  dailyDimensions: query(
    "scan",
    "daily primary key",
    `SELECT DISTINCT dimension FROM daily WHERE metric = ?1
     ORDER BY dimension LIMIT 500`,
  ),
  /** ?1 token, ?2 from, ?3 to. */
  priceRange: query(
    "scan",
    "price_daily primary key",
    `SELECT day, price FROM price_daily
     WHERE token = ?1 AND day >= ?2 AND day <= ?3
     ORDER BY day`,
  ),
  priceFirst: query(
    "scan",
    "price_daily primary key",
    `SELECT day FROM price_daily WHERE token = ?1 ORDER BY day LIMIT 1`,
  ),
  priceLast: query(
    "scan",
    "price_daily primary key",
    `SELECT day FROM price_daily WHERE token = ?1 ORDER BY day DESC LIMIT 1`,
  ),

  // -- versions ------------------------------------------------------------
  /** ?1 job. The last successful run, newest first. */
  lastRun: query(
    "scan",
    "scan_runs_recent",
    `SELECT id, finished_at FROM scan_runs
     WHERE job = ?1 AND status = 'ok'
     ORDER BY started_at DESC
     LIMIT 1`,
  ),
  /** ?1 kind ('epoch' or 'day'). Aggregates still to recompute. */
  dirtyKeys: query(
    "scan",
    "scan_dirty primary key",
    `SELECT key FROM scan_dirty WHERE kind = ?1`,
  ),
  /** The jobs Worker's status row (id 1). */
  status: query(
    "scan",
    "scan_status primary key",
    // Every column: one the jobs Worker adds (and scanStatusRowSchema
    // then requires) is read with no change here.
    "SELECT * FROM scan_status WHERE id = 1",
  ),
  /** ?1 cursor name. */
  scanCursor: query(
    "scan",
    "scan_cursors primary key",
    `SELECT value FROM scan_cursors WHERE name = ?1`,
  ),

  // -- READ_DB: live Borrow state and Pro documents ------------------------
  /** ?1 network. Two markets on Mezo today. */
  markets: query(
    "read",
    "morpho_markets primary key",
    `SELECT * FROM morpho_markets WHERE network = ?1 ORDER BY market_id`,
  ),
  /**
   * ?1 network. Markets the jobs Worker discovered from CreateMarket logs,
   * with their tokens' on-chain decimals (READ_DB migration 0006).
   */
  knownMarkets: query(
    "read",
    "morpho_known_markets primary key",
    `SELECT market_id, loan_decimals, collateral_decimals
     FROM morpho_known_markets WHERE network = ?1`,
  ),
  /** ?1 network, ?2 market. */
  market: query(
    "read",
    "morpho_markets primary key",
    `SELECT * FROM morpho_markets WHERE network = ?1 AND market_id = ?2`,
  ),
  /** ?1 network, ?2 market, ?3 account, ?4 limit. */
  positionsByMarket: query(
    "read",
    "morpho_positions primary key",
    `SELECT * FROM morpho_positions
     WHERE network = ?1 AND market_id = ?2 AND account > ?3
     ORDER BY account
     LIMIT ?4`,
  ),
  /** ?1 network, ?2 account. */
  positionsByAccount: query(
    "read",
    "morpho_positions_account",
    `SELECT * FROM morpho_positions WHERE network = ?1 AND account = ?2`,
  ),
  /** ?1 network, ?2 owner. */
  trove: query(
    "read",
    "troves primary key",
    `SELECT * FROM troves WHERE network = ?1 AND owner = ?2`,
  ),
  /** ?1 network, ?2 owner, ?3 limit. Open troves (troves_status). */
  openTroves: query(
    "read",
    "troves_status",
    `SELECT * FROM troves
     WHERE network = ?1 AND status = 'active' AND owner > ?2
     ORDER BY owner
     LIMIT ?3`,
  ),
  /** ?1 network. */
  stabilityPool: query(
    "read",
    "stability_pool primary key",
    `SELECT * FROM stability_pool WHERE network = ?1`,
  ),
  // -- Cross-chain (scan-migrations 0006) -----------------------------------

  /** ?1 asset. Every venue's latest quote and the headline. */
  crossChainQuotes: query(
    "scan",
    "market_quotes primary key",
    `SELECT asset, venue, chain, price, depth_usd, method, source, block,
       read_at, detail
     FROM market_quotes WHERE asset = ?1`,
  ),

  /** ?1 asset, ?2 first day. Daily closes per venue, oldest first. */
  crossChainPriceDays: query(
    "scan",
    "market_price_daily_by_day",
    `SELECT venue, day, price FROM market_price_daily
     WHERE asset = ?1 AND day >= ?2 ORDER BY day`,
  ),

  /** ?1 asset, ?2 first day. Supply per chain and day, oldest first. */
  crossChainSupplyDays: query(
    "scan",
    "token_supply_daily_by_day",
    `SELECT asset, chain, day, total_supply, locked, circulating, decimals,
       block, updated_at
     FROM token_supply_daily WHERE asset = ?1 AND day >= ?2 ORDER BY day`,
  ),

  /** ?1 first day. Every pool's rows since, oldest first. */
  crossChainPoolDays: query(
    "scan",
    "pool_daily_by_day",
    `SELECT pool_id, day, tvl_usd, volume_24h_usd, apr_fees, apr_rewards,
       apr_merkl, apr_gauge, sources, unavailable, updated_at
     FROM pool_daily WHERE day >= ?1 ORDER BY day`,
  ),

  /** ?1 asset, ?2 first day. Route totals per day, oldest first. */
  crossChainRouteDays: query(
    "scan",
    "bridge_route_totals_by_day",
    `SELECT asset, from_chain, to_chain, day, transfers_total,
       notional_usd_total, updated_at
     FROM bridge_route_totals WHERE asset = ?1 AND day >= ?2 ORDER BY day`,
  ),

  /** ?1 asset, ?2 first day. All routes per day, oldest first. */
  crossChainBridgeDays: query(
    "scan",
    "bridge_daily primary key",
    `SELECT asset, day, transfers, notional_usd, updated_at FROM bridge_daily
     WHERE asset = ?1 AND day >= ?2 ORDER BY day`,
  ),

  /** ?1 network, ?2 kind, ?3 key. The version of a Pro document. */
  readModelVersion: query(
    "read",
    "read_models primary key",
    `SELECT etag, updated_at FROM read_models
     WHERE network = ?1 AND kind = ?2 AND doc_key = ?3`,
  ),

  // Validator uptime (scan-migrations 0005, apps/jobs src/uptime).

  /** Where the poller stands (one row). */
  uptimeStatus: query(
    "scan",
    "uptime_status primary key",
    `SELECT height, block_time, set_id, started_time, finalized_day, read_at,
       source, node_height, evm_height, health
     FROM uptime_status WHERE id = 1`,
  ),
  /** ?1 set id. */
  uptimeSet: query(
    "scan",
    "uptime_sets primary key",
    `SELECT id, members FROM uptime_sets WHERE id = ?1`,
  ),
  /** ?1 the newest height, ?2 limit. The newest blocks, newest first. */
  uptimeBlocks: query(
    "scan",
    "uptime_blocks primary key",
    `SELECT height, time, round, set_id, proposer, missed, signed, signers
     FROM uptime_blocks WHERE height <= ?1
     ORDER BY height DESC LIMIT ?2`,
  ),
  /** ?1 first hour. Every validator's hours from then. */
  uptimeHours: query(
    "scan",
    "uptime_hourly_hour",
    `SELECT validator, hour, blocks, signed, missed, proposed,
       proposals_missed, expected_micro
     FROM uptime_hourly WHERE hour >= ?1`,
  ),
  /** ?1 validator key, ?2 first hour. */
  uptimeHoursOf: query(
    "scan",
    "uptime_hourly primary key",
    `SELECT validator, hour, blocks, signed, missed, proposed,
       proposals_missed, expected_micro
     FROM uptime_hourly WHERE validator = ?1 AND hour >= ?2`,
  ),
  /** ?1 first day. Every validator's days from then. */
  uptimeDays: query(
    "scan",
    "uptime_daily_day",
    `SELECT validator, day, blocks, signed, missed, proposed,
       proposals_missed, expected_micro, complete
     FROM uptime_daily WHERE day >= ?1`,
  ),
  /** ?1 validator key, ?2 first day. */
  uptimeDaysOf: query(
    "scan",
    "uptime_daily primary key",
    `SELECT validator, day, blocks, signed, missed, proposed,
       proposals_missed, expected_micro, complete
     FROM uptime_daily WHERE validator = ?1 AND day >= ?2`,
  ),
  /** ?1 validator key. The newest hour it signed in (14 days kept). */
  uptimeLastSignedHour: query(
    "scan",
    "uptime_hourly primary key",
    `SELECT max(hour) AS at FROM uptime_hourly
     WHERE validator = ?1 AND signed > 0`,
  ),
  /** ?1 validator key. The newest day it signed in. */
  uptimeLastSignedDay: query(
    "scan",
    "uptime_daily primary key",
    `SELECT max(day) AS day FROM uptime_daily
     WHERE validator = ?1 AND signed > 0`,
  ),
  // Governance summaries (scan-migrations 0007, governance.ts).
  /** ?1 first epoch, ?2 last epoch. Every voter's totals, oldest first. */
  epochSources: query(
    "scan",
    "epoch_sources primary key",
    `SELECT epoch_start, source, emissions, incentives, fees, vote_weight,
       gauges, emission_gauges, updated_at
     FROM epoch_sources WHERE epoch_start >= ?1 AND epoch_start <= ?2
     ORDER BY epoch_start, source`,
  ),
  /** ?1 gauge, ?2 limit. Newest epoch first. */
  gaugeEmissions: query(
    "scan",
    "gauge_emissions primary key",
    `SELECT gauge, epoch_start, source, amount, events, updated_at
     FROM gauge_emissions WHERE gauge = ?1
     ORDER BY epoch_start DESC LIMIT ?2`,
  ),
  /** ?1 epoch, ?2 source. Every gauge the voter paid that epoch. */
  epochEmissions: query(
    "scan",
    "gauge_emissions_epoch",
    `SELECT gauge, epoch_start, source, amount, events, updated_at
     FROM gauge_emissions WHERE epoch_start = ?1 AND source = ?2
     ORDER BY gauge`,
  ),
  /** ?1 escrow, ?2 day. The newest document on or before the day. */
  lockDistributionOn: query(
    "scan",
    "lock_distribution primary key",
    `SELECT escrow, day, block, data, source, updated_at
     FROM lock_distribution WHERE escrow = ?1 AND day <= ?2
     ORDER BY day DESC LIMIT 1`,
  ),
  /** ?1 escrow, ?2 first day. Each day's headline groups, oldest first. */
  lockDistributionHistory: query(
    "scan",
    "lock_distribution primary key",
    `SELECT day, json_extract(data, '$.live') AS live,
       json_extract(data, '$.permanent') AS permanent,
       json_extract(data, '$.timed') AS timed
     FROM lock_distribution WHERE escrow = ?1 AND day >= ?2
     ORDER BY day`,
  ),
} as const satisfies Record<string, ScanQuery>

export type ScanQueryName = keyof typeof scanQueries

/** `labelsByAddress` with `count` placeholders (key lookups, ≤ 50). */
export function labelsByAddresses(count: number): ScanQuery {
  const marks = Array.from({ length: count }, (_, index) => `?${index + 1}`)
  return query(
    "scan",
    "labels primary key",
    `SELECT ${labelColumns} FROM labels WHERE address IN (${marks.join(", ")})`,
  )
}
