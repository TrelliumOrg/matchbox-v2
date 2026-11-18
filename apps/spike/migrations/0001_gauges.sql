CREATE TABLE IF NOT EXISTS gauges (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pool', 'vebtc', 'validator')),
  tagline TEXT NOT NULL,
  apy TEXT NOT NULL,
  votes INTEGER NOT NULL,
  incentives_usd TEXT NOT NULL
);
