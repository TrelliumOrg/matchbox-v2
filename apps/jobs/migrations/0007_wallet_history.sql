-- A wallet's whole activity history, one row per activity row, for wallets
-- whose `wallet-activity` document holds only their latest events (the
-- snapshot reads 80 a wallet). The document stays the first pages; the
-- API's internal activity route pages on into these rows, oldest last.
-- Written only by the warehouse snapshot (apps/jobs/src/warehouse/history.ts).
-- Additive only: two new tables, nothing else changes.
CREATE TABLE IF NOT EXISTS wallet_activity_rows (
  network TEXT NOT NULL,
  -- Lower-case address.
  wallet TEXT NOT NULL,
  -- The row's timestamp (unix seconds) and its id, `{txHash}-{logIndex}`:
  -- the order pages are read in, newest first.
  sort_ts INTEGER NOT NULL,
  row_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  -- Epoch number of sort_ts, -1 before Epoch 0.
  epoch INTEGER NOT NULL,
  -- votes, claims, locks, incentives or system (the Activity filters).
  category TEXT NOT NULL,
  -- The ActivityRow as JSON, validated on write and on read.
  body TEXT NOT NULL,
  -- Covers the row without its USD values: a row is rewritten only when
  -- something else in it changed.
  etag TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, wallet, sort_ts, row_id)
) WITHOUT ROWID;

-- A wallet's claims, for its Earned total (read on every rebuild) and the
-- Claims filter: claim rows only, so it costs one more row write per claim
-- (about 13% of the busy wallets' rows) and none for the others. A full
-- category index doubled every write. Production has no sqlite_stat1, and
-- without it the planner keeps to the primary key, so the queries name it
-- (INDEXED BY). The other filters walk the wallet's rows by the primary key
-- from the cursor until a page is full: about a page over the filter's
-- share of the wallet, at most the wallet's rows (about 4,500 for the
-- busiest) for a filter it has little or none of. Rows read cost far less
-- than rows written. Measured in apps/api's
-- wallet-history-cost.workers.test.ts.
CREATE INDEX IF NOT EXISTS wallet_activity_rows_claims
  ON wallet_activity_rows (network, wallet, sort_ts, row_id)
  WHERE category = 'claims';

-- What wallet_activity_rows holds for a wallet: every transaction from
-- (low_ts, low_tx) up to (high_ts, high_tx), both included, in the
-- warehouse's order (timestamp, then transaction hash). complete = 1 once
-- nothing older exists.
CREATE TABLE IF NOT EXISTS wallet_history_state (
  network TEXT NOT NULL,
  wallet TEXT NOT NULL,
  low_ts INTEGER NOT NULL,
  low_tx TEXT NOT NULL,
  high_ts INTEGER NOT NULL,
  high_tx TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, wallet)
);

CREATE INDEX IF NOT EXISTS wallet_history_state_backfill
  ON wallet_history_state (network, complete, updated_at);
