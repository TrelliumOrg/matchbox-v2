-- Borrowing beyond mUSD troves (warehouse-only): Morpho Blue markets and
-- Enclave debt (docs/research/mezo-borrow-markets.md). Additive: new tables
-- only, nothing existing changes, so the live Worker runs unchanged until
-- the new one replaces it.
--
-- The borrow stream (src/borrow) has its own checkpoint row
-- (matchbox.indexer_checkpoints, stream 'borrow'), its own contract registry
-- and its own decoder version. It decodes logs straight into these tables
-- in the same transaction that advances its checkpoint, so it stores no raw
-- rows. Amounts are numeric(78,0) base units, like trove_updates: Morpho
-- asset amounts in the market's loan or collateral token (decimals on
-- morpho_markets), Morpho shares as Morpho counts them, Enclave debt in MUSD
-- (18 decimals) and veBTC lock amounts in BTC (18 decimals).

CREATE TABLE IF NOT EXISTS matchbox.borrow_contracts (
  network text NOT NULL REFERENCES matchbox.networks(slug),
  address text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('morphoBlue', 'enclaveDebtManager', 'enclave')),
  template text NOT NULL,
  created_block bigint NOT NULL,
  created_tx text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, address),
  CHECK (address = lower(address))
);

COMMENT ON TABLE matchbox.borrow_contracts IS
  'Contracts the borrow stream fetches logs for: Morpho Blue, the EnclaveDebtManager, and every Enclave (static, or granted ENCLAVE_ROLE later).';
COMMENT ON COLUMN matchbox.borrow_contracts.created_block IS
  'First block the borrow stream fetches logs from. A discovered Enclave is back-filled from the first Enclave deployment.';

CREATE TABLE IF NOT EXISTS matchbox.borrow_state (
  network text PRIMARY KEY REFERENCES matchbox.networks(slug),
  decoder_version int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE matchbox.borrow_state IS
  'Decoder version the borrow tables were built with. A different version halts the borrow stream until scripts/backfill-borrow.ts --replay.';

CREATE TABLE IF NOT EXISTS matchbox.morpho_markets (
  network text NOT NULL REFERENCES matchbox.networks(slug),
  market_id text NOT NULL,
  loan_token text NOT NULL,
  collateral_token text NOT NULL,
  oracle text NOT NULL,
  irm text NOT NULL,
  lltv numeric(78, 0) NOT NULL,
  loan_decimals smallint,
  collateral_decimals smallint,
  fee numeric(78, 0) NOT NULL,
  total_supply_assets numeric(78, 0) NOT NULL,
  total_supply_shares numeric(78, 0) NOT NULL,
  total_borrow_assets numeric(78, 0) NOT NULL,
  total_borrow_shares numeric(78, 0) NOT NULL,
  total_collateral numeric(78, 0) NOT NULL,
  last_update bigint NOT NULL,
  created_block bigint NOT NULL,
  created_tx text NOT NULL,
  created_timestamp bigint NOT NULL,
  updated_block bigint NOT NULL,
  decoder_version int NOT NULL,
  PRIMARY KEY (network, market_id)
);

COMMENT ON TABLE matchbox.morpho_markets IS
  'Morpho Blue markets and their totals replayed from events, equal to Morpho.market(id) at updated_block. total_collateral is the sum of positions (Morpho does not store it).';
COMMENT ON COLUMN matchbox.morpho_markets.lltv IS
  'Liquidation LTV scaled by 1e18 (86% is 860000000000000000).';
COMMENT ON COLUMN matchbox.morpho_markets.fee IS
  'Share of interest paid to the fee recipient, scaled by 1e18.';
COMMENT ON COLUMN matchbox.morpho_markets.last_update IS
  'Unix timestamp of the last interest accrual (Morpho lastUpdate).';

CREATE TABLE IF NOT EXISTS matchbox.morpho_events (
  network text NOT NULL REFERENCES matchbox.networks(slug),
  tx_hash text NOT NULL,
  log_index bigint NOT NULL,
  block_number bigint NOT NULL,
  timestamp bigint NOT NULL,
  tx_from text NOT NULL,
  market_id text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'MARKET_CREATED', 'SUPPLIED', 'WITHDRAWN', 'COLLATERAL_SUPPLIED',
    'COLLATERAL_WITHDRAWN', 'BORROWED', 'REPAID', 'LIQUIDATED',
    'INTEREST_ACCRUED', 'FEE_SET'
  )),
  caller text,
  on_behalf text,
  receiver text,
  assets numeric(78, 0),
  shares numeric(78, 0),
  seized_assets numeric(78, 0),
  bad_debt_assets numeric(78, 0),
  bad_debt_shares numeric(78, 0),
  prev_borrow_rate numeric(78, 0),
  fee_shares numeric(78, 0),
  fee numeric(78, 0),
  decoder_version int NOT NULL,
  PRIMARY KEY (network, tx_hash, log_index)
);

