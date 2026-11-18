-- Each voter's epoch: its gauges' priced rewards, its total vote weight and
-- the voting APR they give (src/market/voter-epochs.ts), computed from the
-- market cron's own stored rows. Written by the */5 cron only; read by
-- /internal/scan/apr. New table: applying this changes no existing row.
CREATE TABLE IF NOT EXISTS market_voter_epochs (
  network TEXT NOT NULL,
  epoch_start INTEGER NOT NULL,
  voter TEXT NOT NULL,
  total_usd TEXT,
  weight TEXT,
  voting_token_usd TEXT,
  apr_percent TEXT,
  funded_gauges INTEGER NOT NULL,
  unpriced_rewards INTEGER NOT NULL,
  -- 1 while the epoch ran when the row was written; 0 once final.
  open INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, epoch_start, voter)
);
