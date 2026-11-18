-- The protocol's own BTC price beside the trove and Stability Pool rows:
-- MUSD's PriceFeed.fetchPrice() (a view), read by the live snapshot (*/5)
-- in the same multicall and at the same block as the pool totals. MUSD
-- prices every trove (ICR, liquidation, recovery mode) with this price, not
-- the market price.
--
-- musd_btc_price_raw   USD per BTC, an integer as TEXT at
--                      musd_btc_price_scale decimals (always 18); NULL when
--                      fetchPrice() reverted (oracle stale: the protocol
--                      cannot price troves at that block) or before the
--                      first read after this migration.
-- musd_btc_price_scale 18, or NULL with the price.
-- musd_btc_price_block The block the stored value was read at. The row is
--                      rewritten only when a value changes, so a later run
--                      that read the same price leaves the earlier block.
--
-- Additive only: nullable columns with no default, so the existing row and
-- every reader that names its columns are unaffected.
ALTER TABLE stability_pool ADD COLUMN musd_btc_price_raw TEXT;
ALTER TABLE stability_pool ADD COLUMN musd_btc_price_scale INTEGER;
ALTER TABLE stability_pool ADD COLUMN musd_btc_price_block INTEGER;
