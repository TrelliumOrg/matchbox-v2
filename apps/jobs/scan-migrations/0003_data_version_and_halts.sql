-- Second review round (additive).

-- data_version: a counter bumped in the same batch as any change to rows
-- the API serves (copy rows, aggregates, daily, price_daily, labels,
-- pools), and only when one of them actually changed. The API keys its
-- caches on it. change_mark is internal: total_changes() at the start of
-- such a batch, so the batch's last statement can tell whether anything
-- before it changed.
ALTER TABLE scan_status ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scan_status ADD COLUMN change_mark INTEGER NOT NULL DEFAULT 0;

-- Tables the copy stopped for the run because too many of their rows were
-- quarantined at once (a systematic decoder or schema failure): JSON
-- {table: reason}, null when none.
ALTER TABLE scan_status ADD COLUMN halted_tables TEXT;

-- Failed runs in the last 24 hours, crashed ones included (a run left
-- 'running' is marked failed when a later run starts).
ALTER TABLE scan_status ADD COLUMN failed_runs_24h INTEGER NOT NULL DEFAULT 0;

-- 1 while enclave_events is diffed whole every run; 0 once it outgrew the
-- full-diff limit (it then follows its checkpoint and overlap only).
ALTER TABLE scan_status ADD COLUMN enclave_full_diff INTEGER NOT NULL DEFAULT 1;

-- The UTC day of a quarantined row, for the daily count check.
ALTER TABLE scan_quarantine ADD COLUMN day TEXT;

-- The status row exists from the start, so a data_version bump always has
-- a row to update. last_run_at 0 means no run yet.
INSERT OR IGNORE INTO scan_status (id, last_run_status, last_run_at, updated_at)
VALUES (1, 'skipped', 0, 0);
