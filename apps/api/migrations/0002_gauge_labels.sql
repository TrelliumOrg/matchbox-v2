-- Names and pictures for gauges the voters do not describe (CL pools,
-- pools of unknown tokens, vaults, cross-chain gauges), resolved once by the
-- gauge publish (src/read-models/gauge-labels.ts) and never rewritten.
CREATE TABLE IF NOT EXISTS gauge_labels (
  network TEXT NOT NULL,
  gauge_address TEXT NOT NULL,
  -- JSON GaugeLabel: { type: "pair" | "vault" | "named", ... }
  label TEXT NOT NULL,
  -- Unix seconds.
  created_at INTEGER NOT NULL,
  PRIMARY KEY (network, gauge_address)
);

-- The owner's facts about MEZO gauges (ThirdPartyVoter) that the chain does
-- not hold: destination chain, protocol, pool or program, a link. Filled by
-- hand; the gauge publish only reads it, and a row here wins over chain
-- reads and the creation metadata. Example:
--   INSERT INTO mezo_gauge_destinations (network, gauge_address, chain,
--     protocol, destination, url, note, updated_at)
--   VALUES ('mezo', '0x2ced96e759ab481210d41c567eee5c42edb59a1d', 'Ethereum',
--     'Uniswap v4', 'USDC/MUSD 0.01%', NULL, 'from Mezo docs', unixepoch());
CREATE TABLE IF NOT EXISTS mezo_gauge_destinations (
  network TEXT NOT NULL,
  gauge_address TEXT NOT NULL,
  chain TEXT,
  protocol TEXT,
  destination TEXT,
  url TEXT,
  note TEXT,
  -- Unix seconds.
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, gauge_address)
);
