-- Governance summaries (apps/jobs/src/scan/governance.ts and
-- lock-distribution.ts, README "Governance summaries"): emissions per gauge
-- per epoch, each voter's epoch totals, and the escrows' lock distribution
-- read from the chain once a day. Written by matchbox-jobs only; read by
-- the API's /internal/scan routes. Amounts are base-unit integer TEXT.
-- Every table is new: applying this changes no existing row.

-- MEZO each voter distributed to a gauge in an epoch (DistributeReward rows
-- of `activity`, summed). Recomputed from `activity`, so it repairs itself.
CREATE TABLE IF NOT EXISTS gauge_emissions (
  gauge TEXT NOT NULL,
  epoch_start INTEGER NOT NULL,
  source TEXT NOT NULL,
  amount TEXT NOT NULL,
  events INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (gauge, epoch_start)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS gauge_emissions_epoch
  ON gauge_emissions (epoch_start, source, gauge);

-- One row per voter source per epoch: emissions distributed (NULL before
-- the copied DistributeReward history), and the incentives, fees, vote
-- weight and gauge count from `gauge_epoch`.
CREATE TABLE IF NOT EXISTS epoch_sources (
  epoch_start INTEGER NOT NULL,
  source TEXT NOT NULL,
  emissions TEXT,
  incentives TEXT NOT NULL DEFAULT '{}',
  fees TEXT NOT NULL DEFAULT '{}',
  vote_weight TEXT NOT NULL,
  gauges INTEGER NOT NULL,
  emission_gauges INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (epoch_start, source)
) WITHOUT ROWID;

-- One validated JSON document per escrow per UTC day: every lock id's
-- locked() at one block (scanLockDistributionSchema). Kept forever, two
-- rows a day.
CREATE TABLE IF NOT EXISTS lock_distribution (
  escrow TEXT NOT NULL,
  day TEXT NOT NULL,
  block INTEGER NOT NULL,
  data TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (escrow, day)
) WITHOUT ROWID;
