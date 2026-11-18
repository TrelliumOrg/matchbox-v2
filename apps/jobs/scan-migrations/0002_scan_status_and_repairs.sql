-- Fixes after review (additive; 0001 is already applied by readers' tests).

-- A dirty marker is cleared only if no run re-marked it while its aggregate
-- was being computed: marking bumps the generation, clearing checks it.
ALTER TABLE scan_dirty ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;

-- Daily incentive and fee totals are by deposit time, whatever epoch the
-- deposit is for.
CREATE INDEX IF NOT EXISTS incentive_deposits_time
  ON incentive_deposits (timestamp);

-- An address's activity includes rows where it only sent the transaction
-- (keeper pokes have no actor; routed swaps name the router). One more index
-- write per activity row, about 1,500 a day.
CREATE INDEX IF NOT EXISTS activity_tx_from
  ON activity (tx_from, block_number DESC, log_index DESC);

-- Morpho events by action (liquidations list). One more index write per
-- Morpho event, about 15 a day.
CREATE INDEX IF NOT EXISTS morpho_events_action
  ON morpho_events (action, block_number DESC, log_index DESC);

-- 1 while the day can still change: a copy-derived row whose day the copy
-- has not read to the end of, or a closing value of a day not yet over.
ALTER TABLE daily ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS daily_partial ON daily (day) WHERE partial = 1;

-- Killed gauges (GaugeKilled, until GaugeRevived) as of the epoch's end:
-- unranked, not a top gauge. Their weight stays in vote_weight, as the
-- voters keep it in totalWeight, and is also reported on its own.
ALTER TABLE gauge_epoch ADD COLUMN killed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE epoch_totals ADD COLUMN killed_weight TEXT NOT NULL DEFAULT '{}';

-- Pools and their tokens, basic and CL: from PoolCreated rows (basic) and
-- Mezo's earn-pools subgraph (basic and CL), for pool balances and names.
CREATE TABLE IF NOT EXISTS pools (
  pool TEXT PRIMARY KEY,
  token0 TEXT NOT NULL,
  token1 TEXT NOT NULL,
  -- 'basic' or 'cl'
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- One row (id = 1) the API reads to tell readers how complete Scan's data
-- is. Rewritten by every copy run, only when a value changed.
CREATE TABLE IF NOT EXISTS scan_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- The last copy run: 'ok', 'skipped' or 'failed', and when.
  last_run_status TEXT NOT NULL,
  last_run_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  -- Newest activity second copied (the copy-derived series are complete
  -- up to here).
  copied_through INTEGER,
  dirty_epochs INTEGER NOT NULL DEFAULT 0,
  dirty_days INTEGER NOT NULL DEFAULT 0,
  -- 1 when no epoch or day is waiting for its aggregates.
  aggregates_complete INTEGER NOT NULL DEFAULT 0,
  -- 1 once the first-fill SQL has been applied (scan_cursors fill:neon).
  history_filled INTEGER NOT NULL DEFAULT 0,
  -- 1 when the warehouse was rebuilt under a new decoder version and the
  -- tables need a re-fill (README, "Re-fill runbook").
  refill_required INTEGER NOT NULL DEFAULT 0,
  refill_reason TEXT,
  quarantined_rows INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Rows the copy could not transform: kept out of the tables, recorded here,
-- and the copy goes on. A fixed transform re-reads them through a re-fill.
CREATE TABLE IF NOT EXISTS scan_quarantine (
  source TEXT NOT NULL,
  row_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (source, row_key)
) WITHOUT ROWID;
