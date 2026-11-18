-- veBTC and veMEZO `supply()`: the BTC and MEZO locked in each escrow, read
-- by the live RPC snapshot (*/5) and used for the protocol's locked totals.
-- The warehouse's lock positions undercount locks created before the
-- indexer's escrow history and miss some splits, so totals come from chain.
-- A row is rewritten only when the supply changes.
CREATE TABLE IF NOT EXISTS escrow_supply (
  network TEXT NOT NULL,
  escrow TEXT NOT NULL CHECK (escrow IN ('vebtc', 'vemezo')),
  -- Base units (18 decimals).
  supply_raw TEXT NOT NULL,
  block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, escrow)
);
