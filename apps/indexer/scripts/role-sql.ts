// The warehouse's group roles and their grants, run by create-roles.ts and
// by the real-Postgres tests (test/row-seq). Idempotent: re-run it after
// every migration.
export const ROLE_SQL = `
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_api_ro') THEN
    CREATE ROLE matchbox_api_ro NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_pro_rw') THEN
    CREATE ROLE matchbox_pro_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbox_indexer') THEN
    CREATE ROLE matchbox_indexer NOLOGIN;
  END IF;
  -- The Goldsky sink role from the pipeline spike. Ingest is RPC now, so it
  -- keeps no privileges where it still exists.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'goldsink') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA matchbox_raw FROM goldsink;
    REVOKE USAGE ON SCHEMA matchbox_raw FROM goldsink;
  END IF;
END
$roles$;

REVOKE CREATE ON SCHEMA matchbox_raw, matchbox, matchbox_pro, matchbox_scan FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA matchbox_raw, matchbox, matchbox_pro, matchbox_scan FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA matchbox_raw, matchbox, matchbox_pro, matchbox_scan FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA matchbox_raw, matchbox, matchbox_pro, matchbox_scan FROM PUBLIC;

GRANT USAGE ON SCHEMA matchbox_raw, matchbox, matchbox_pro TO matchbox_api_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA matchbox_raw, matchbox, matchbox_pro TO matchbox_api_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA matchbox_raw GRANT SELECT ON TABLES TO matchbox_api_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA matchbox GRANT SELECT ON TABLES TO matchbox_api_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA matchbox_pro GRANT SELECT ON TABLES TO matchbox_api_ro;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA matchbox, matchbox_pro FROM matchbox_api_ro;

GRANT USAGE ON SCHEMA matchbox_raw, matchbox, matchbox_pro TO matchbox_pro_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA matchbox_raw, matchbox, matchbox_pro TO matchbox_pro_rw;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA matchbox_raw, matchbox, matchbox_pro FROM matchbox_pro_rw;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA matchbox, matchbox_pro FROM matchbox_pro_rw;

GRANT USAGE ON SCHEMA matchbox_raw, matchbox TO matchbox_indexer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA matchbox_raw, matchbox TO matchbox_indexer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA matchbox TO matchbox_indexer;
ALTER DEFAULT PRIVILEGES IN SCHEMA matchbox_raw GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO matchbox_indexer;
ALTER DEFAULT PRIVILEGES IN SCHEMA matchbox GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO matchbox_indexer;
ALTER DEFAULT PRIVILEGES IN SCHEMA matchbox GRANT USAGE, SELECT ON SEQUENCES TO matchbox_indexer;
REVOKE ALL ON matchbox.schema_migrations FROM matchbox_indexer;
-- The raw logs index is on matchbox.topic0(topics), and Postgres evaluates
-- that expression as the inserting role, so ingest needs EXECUTE on it and
-- on matchbox.topic, which it calls. PUBLIC lost EXECUTE above.
GRANT EXECUTE ON FUNCTION matchbox.topic(text, integer), matchbox.topic0(text) TO matchbox_indexer;

ALTER ROLE matchbox_api_ro SET statement_timeout = '2s';
ALTER ROLE matchbox_indexer SET statement_timeout = '10s';

DO $assertions$
BEGIN
  IF NOT has_table_privilege('matchbox_api_ro', 'matchbox_raw.logs', 'SELECT') THEN
    RAISE EXCEPTION 'matchbox_api_ro must be able to SELECT raw logs';
  END IF;
  IF has_table_privilege('matchbox_api_ro', 'matchbox_raw.logs', 'INSERT') THEN
    RAISE EXCEPTION 'matchbox_api_ro unexpectedly has INSERT on raw logs';
  END IF;
  IF NOT has_table_privilege('matchbox_indexer', 'matchbox_raw.logs', 'INSERT') THEN
    RAISE EXCEPTION 'matchbox_indexer must be able to INSERT raw logs';
  END IF;
  IF NOT has_function_privilege('matchbox_indexer', 'matchbox.topic0(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'matchbox_indexer must be able to EXECUTE matchbox.topic0 (raw logs index)';
  END IF;
  IF to_regclass('matchbox.contracts') IS NOT NULL
    AND NOT has_table_privilege('matchbox_indexer', 'matchbox.contracts', 'INSERT') THEN
    RAISE EXCEPTION 'matchbox_indexer must be able to INSERT contracts';
  END IF;
  -- Change markers (0013_row_seq.sql): the stamping and tombstone triggers
  -- run as the writer, so the indexer needs the sequences and the tombstone
  -- table. Readers get the tombstones and the row_seq columns through
  -- SELECT, and nothing else: no sequence, no functions.
  IF to_regclass('matchbox.deleted_rows') IS NOT NULL THEN
    IF NOT has_sequence_privilege('matchbox_indexer', 'matchbox.row_seq', 'USAGE') THEN
      RAISE EXCEPTION 'matchbox_indexer must be able to use matchbox.row_seq';
    END IF;
    IF NOT has_table_privilege('matchbox_indexer', 'matchbox.deleted_rows', 'INSERT') THEN
      RAISE EXCEPTION 'matchbox_indexer must be able to INSERT tombstones';
    END IF;
    IF NOT has_table_privilege('matchbox_api_ro', 'matchbox.deleted_rows', 'SELECT') THEN
      RAISE EXCEPTION 'matchbox_api_ro must be able to SELECT tombstones';
    END IF;
    IF has_table_privilege('matchbox_api_ro', 'matchbox.deleted_rows', 'INSERT') THEN
      RAISE EXCEPTION 'matchbox_api_ro unexpectedly has INSERT on tombstones';
    END IF;
    IF has_sequence_privilege('matchbox_api_ro', 'matchbox.row_seq', 'USAGE')
      OR has_sequence_privilege('matchbox_api_ro', 'matchbox.row_seq', 'SELECT') THEN
      RAISE EXCEPTION 'matchbox_api_ro must not use matchbox.row_seq';
    END IF;
    IF NOT has_column_privilege('matchbox_api_ro', 'matchbox.activity_events', 'row_seq', 'SELECT') THEN
      RAISE EXCEPTION 'matchbox_api_ro must be able to SELECT row_seq';
    END IF;
    IF has_column_privilege('matchbox_api_ro', 'matchbox.activity_events', 'row_seq', 'UPDATE') THEN
      RAISE EXCEPTION 'matchbox_api_ro unexpectedly can UPDATE row_seq';
    END IF;
  END IF;
END
$assertions$;
`
