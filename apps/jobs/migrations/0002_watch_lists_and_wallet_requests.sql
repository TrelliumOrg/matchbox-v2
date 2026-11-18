-- Watch lists and the on-demand wallet queue.

-- A wallet's watch list: gauges and other wallets it follows. Written by the
-- API's /internal/pro/wallets/{address}/watchlist routes. client_id is the
-- unsigned browser id that added the item.
-- TODO(matchbox-id): key lists by the signed-in Matchbox ID account.
CREATE TABLE IF NOT EXISTS watch_items (
  network TEXT NOT NULL,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gauge', 'wallet')),
  address TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  PRIMARY KEY (network, owner, kind, address)
);

-- Wallets the API served from RPC because the warehouse sweep had not
-- reached them. The next warehouse snapshot builds full documents for them
-- (history included) and deletes the row. One row per wallet, so repeat
-- visits cost no extra writes.
CREATE TABLE IF NOT EXISTS wallet_requests (
  network TEXT NOT NULL,
  wallet TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (network, wallet)
);
