-- What a claim's tokens were worth when it was claimed: one USD price per
-- token per UTC day, the price at 00:00 UTC that day, stored once and never
-- rewritten. A claim is valued at the price of its own UTC day
-- (apps/api/src/read-models/claim-prices.ts). Registry stablecoins are $1
-- and BTC wrappers take BTC's price, by registry address, so only BTC and
-- MEZO need a history.
--
-- Written only by the warehouse snapshot (apps/jobs/src/warehouse/
-- claim-prices.ts), from CoinGecko's daily history, a day at a time once
-- the day is settled (CoinGecko revises a day for up to 2 days). How far
-- each token's history has been checked is in job_cursors
-- (`claim-prices-btc`, `claim-prices-mezo`): a checked day with no row had
-- no price.
--
-- Additive only: one new table.
CREATE TABLE IF NOT EXISTS token_price_daily (
  token TEXT NOT NULL CHECK (token IN ('btc', 'mezo')),
  -- YYYY-MM-DD (UTC): the price is the one at 00:00 UTC that day.
  day TEXT NOT NULL,
  -- USD per whole token, an exact decimal string.
  usd TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('coingecko')),
  -- The source's data point, unix seconds.
  priced_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (token, day)
) WITHOUT ROWID;
