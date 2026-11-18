-- matchbox-scan (binding SCAN_DB): Matchscan's explorer read models, mainnet
-- only. Written by matchbox-jobs (src/scan) and read by the API's
-- /internal/scan routes. Rows, not documents: every list is one indexed range
-- scan with a keyset cursor, never an offset.
--
-- Conventions:
-- - Addresses and hashes are lower-case 0x hex TEXT.
-- - Amounts, weights and token ids are base-unit integers as decimal TEXT
--   (never REAL). Signed changes carry a leading '-'.
-- - `*_key` columns are the same integer left-padded with zeros to 40
--   digits, so TEXT order is numeric order (amount and weight sorting).
-- - Block, log index and unix-second timestamps are INTEGER.
-- - Event lists are ordered by (block_number, log_index), newest first.
--   Lists over the whole table or one action type are ordered by
--   (timestamp, block_number, log_index): the same order, since a block has
--   one timestamp, and it also serves day ranges.
-- - USD is never stored here. It is applied at read time from price_daily
--   and the live prices.

-- Decoded activity, copied from Neon matchbox.activity_events.
CREATE TABLE IF NOT EXISTS activity (
  -- {txHash}-{logIndex}-{ACTION_TYPE}
  id TEXT PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  epoch_start INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  source TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_from TEXT,
  actor TEXT,
  recipient TEXT,
  -- The escrow a lock's token id belongs to, where the source says so
  -- (voting escrow events, and the voters: veBTC for pools and validators,
  -- veMEZO for boost and third party). Null when unknown.
  lock_escrow TEXT,
  token_id TEXT,
  amount TEXT,
  token TEXT,
  -- The gauge, with PoolsVoter's pool mapped to its gauge.
  gauge TEXT,
  pool TEXT,
  reward_contract TEXT,
  weight TEXT,
  -- Every other non-null decoded field, as a JSON object of strings and
  -- booleans (amounts stay decimal strings).
  extra TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS activity_time
  ON activity (timestamp DESC, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS activity_tx
  ON activity (tx_hash, log_index);
CREATE INDEX IF NOT EXISTS activity_actor
  ON activity (actor, block_number DESC, log_index DESC)
  WHERE actor IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_recipient
  ON activity (recipient, block_number DESC, log_index DESC)
  WHERE recipient IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_gauge
  ON activity (gauge, block_number DESC, log_index DESC)
  WHERE gauge IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_lock
  ON activity (lock_escrow, token_id, block_number DESC, log_index DESC)
  WHERE token_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_epoch
  ON activity (epoch_start, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS activity_action
  ON activity (action_type, timestamp DESC, block_number DESC, log_index DESC);

-- Lock state, copied from Neon matchbox.lock_positions. The warehouse's
-- escrow history starts at block 7.74M, so locks created earlier carry only
-- later deposits (apps/jobs README, "Locks").
CREATE TABLE IF NOT EXISTS locks (
  escrow TEXT NOT NULL,
  token_id TEXT NOT NULL,
  owner TEXT,
  amount TEXT NOT NULL,
  amount_key TEXT NOT NULL,
  -- 0 for a permanent lock.
  unlock_at INTEGER,
  created_at INTEGER,
  last_extended_at INTEGER,
  withdrawn_at INTEGER,
  is_permanent INTEGER NOT NULL,
  is_withdrawn INTEGER NOT NULL,
  is_merged INTEGER NOT NULL,
  merged_into_token_id TEXT,
  merged_at INTEGER,
  boost TEXT,
  activity_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (escrow, token_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS locks_owner
  ON locks (owner, escrow, token_id);
CREATE INDEX IF NOT EXISTS locks_by_amount
  ON locks (escrow, amount_key DESC, token_id)
  WHERE is_withdrawn = 0 AND is_merged = 0;
CREATE INDEX IF NOT EXISTS locks_by_unlock
  ON locks (escrow, unlock_at, token_id)
  WHERE is_withdrawn = 0 AND is_merged = 0;
CREATE INDEX IF NOT EXISTS locks_by_created
  ON locks (escrow, created_at DESC, token_id);

-- Each lock's vote on each gauge in each epoch. Votes carry into the next
-- epoch until the lock re-votes or resets (carried = 1 for a row copied
-- forward, 0 for one cast in that epoch).
CREATE TABLE IF NOT EXISTS lock_votes (
  epoch_start INTEGER NOT NULL,
  gauge TEXT NOT NULL,
  escrow TEXT NOT NULL,
  token_id TEXT NOT NULL,
  source TEXT NOT NULL,
  pool TEXT,
  weight TEXT NOT NULL,
  weight_key TEXT NOT NULL,
  voted_at INTEGER NOT NULL,
  carried INTEGER NOT NULL,
  PRIMARY KEY (epoch_start, gauge, escrow, token_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS lock_votes_gauge_weight
  ON lock_votes (epoch_start, gauge, weight_key DESC, token_id);
CREATE INDEX IF NOT EXISTS lock_votes_lock
  ON lock_votes (escrow, token_id, epoch_start DESC);

-- Incentive and fee deposits on reward contracts, from Neon
-- matchbox.reward_deposits. epoch_start is the reward contract's epoch.
CREATE TABLE IF NOT EXISTS incentive_deposits (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  epoch_start INTEGER NOT NULL,
  tx_from TEXT NOT NULL,
  reward_contract TEXT NOT NULL,
  -- 'Bribe' (incentives) or 'Fee' (fees to voters)
  reward_type TEXT NOT NULL,
  voter_source TEXT NOT NULL,
  gauge TEXT NOT NULL,
  pool TEXT,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  depositor TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS incentive_deposits_gauge
  ON incentive_deposits (gauge, epoch_start DESC, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS incentive_deposits_epoch
  ON incentive_deposits (epoch_start, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS incentive_deposits_depositor
  ON incentive_deposits (depositor, block_number DESC, log_index DESC);

-- mUSD trove history, from Neon matchbox.trove_updates.
CREATE TABLE IF NOT EXISTS trove_events (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  tx_from TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  emitter TEXT NOT NULL,
  borrower TEXT NOT NULL,
  operation INTEGER NOT NULL,
  action TEXT NOT NULL,
  principal TEXT NOT NULL,
  interest TEXT NOT NULL,
  coll TEXT NOT NULL,
  stake TEXT NOT NULL,
  interest_rate INTEGER,
  prev_principal TEXT,
  prev_interest TEXT,
  prev_coll TEXT,
  accrued_interest TEXT,
  debt_change TEXT,
  coll_change TEXT,
  PRIMARY KEY (tx_hash, log_index)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS trove_events_borrower
  ON trove_events (borrower, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS trove_events_action
  ON trove_events (action, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS trove_events_time
  ON trove_events (timestamp DESC, block_number DESC, log_index DESC);

-- Morpho Blue market events, from Neon matchbox.morpho_events.
CREATE TABLE IF NOT EXISTS morpho_events (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  tx_from TEXT NOT NULL,
  market_id TEXT NOT NULL,
  action TEXT NOT NULL,
  caller TEXT,
  on_behalf TEXT,
  receiver TEXT,
  assets TEXT,
  shares TEXT,
  seized_assets TEXT,
  bad_debt_assets TEXT,
  bad_debt_shares TEXT,
  prev_borrow_rate TEXT,
  fee_shares TEXT,
  fee TEXT,
  PRIMARY KEY (tx_hash, log_index)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS morpho_events_market
  ON morpho_events (market_id, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS morpho_events_position
  ON morpho_events (on_behalf, market_id, block_number DESC, log_index DESC)
  WHERE on_behalf IS NOT NULL;
CREATE INDEX IF NOT EXISTS morpho_events_time
  ON morpho_events (timestamp DESC, block_number DESC, log_index DESC);

-- Enclave debt and veBTC collateral history, from Neon
-- matchbox.enclave_events. pledged_ve_btc is a JSON array of token ids.
CREATE TABLE IF NOT EXISTS enclave_events (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  ve_btc_token_id TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  tx_from TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  enclave TEXT NOT NULL,
  position_id TEXT,
  borrower TEXT,
  action TEXT NOT NULL,
  amount TEXT,
  principal TEXT,
  interest_rate INTEGER,
  originator_fee_rate INTEGER,
  warning_cr TEXT,
  minimum_cr TEXT,
  lock_duration INTEGER,
  other_ve_btc_token_id TEXT,
  pledged_ve_btc TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index, ve_btc_token_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS enclave_events_position
  ON enclave_events (position_id, block_number DESC, log_index DESC)
  WHERE position_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS enclave_events_borrower
  ON enclave_events (borrower, block_number DESC, log_index DESC)
  WHERE borrower IS NOT NULL;
CREATE INDEX IF NOT EXISTS enclave_events_lock
  ON enclave_events (ve_btc_token_id, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS enclave_events_time
  ON enclave_events (timestamp DESC, block_number DESC, log_index DESC);

-- Address names: Neon matchbox.contracts kinds plus the curated seed
-- (src/scan/labels-seed.ts). A curated row is never overwritten by a
-- derived one. Prefix search: name_lower >= ?q AND name_lower < ?q || x'ff'
-- (labels_name), and address >= ?q AND address < ?q || 'g' (primary key).
CREATE TABLE IF NOT EXISTS labels (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  kind TEXT NOT NULL,
  -- JSON array of strings.
  tags TEXT NOT NULL DEFAULT '[]',
  -- 'curated' or 'contracts'
  source TEXT NOT NULL,
  pool TEXT,
  gauge TEXT,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS labels_name ON labels (name_lower, address);
CREATE INDEX IF NOT EXISTS labels_kind ON labels (kind, name_lower);

-- One row per epoch: native amounts only. Amount maps are JSON objects
-- {token address: base-unit decimal string}; weight maps are keyed by voter
-- source (POOLS_VOTER, BOOST_VOTER, ...), since veBTC and veMEZO weights do
-- not add up.
CREATE TABLE IF NOT EXISTS epoch_totals (
  epoch_start INTEGER PRIMARY KEY,
  -- MezoMinter EpochProcessed for this epoch's period; null before it.
  emission TEXT,
  rebase TEXT,
  gauge_rewards TEXT,
  total_supply TEXT,
  -- Distinct vote transactions (BOOST_VOTE) in the epoch.
  vote_transactions INTEGER NOT NULL,
  -- Distinct locks with a vote in the epoch, including carried votes.
  voters INTEGER NOT NULL,
  vote_weight TEXT NOT NULL DEFAULT '{}',
  gauges INTEGER NOT NULL,
  incentives TEXT NOT NULL DEFAULT '{}',
  fees TEXT NOT NULL DEFAULT '{}',
  -- Highest weight gauge per voter source: {source: gauge}.
  top_gauge TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- One row per gauge per epoch: votes, voters, incentives and fees (native),
-- and the gauge's rank by weight among its voter source's gauges.
CREATE TABLE IF NOT EXISTS gauge_epoch (
  epoch_start INTEGER NOT NULL,
  gauge TEXT NOT NULL,
  source TEXT NOT NULL,
  pool TEXT,
  vote_weight TEXT NOT NULL,
  weight_key TEXT NOT NULL,
  voters INTEGER NOT NULL,
  incentives TEXT NOT NULL DEFAULT '{}',
  fees TEXT NOT NULL DEFAULT '{}',
  -- 1 is the highest weight; null for a gauge with incentives but no votes.
  rank INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (gauge, epoch_start)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS gauge_epoch_rank
  ON gauge_epoch (epoch_start, source, rank);

-- Every time series on Network, Tokens, Locks and Borrow: one value per
-- metric, day (YYYY-MM-DD, UTC) and dimension ('' for the total). value is a
-- decimal string; source names the writer ('warehouse', 'live', 'blockscout',
-- 'backfill:<script>').
CREATE TABLE IF NOT EXISTS daily (
  metric TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (metric, dimension, day)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_by_day ON daily (metric, day, dimension);

-- One closing USD price per token per day, kept forever.
CREATE TABLE IF NOT EXISTS price_daily (
  token TEXT NOT NULL,
  day TEXT NOT NULL,
  price TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (token, day)
) WITHOUT ROWID;

-- Copy checkpoints and once-a-day markers. Written in the same batch as the
-- rows they cover, so a failed run leaves them where they were.
CREATE TABLE IF NOT EXISTS scan_cursors (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Epochs ('epoch', start) and days ('day', YYYY-MM-DD) whose aggregates must
-- be recomputed. Marked with the copied rows, cleared with the aggregates.
CREATE TABLE IF NOT EXISTS scan_dirty (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  PRIMARY KEY (kind, key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'skipped')),
  rows_read INTEGER,
  rows_written INTEGER,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS scan_runs_recent ON scan_runs (job, started_at DESC);