COMMENT ON TABLE matchbox.morpho_events IS
  'Morpho Blue market events, one row per log. on_behalf is the position owner (the borrower for LIQUIDATED). assets is the interest for INTEREST_ACCRUED and the repaid assets for LIQUIDATED.';
COMMENT ON COLUMN matchbox.morpho_events.prev_borrow_rate IS
  'Borrow rate per second, scaled by 1e18, used for the accrual (AccrueInterest).';

-- A market's history, and a wallet's.
CREATE INDEX IF NOT EXISTS morpho_events_market_idx
  ON matchbox.morpho_events (network, market_id, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS morpho_events_on_behalf_idx
  ON matchbox.morpho_events (network, on_behalf, block_number DESC);

CREATE TABLE IF NOT EXISTS matchbox.enclave_events (
  network text NOT NULL REFERENCES matchbox.networks(slug),
  tx_hash text NOT NULL,
  log_index bigint NOT NULL,
  ve_btc_token_id numeric(78, 0) NOT NULL,
  block_number bigint NOT NULL,
  timestamp bigint NOT NULL,
  tx_from text NOT NULL,
  contract_address text NOT NULL,
  enclave text NOT NULL,
  position_id text,
  borrower text,
  action text NOT NULL CHECK (action IN (
    'POSITION_OPENED', 'DEBT_INCREASED', 'DEBT_REPAID', 'POSITION_CLOSED',
    'COLLATERAL_PLEDGED', 'COLLATERAL_RELEASED', 'INTEREST_RATE_SET',
    'ORIGINATOR_FEE_RATE_SET', 'CR_THRESHOLDS_SET', 'VEBTC_LOCKED',
    'VEBTC_INCREASED', 'VEBTC_MERGED', 'VEBTC_WITHDRAWN'
  )),
  amount numeric(78, 0),
  principal numeric(78, 0),
  interest_rate integer,
  originator_fee_rate integer,
  warning_cr numeric(78, 0),
  minimum_cr numeric(78, 0),
  lock_duration bigint,
  other_ve_btc_token_id numeric(78, 0),
  pledged_ve_btc numeric(78, 0)[] NOT NULL,
  decoder_version int NOT NULL,
  PRIMARY KEY (network, tx_hash, log_index, ve_btc_token_id)
);

COMMENT ON TABLE matchbox.enclave_events IS
  'Enclave debt and veBTC collateral history. Debt rows (DEBT_*, *_SET) carry the position''s lowest pledged veBTC; collateral rows (POSITION_OPENED, POSITION_CLOSED, COLLATERAL_*) have one row per veBTC that moved, with amount only on the lowest; VEBTC_* rows come from the Enclave itself. The EnclaveDebtManager has no liquidation path, so no liquidation action exists.';
COMMENT ON COLUMN matchbox.enclave_events.amount IS
  'MUSD base units for POSITION_OPENED (debt), DEBT_INCREASED and DEBT_REPAID (fees first, then principal); BTC base units for VEBTC_LOCKED and VEBTC_INCREASED.';
COMMENT ON COLUMN matchbox.enclave_events.principal IS
  'Position principal after the event, in MUSD base units.';
COMMENT ON COLUMN matchbox.enclave_events.pledged_ve_btc IS
  'veBTC token ids pledged to the position after the event (empty when the token is in no position).';

-- Latest state per position (the decoder''s load), a veBTC's history, and
-- protocol-wide recent activity.
CREATE INDEX IF NOT EXISTS enclave_events_position_idx
  ON matchbox.enclave_events (network, position_id, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS enclave_events_token_idx
  ON matchbox.enclave_events (network, ve_btc_token_id, block_number DESC);
CREATE INDEX IF NOT EXISTS enclave_events_action_idx
  ON matchbox.enclave_events (network, action, timestamp DESC);

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_indexer') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON matchbox.borrow_contracts,
      matchbox.borrow_state, matchbox.morpho_markets, matchbox.morpho_events,
      matchbox.enclave_events TO matchbox_indexer;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_api_ro') THEN
    GRANT SELECT ON matchbox.morpho_markets, matchbox.morpho_events,
      matchbox.enclave_events TO matchbox_api_ro;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_pro_rw') THEN
    GRANT SELECT ON matchbox.morpho_markets, matchbox.morpho_events,
      matchbox.enclave_events TO matchbox_pro_rw;
  END IF;
END
$grants$;
