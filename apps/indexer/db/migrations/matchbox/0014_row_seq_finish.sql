-- Second half of the change markers (0013_row_seq.sql). Run after
-- `pnpm --filter @matchbox/indexer backfill:row-seq -- --apply` has stamped
-- every row that predates 0013, or after a full replay (which re-inserts,
-- and so stamps, every projected row). It refuses while any row is
-- unstamped, so it can never hide a gap behind NOT NULL.
--
-- One transaction, so each table's ACCESS EXCLUSIVE lock is held from its
-- SET NOT NULL (a scan) until the commit; readers of that table wait. At
-- 230,000 activity rows the scan plus the index build took 0.5 s on a local
-- Postgres 18, a few seconds on Neon's 0.25 CU. The largest table goes last
-- so it is blocked the shortest. Run it right after a cron tick
-- (RUNBOOK-scan-changes.md). CREATE INDEX CONCURRENTLY would avoid the
-- write block but cannot run inside the migration runner's transaction
-- (scripts/migrate.ts), and at these sizes the plain build is seconds.
--
-- The (network, row_seq) indexes serve the reader's `WHERE network = $1 AND
-- row_seq > $2 ORDER BY row_seq LIMIT n`. They also replace the block
-- window reads (`block_number > checkpoint`) that were sequential scans on
-- reward_deposits, trove_updates, morpho_events and enclave_events, so no
-- (network, block_number, log_index) index is added for those.

SET LOCAL lock_timeout = '5s';

DO $unstamped$
DECLARE
  tracked text;
  missing bigint;
BEGIN
  FOREACH tracked IN ARRAY ARRAY[
    'contracts', 'enclave_events', 'morpho_events', 'lock_positions',
    'reward_deposits', 'trove_updates', 'activity_events'
  ] LOOP
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM matchbox.%I WHERE row_seq IS NULL LIMIT 1) AS unstamped',
      tracked) INTO missing;
    IF missing > 0 THEN
      RAISE EXCEPTION 'matchbox.% has rows without row_seq: run `pnpm --filter @matchbox/indexer backfill:row-seq -- --apply` first', tracked;
    END IF;
  END LOOP;
END
$unstamped$;

DO $finish$
DECLARE
  tracked text;
BEGIN
  FOREACH tracked IN ARRAY ARRAY[
    'contracts', 'enclave_events', 'morpho_events', 'lock_positions',
    'reward_deposits', 'trove_updates', 'activity_events'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE matchbox.%I ALTER COLUMN row_seq SET NOT NULL', tracked);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON matchbox.%I (network, row_seq)',
      tracked || '_row_seq_idx', tracked);
  END LOOP;
END
$finish$;
