-- Morpho Blue markets discovered from CreateMarket logs by the live
-- snapshot's log scan (the same windows as morpho_accounts), so every
-- market is read, not only the ones configured in @matchbox/chain.
-- Written before the scan's cursor moves; INSERT OR IGNORE (a market's
-- parameters never change). loan_decimals and collateral_decimals are the
-- tokens' ERC-20 decimals() read on chain when the market was found, NULL
-- when the token did not answer: a reader must then not assume 18.
-- Additive only: a new table, nothing else changes.
CREATE TABLE IF NOT EXISTS morpho_known_markets (
  network TEXT NOT NULL,
  market_id TEXT NOT NULL,
  loan_token TEXT NOT NULL,
  collateral_token TEXT NOT NULL,
  oracle TEXT NOT NULL,
  irm TEXT NOT NULL,
  lltv_raw TEXT NOT NULL,
  loan_decimals INTEGER,
  collateral_decimals INTEGER,
  created_block INTEGER NOT NULL,
  discovered_at INTEGER NOT NULL,
  PRIMARY KEY (network, market_id)
);
