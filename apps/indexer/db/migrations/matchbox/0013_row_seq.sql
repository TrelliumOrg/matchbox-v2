-- Change markers for readers that copy the warehouse incrementally (the
-- jobs Worker's scan copy step, apps/jobs/src/scan). Every insert into, and
-- every real update of, a tracked table stamps the row with a fresh value
-- of one shared sequence, matchbox.row_seq. Every delete leaves a tombstone
-- in matchbox.deleted_rows, stamped from the same sequence. A reader keeps
-- one checkpoint per table and reads `row_seq > checkpoint`; it then sees
-- every new or changed row exactly once, rows inserted behind any block or
-- timestamp checkpoint included.
--
-- Commit-safe order. A sequence value is taken when a statement runs but
-- becomes visible when its transaction commits, so with two writers a
-- reader could see value 11 committed while value 10 is still in flight,
-- advance past it, and never see 10. The stamping trigger therefore takes
-- one transaction-scoped advisory lock before it calls nextval, and holds
-- it until the transaction ends. Writers of tracked rows are serialized
-- from their first tracked write to their commit, and a transaction's
-- commit is visible before its locks are released (CommitTransaction ends
-- the transaction in the proc array, then releases locks). So whenever a
-- reader sees a stamp, every lower stamp that will ever commit is already
-- visible to it. The lock is taken by the database on every path (the
-- cron, the backfill and rebuild scripts, a manual UPDATE), so no writer
-- can forget it. Its key is 0x6d626f78726f7773 ("mboxrows"): in pg_locks,
-- locktype 'advisory', classid 1835167608, objid 1919907699.
--
-- This migration only adds a nullable column (metadata only, no rewrite),
-- the triggers and the tombstone table, so it takes each table's ACCESS
-- EXCLUSIVE lock for an instant. Rows that exist when it runs keep a NULL
-- row_seq until `pnpm --filter @matchbox/indexer backfill:row-seq` stamps
-- them, in each table's natural order (block, log index), from a separate
-- range below every live value. 0014_row_seq_finish.sql then makes the
-- column NOT NULL and adds the (network, row_seq) indexes.
-- RUNBOOK-scan-changes.md has the order of operations.

-- Each ALTER waits at most this long behind a running query, then the
-- migration fails cleanly and can be re-run.
SET LOCAL lock_timeout = '5s';

-- Live stamps start at 10^12. Stamps below that are the history backfill's,
-- in natural order, so a reader filling from 0 reads history first.
CREATE SEQUENCE IF NOT EXISTS matchbox.row_seq
  AS bigint START WITH 1000000000000 MINVALUE 1000000000000;
CREATE SEQUENCE IF NOT EXISTS matchbox.row_seq_history
  AS bigint START WITH 1 MINVALUE 1 MAXVALUE 999999999999;

COMMENT ON SEQUENCE matchbox.row_seq IS
  'Change marker for tracked tables. Taken only by matchbox.stamp_row_seq(), under advisory lock 0x6d626f78726f7773.';
COMMENT ON SEQUENCE matchbox.row_seq_history IS
  'Stamps for rows that predate 0013_row_seq.sql, assigned once by scripts/backfill-row-seq.ts in natural order.';

-- BEFORE INSERT, and BEFORE UPDATE when the row really changed (the
-- trigger's WHEN clause): a no-op upsert keeps its stamp. A stamp can never
-- be written directly: an insert's is always replaced, and an update may
-- only move a NULL stamp to a history value (the backfill).
CREATE OR REPLACE FUNCTION matchbox.stamp_row_seq()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.row_seq IS NULL
    AND NEW.row_seq IS NOT NULL
    AND NEW.row_seq < 1000000000000 THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(7881984860958455667);
  NEW.row_seq := nextval('matchbox.row_seq');
  RETURN NEW;
END
$fn$;

CREATE TABLE IF NOT EXISTS matchbox.deleted_rows (
  row_seq bigint NOT NULL,
  table_name text NOT NULL,
  -- NULL on a reset from TRUNCATE: every network's rows went.
  network text,
  kind text NOT NULL CHECK (kind IN ('row', 'reset')),
  -- The deleted row's primary key without network, every value as text.
  row_key jsonb,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (row_seq),
  CHECK ((kind = 'row') = (row_key IS NOT NULL))
);

COMMENT ON TABLE matchbox.deleted_rows IS
  'Tombstones for tracked tables, stamped from matchbox.row_seq. kind row: one row deleted (row_key). kind reset: every row of table_name (for network, or all networks when NULL) stamped below this row_seq was deleted at once; rows stamped after it are the refill. Raw pruning (matchbox_raw) writes none.';

-- One tombstone per deleted row, unless the transaction is resetting the
-- whole table for a network (src/row-seq.ts resetTable), which writes one
-- reset tombstone instead and sets matchbox.bulk_reset for itself.
CREATE OR REPLACE FUNCTION matchbox.record_deleted_row()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  old_row jsonb;
  key jsonb := '{}'::jsonb;
  position int;
BEGIN
  IF coalesce(current_setting('matchbox.bulk_reset', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  old_row := to_jsonb(OLD);
  FOR position IN 0 .. TG_NARGS - 1 LOOP
    key := key || jsonb_build_object(
      TG_ARGV[position], old_row ->> TG_ARGV[position]);
  END LOOP;
  INSERT INTO matchbox.deleted_rows (table_name, network, kind, row_key)
  VALUES (TG_TABLE_NAME, OLD.network, 'row', key);
  RETURN NULL;
END
$fn$;

-- TRUNCATE fires no row triggers: one reset tombstone for all networks.
CREATE OR REPLACE FUNCTION matchbox.record_table_reset()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO matchbox.deleted_rows (table_name, network, kind, row_key)
  VALUES (TG_TABLE_NAME, NULL, 'reset', NULL);
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS deleted_rows_row_seq ON matchbox.deleted_rows;
CREATE TRIGGER deleted_rows_row_seq
  BEFORE INSERT ON matchbox.deleted_rows
  FOR EACH ROW EXECUTE FUNCTION matchbox.stamp_row_seq();

-- The tables readers copy, with their primary key columns after network.
-- votes, bribe_to_pool and the registries are not copied and not tracked.
DO $tracked$
DECLARE
  tracked record;
BEGIN
  FOR tracked IN
    SELECT * FROM (VALUES
      ('activity_events', ARRAY['id']),
      ('lock_positions', ARRAY['id']),
      ('reward_deposits', ARRAY['tx_hash', 'log_index']),
      ('trove_updates', ARRAY['tx_hash', 'log_index']),
      ('morpho_events', ARRAY['tx_hash', 'log_index']),
      ('enclave_events', ARRAY['tx_hash', 'log_index', 've_btc_token_id']),
      ('contracts', ARRAY['address'])
    ) AS t(table_name, key_columns)
  LOOP
    EXECUTE format(
      'ALTER TABLE matchbox.%I ADD COLUMN IF NOT EXISTS row_seq bigint',
      tracked.table_name);
    EXECUTE format(
      'COMMENT ON COLUMN matchbox.%I.row_seq IS %L',
      tracked.table_name,
      'Change marker from matchbox.row_seq: set on insert and on every real update, in commit-safe order. Read row_seq > checkpoint.');

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_row_seq_insert', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON matchbox.%I
         FOR EACH ROW EXECUTE FUNCTION matchbox.stamp_row_seq()',
      tracked.table_name || '_row_seq_insert', tracked.table_name);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_row_seq_update', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON matchbox.%I
         FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
         EXECUTE FUNCTION matchbox.stamp_row_seq()',
      tracked.table_name || '_row_seq_update', tracked.table_name);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_tombstone', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON matchbox.%I
         FOR EACH ROW EXECUTE FUNCTION matchbox.record_deleted_row(%s)',
      tracked.table_name || '_tombstone', tracked.table_name,
      (SELECT string_agg(quote_literal(column_name), ', ')
       FROM unnest(tracked.key_columns) AS column_name));

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON matchbox.%I',
      tracked.table_name || '_reset', tracked.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER TRUNCATE ON matchbox.%I
         FOR EACH STATEMENT EXECUTE FUNCTION matchbox.record_table_reset()',
      tracked.table_name || '_reset', tracked.table_name);
  END LOOP;
END
$tracked$;

-- Roles come from scripts/create-roles.ts; on a fresh database they may not
-- exist yet, and its default privileges then cover these. The stamping and
-- tombstone triggers run as the writing role: it needs the sequence and
-- INSERT on the tombstones. Readers need SELECT on the tombstones only.
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_indexer') THEN
    GRANT USAGE ON SEQUENCE matchbox.row_seq, matchbox.row_seq_history
      TO matchbox_indexer;
    GRANT SELECT, INSERT, UPDATE, DELETE ON matchbox.deleted_rows
      TO matchbox_indexer;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_api_ro') THEN
    GRANT SELECT ON matchbox.deleted_rows TO matchbox_api_ro;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_pro_rw') THEN
    GRANT SELECT ON matchbox.deleted_rows TO matchbox_pro_rw;
  END IF;
END
$grants$;
