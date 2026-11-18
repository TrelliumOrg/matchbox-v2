-- Validator uptime from CometBFT commit signatures (apps/jobs src/uptime,
-- README "Validator uptime"). Mezo has no x/slashing, so signing uptime
-- exists only in each block's commit. The jobs Worker reads the commits of
-- every new height from a community CometBFT node once a minute.
--
-- Size at about 22,700 blocks a day (3.8 s blocks) and 21 validators:
-- uptime_blocks about 40 bytes and 1 row write a block (about 0.9 MB and
-- 22,700 writes a day, the same again in deletes once rows age past 7
-- days, about 6.5 MB kept); uptime_hourly 22 rows an hour (about 32,000
-- upserts a day at one run a minute, kept 14 days, about 7,400 rows);
-- uptime_daily 22 rows a day, kept forever.

-- A validator set, written once per validators_hash. members: JSON array
-- in commit order (voting power, then address), each
-- {"c": consensus address (hex, upper case), "o": operator address (0x,
-- lower case, the EVM miner) or null when the PoA module did not name it,
-- "n": moniker or null, "p": voting power as a decimal string}.
CREATE TABLE IF NOT EXISTS uptime_sets (
  id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  first_height INTEGER NOT NULL,
  members TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One row a height, kept 7 days (the recent-blocks strip and recent
-- misses). proposer and missed are indexes into the set's members.
CREATE TABLE IF NOT EXISTS uptime_blocks (
  height INTEGER PRIMARY KEY,
  -- block time, unix seconds
  time INTEGER NOT NULL,
  -- the commit's round: above 0 when round 0 did not commit a block
  round INTEGER NOT NULL,
  set_id INTEGER NOT NULL,
  -- the header's proposer (-1: not in the set)
  proposer INTEGER NOT NULL,
  -- proposers of the earlier rounds that did not propose this block,
  -- comma separated; '' for a round-0 block; NULL when they could not be
  -- worked out (the first height after a validator set change)
  missed TEXT,
  -- bitmap of the members that signed (a commit or a nil vote), as hex:
  -- bit i is member i
  signed TEXT NOT NULL,
  signers INTEGER NOT NULL
);

-- Counts per validator and UTC hour, added to by every run. validator is
-- the operator address (lower case), 'cons:<consensus hex>' for a member
-- the PoA module did not name, or '' for the chain: blocks, signatures
-- and absences summed over the set, proposed = blocks, proposals_missed =
-- blocks committed after round 0 whose round-0 proposer is known,
-- unattributed = those whose round-0 proposer is not.
CREATE TABLE IF NOT EXISTS uptime_hourly (
  validator TEXT NOT NULL,
  hour INTEGER NOT NULL,
  -- blocks it was in the set for (signed + missed)
  blocks INTEGER NOT NULL,
  signed INTEGER NOT NULL,
  missed INTEGER NOT NULL,
  proposed INTEGER NOT NULL,
  proposals_missed INTEGER NOT NULL,
  -- expected proposals in millionths: the sum of 1,000,000 / set size
  expected_micro INTEGER NOT NULL,
  unattributed INTEGER NOT NULL DEFAULT 0,
  first_height INTEGER,
  last_height INTEGER,
  PRIMARY KEY (validator, hour)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS uptime_hourly_hour ON uptime_hourly (hour);

-- The same counts per UTC day, kept forever: rolled up from uptime_hourly
-- once the day is over (source 'live'), or by the backfill script
-- (source 'backfill:uptime', insert-if-absent). complete is 1 when every
-- height of the day was counted.
CREATE TABLE IF NOT EXISTS uptime_daily (
  validator TEXT NOT NULL,
  day TEXT NOT NULL,
  blocks INTEGER NOT NULL,
  signed INTEGER NOT NULL,
  missed INTEGER NOT NULL,
  proposed INTEGER NOT NULL,
  proposals_missed INTEGER NOT NULL,
  expected_micro INTEGER NOT NULL,
  unattributed INTEGER NOT NULL DEFAULT 0,
  first_height INTEGER,
  last_height INTEGER,
  complete INTEGER NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (validator, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS uptime_daily_day ON uptime_daily (day);

-- Where the poller stands (one row). height is the last height counted;
-- every run's writes are guarded on it, so two runs never count a height
-- twice. priorities: the set's proposer priorities at height (JSON array
-- of integer strings, members' order), from which the next heights'
-- round-0 proposers are worked out; NULL until re-read from the node.
CREATE TABLE IF NOT EXISTS uptime_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  height INTEGER,
  block_time INTEGER,
  set_id INTEGER,
  priorities TEXT,
  started_height INTEGER,
  started_time INTEGER,
  finalized_day TEXT,
  -- the last run that read a height, unix seconds
  read_at INTEGER,
  -- 'pathrock', 'lavender' or the host of a configured node
  source TEXT,
  node_height INTEGER,
  evm_height INTEGER,
  -- 'starting', 'ok', 'behind' (the node or the poller trails the chain)
  -- or 'down' (no node answered)
  health TEXT NOT NULL DEFAULT 'starting',
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO uptime_status (id) VALUES (1);
