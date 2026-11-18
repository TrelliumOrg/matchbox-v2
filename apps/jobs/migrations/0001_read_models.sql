-- READ_DB: Matchbox Pro read models and live chain state.
-- Written only by matchbox-jobs (and the API's market cron for gauge
-- documents); the API's request path only reads.
--
-- Amounts are TEXT. SQLite has no exact DECIMAL (its NUMERIC affinity turns
-- large values into floats), so exact decimal strings are the only safe
-- storage. Columns ending in _raw hold base-unit integers; the rest hold
-- whole-unit decimals ("0.000412", "105710.25").

-- One JSON document per read model, validated with the
-- @matchbox/contracts/read-models schema of its kind on write and on read.
-- etag covers the price-independent content, so a document is rewritten only
-- when something other than a USD value changed.
CREATE TABLE IF NOT EXISTS read_models (
  network TEXT NOT NULL,
  kind TEXT NOT NULL,
  -- "current" for singletons, a lower-case address for wallet and gauge docs
  doc_key TEXT NOT NULL,
  body TEXT NOT NULL,
  etag TEXT NOT NULL,
  block INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('warehouse', 'live', 'fixture')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, kind, doc_key)
);

-- One row per token per minute; the 24h change and historic USD values.
CREATE TABLE IF NOT EXISTS price_samples (
  token TEXT NOT NULL CHECK (token IN ('btc', 'mezo')),
  sampled_at INTEGER NOT NULL,
  usd TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (token, sampled_at)
);

CREATE TABLE IF NOT EXISTS morpho_markets (
  network TEXT NOT NULL,
  market_id TEXT NOT NULL,
  loan_token TEXT NOT NULL,
  collateral_token TEXT NOT NULL,
  oracle TEXT NOT NULL,
  irm TEXT NOT NULL,
  lltv_raw TEXT NOT NULL,
  total_supply_assets_raw TEXT NOT NULL,
  total_supply_shares_raw TEXT NOT NULL,
  total_borrow_assets_raw TEXT NOT NULL,
  total_borrow_shares_raw TEXT NOT NULL,
  fee_raw TEXT NOT NULL,
  last_update INTEGER NOT NULL,
  -- Borrow rate per second, 18 decimals (AdaptiveCurveIrm.borrowRateView)
  borrow_rate_raw TEXT,
  -- Oracle price, 36 decimals scaled by the token decimals (Morpho convention)
  oracle_price_raw TEXT,
  block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, market_id)
);

CREATE TABLE IF NOT EXISTS morpho_positions (
  network TEXT NOT NULL,
  market_id TEXT NOT NULL,
  account TEXT NOT NULL,
  supply_shares_raw TEXT NOT NULL,
  borrow_shares_raw TEXT NOT NULL,
  collateral_raw TEXT NOT NULL,
  block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, market_id, account)
);

-- Every account seen in Supply, Borrow or SupplyCollateral logs; positions
-- are re-read for all of them each run (closed ones drop out of the table
-- above but stay here).
CREATE TABLE IF NOT EXISTS morpho_accounts (
  network TEXT NOT NULL,
  account TEXT NOT NULL,
  first_seen_block INTEGER NOT NULL,
  PRIMARY KEY (network, account)
);

CREATE INDEX IF NOT EXISTS morpho_positions_account
  ON morpho_positions (network, account);

CREATE TABLE IF NOT EXISTS troves (
  network TEXT NOT NULL,
  owner TEXT NOT NULL,
  -- musd TroveStatus name: active, closedByOwner, closedByLiquidation, ...
  status TEXT NOT NULL,
  coll_raw TEXT NOT NULL,
  principal_raw TEXT NOT NULL,
  interest_raw TEXT NOT NULL,
  -- Basis points
  interest_rate INTEGER NOT NULL,
  block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, owner)
);

CREATE TABLE IF NOT EXISTS stability_pool (
  network TEXT PRIMARY KEY,
  total_musd_deposits_raw TEXT NOT NULL,
  total_collateral_raw TEXT NOT NULL,
  block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Progress markers: the warehouse block cursor, the Morpho log scan, ...
CREATE TABLE IF NOT EXISTS job_cursors (
  job TEXT NOT NULL,
  network TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (job, network)
);

CREATE TABLE IF NOT EXISTS snapshot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  network TEXT NOT NULL,
  -- 'chained' (called by the indexer) or 'cron'
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'skipped')),
  block INTEGER,
  rows_written INTEGER,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS snapshot_runs_recent
  ON snapshot_runs (job, network, started_at DESC);
