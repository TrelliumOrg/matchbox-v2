-- MUSD and MEZO across chains (apps/jobs/src/crosschain, README "Cross-chain
-- data"): market quotes per venue, daily price closes for a peg chart,
-- supply by chain, pool depth, volume and APR, and Wormhole NTT bridge
-- flows. Written by matchbox-jobs only; read by the API's
-- /internal/scan/crosschain routes. USD figures are decimal TEXT, token
-- amounts base-unit integer TEXT. Every table is new: applying this changes
-- no existing row.

-- The latest reading per asset and venue ("headline" is the published
-- price). Rewritten every minute; one row per venue, never grows.
CREATE TABLE IF NOT EXISTS market_quotes (
  asset TEXT NOT NULL,
  venue TEXT NOT NULL,
  chain TEXT,
  price TEXT NOT NULL,
  depth_usd TEXT,
  method TEXT NOT NULL,
  source TEXT NOT NULL,
  block TEXT,
  -- Unix seconds of the reading.
  read_at INTEGER NOT NULL,
  -- JSON, headline only: spread and the venues it used.
  detail TEXT,
  PRIMARY KEY (asset, venue)
);

-- Each venue's (and the headline's) last reading of a UTC day, written at
-- the hourly price-close minutes. Kept forever: the peg chart.
CREATE TABLE IF NOT EXISTS market_price_daily (
  asset TEXT NOT NULL,
  venue TEXT NOT NULL,
  -- YYYY-MM-DD (UTC).
  day TEXT NOT NULL,
  price TEXT NOT NULL,
  depth_usd TEXT,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (asset, venue, day)
);

-- A chart reads one asset's days across venues.
CREATE INDEX IF NOT EXISTS market_price_daily_by_day
  ON market_price_daily (asset, day);

-- Supply per asset, chain and day: rewritten each hour, so today's row is
-- the current figure and earlier rows are closes.
CREATE TABLE IF NOT EXISTS token_supply_daily (
  asset TEXT NOT NULL,
  chain TEXT NOT NULL,
  day TEXT NOT NULL,
  total_supply TEXT NOT NULL,
  -- The hub (Mezo) NTT manager's balance; NULL on burn-and-mint chains.
  locked TEXT,
  circulating TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  block TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (asset, chain, day)
);

CREATE INDEX IF NOT EXISTS token_supply_daily_by_day
  ON token_supply_daily (asset, day);

-- One pool's depth, 24h volume and APR split per day (latest reading of
-- the day). APR parts are percent a year as TEXT; NULL with the reason in
-- `unavailable` (JSON {field: reason}).
CREATE TABLE IF NOT EXISTS pool_daily (
  pool_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tvl_usd TEXT,
  volume_24h_usd TEXT,
  apr_fees TEXT,
  apr_rewards TEXT,
  apr_merkl TEXT,
  apr_gauge TEXT,
  -- JSON {field: source}.
  sources TEXT NOT NULL,
  unavailable TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pool_id, day)
);

-- The pools route reads every pool's last 7 days.
CREATE INDEX IF NOT EXISTS pool_daily_by_day ON pool_daily (day);

-- Wormholescan's all-time totals per route, snapshot daily; a day's flow
-- on a route is the change from the previous snapshot.
CREATE TABLE IF NOT EXISTS bridge_route_totals (
  asset TEXT NOT NULL,
  from_chain TEXT NOT NULL,
  to_chain TEXT NOT NULL,
  day TEXT NOT NULL,
  transfers_total INTEGER NOT NULL,
  notional_usd_total TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (asset, from_chain, to_chain, day)
);

CREATE INDEX IF NOT EXISTS bridge_route_totals_by_day
  ON bridge_route_totals (asset, day);

-- Transfers and USD per day across every route (Wormholescan's own daily
-- series).
CREATE TABLE IF NOT EXISTS bridge_daily (
  asset TEXT NOT NULL,
  day TEXT NOT NULL,
  transfers INTEGER NOT NULL,
  notional_usd TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (asset, day)
);
