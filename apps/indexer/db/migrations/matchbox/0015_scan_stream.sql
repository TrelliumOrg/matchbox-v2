-- The scan stream (src/scan-stream): token transfer rollups and mUSD fees
-- for Matchscan, decoded straight from Mezo RPC into these tables in the
-- same transaction that advances its checkpoint (matchbox.indexer_checkpoints,
-- stream 'scan'), like the borrow stream. It stores no raw rows, so
-- matchbox_raw and its retention are unchanged. Additive: new tables only.
--
-- Both tables carry row_seq from the start, stamped and tombstoned by the
-- functions in 0013_row_seq.sql, so a reader copies them like the others.
-- Amounts are numeric(78,0) token base units; select them ::text.

CREATE TABLE IF NOT EXISTS matchbox.token_transfer_days (
  network text NOT NULL REFERENCES matchbox.networks(slug),
  token text NOT NULL CHECK (token = lower(token)),
  day date NOT NULL,
  transfers bigint NOT NULL CHECK (transfers >= 0),
  volume numeric(78, 0) NOT NULL CHECK (volume >= 0),
  minted numeric(78, 0) NOT NULL CHECK (minted >= 0),
  burned numeric(78, 0) NOT NULL CHECK (burned >= 0),
  row_seq bigint NOT NULL,
  PRIMARY KEY (network, token, day)
);

COMMENT ON TABLE matchbox.token_transfer_days IS
  'ERC-20 Transfer events per token and UTC day (block timestamp): count, summed value, and the value of Transfers from (minted) and to (burned) the zero address. A day is complete once the scan checkpoint passes its last block. Mint and burn count real Transfer events only: MEZO (genesis supply) and the bridged mUSDC, mUSDT, mSolvBTC and mcbBTC gain supply without any event, so their supply cannot be derived from these rows (@matchbox/chain SCAN_STREAM_TOKENS).';
COMMENT ON COLUMN matchbox.token_transfer_days.volume IS
  'Sum of Transfer values in token base units, mints, burns and self-transfers included.';

CREATE TABLE IF NOT EXISTS matchbox.musd_fees (
  network text NOT NULL REFERENCES matchbox.networks(slug),
  tx_hash text NOT NULL,
  log_index bigint NOT NULL,
  block_number bigint NOT NULL,
  timestamp bigint NOT NULL,
  contract_address text NOT NULL,
  fee_type text NOT NULL CHECK (fee_type IN (
    'BORROWING', 'REFINANCING', 'REDEMPTION', 'INTEREST', 'ENCLAVE'
  )),
  borrower text,
  asset text NOT NULL CHECK (asset IN ('MUSD', 'BTC')),
  amount numeric(78, 0) NOT NULL CHECK (amount >= 0),
  redemption_attempted numeric(78, 0),
  redemption_actual numeric(78, 0),
  redemption_collateral_sent numeric(78, 0),
  decoder_version int NOT NULL,
  row_seq bigint NOT NULL,
  PRIMARY KEY (network, tx_hash, log_index)
);

COMMENT ON TABLE matchbox.musd_fees IS
  'mUSD fees, one row per fee event, from BorrowerOperations deployment (block 178,630). BORROWING and REFINANCING: BorrowingFeePaid / RefinancingFeePaid, MUSD minted to PCV. REDEMPTION: Redemption collateral fee, BTC. INTEREST: MUSD minted to PCV in a transaction that changed trove debt (ActivePoolDebtUpdated), beyond its BORROWING and REFINANCING fees: the interest troves paid. ENCLAVE: MUSD minted to PCV in a transaction where EnclaveDebtManager accrued interest or an originator fee or moved debt: Enclave interest and fees. Both keyed by the last MUSD Transfer(0x0, PCV) log of the transaction. Other mints to PCV (the 100M MUSD bootstrap loan at block 179,091) are not fees and have no row.';
COMMENT ON COLUMN matchbox.musd_fees.borrower IS
  'The fee event''s borrower; NULL for REDEMPTION, INTEREST and ENCLAVE.';

-- Time-ordered reads (a fee chart) and the reader's row_seq window.
CREATE INDEX IF NOT EXISTS musd_fees_type_idx
  ON matchbox.musd_fees (network, fee_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS musd_fees_row_seq_idx
  ON matchbox.musd_fees (network, row_seq);
CREATE INDEX IF NOT EXISTS token_transfer_days_row_seq_idx
  ON matchbox.token_transfer_days (network, row_seq);

CREATE TABLE IF NOT EXISTS matchbox.scan_stream_state (
  network text PRIMARY KEY REFERENCES matchbox.networks(slug),
  decoder_version int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE matchbox.scan_stream_state IS
  'Decoder version the scan stream tables were built with. A different version halts the scan stream until scripts/backfill-scan.ts --replay.';

-- The 0013 triggers, as on the other tracked tables.
DO $tracked$
DECLARE
  tracked record;
BEGIN
  FOR tracked IN
    SELECT * FROM (VALUES
      ('token_transfer_days', ARRAY['token', 'day']),
      ('musd_fees', ARRAY['tx_hash', 'log_index'])
    ) AS t(table_name, key_columns)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_row_seq_insert', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON matchbox.%I
         FOR EACH ROW EXECUTE FUNCTION matchbox.stamp_row_seq()',
      tracked.table_name || '_row_seq_insert', tracked.table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_row_seq_update', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON matchbox.%I
         FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
         EXECUTE FUNCTION matchbox.stamp_row_seq()',
      tracked.table_name || '_row_seq_update', tracked.table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_tombstone', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON matchbox.%I
         FOR EACH ROW EXECUTE FUNCTION matchbox.record_deleted_row(%s)',
      tracked.table_name || '_tombstone', tracked.table_name,
      (SELECT string_agg(quote_literal(column_name), ', ')
       FROM unnest(tracked.key_columns) AS column_name));
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_reset', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER TRUNCATE ON matchbox.%I
         FOR EACH STATEMENT EXECUTE FUNCTION matchbox.record_table_reset()',
      tracked.table_name || '_reset', tracked.table_name);
  END LOOP;
END
$tracked$;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_indexer') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON matchbox.token_transfer_days,
      matchbox.musd_fees, matchbox.scan_stream_state TO matchbox_indexer;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_api_ro') THEN
    GRANT SELECT ON matchbox.token_transfer_days, matchbox.musd_fees
      TO matchbox_api_ro;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_pro_rw') THEN
    GRANT SELECT ON matchbox.token_transfer_days, matchbox.musd_fees
      TO matchbox_pro_rw;
  END IF;
END
$grants$;
