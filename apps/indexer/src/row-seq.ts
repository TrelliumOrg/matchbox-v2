import { z } from "zod"
import type { Network } from "./ingest/networks"

// Change markers (db/migrations/matchbox/0013_row_seq.sql). The database
// stamps rows and writes tombstones itself, through triggers; this module
// holds what code needs to know about them: the tracked tables, and the one
// delete path that must not write a tombstone per row.

/** Advisory lock the stamping trigger holds until commit ("mboxrows"). */
export const ROW_SEQ_LOCK_KEY = 0x6d626f78726f7773n

/** Live stamps start here; lower ones are the one-off history backfill. */
export const LIVE_ROW_SEQ_START = 1_000_000_000_000n

export type TrackedTable = {
  name: string
  /** Primary key columns after network: a tombstone's row_key. */
  key: readonly string[]
  /** Order the history backfill stamps existing rows in. */
  order: readonly string[]
}

/** The tables readers copy incrementally. Matches 0013 and 0015. */
export const TRACKED_TABLES: readonly TrackedTable[] = [
  {
    name: "activity_events",
    key: ["id"],
    order: ["block_number", "log_index", "id"],
  },
  {
    name: "lock_positions",
    key: ["id"],
    order: ["contract_address", "token_id"],
  },
  {
    name: "reward_deposits",
    key: ["tx_hash", "log_index"],
    order: ["block_number", "log_index"],
  },
  {
    name: "trove_updates",
    key: ["tx_hash", "log_index"],
    order: ["block_number", "log_index"],
  },
  {
    name: "morpho_events",
    key: ["tx_hash", "log_index"],
    order: ["block_number", "log_index"],
  },
  {
    name: "enclave_events",
    key: ["tx_hash", "log_index", "ve_btc_token_id"],
    order: ["block_number", "log_index", "ve_btc_token_id"],
  },
  {
    name: "contracts",
    key: ["address"],
    order: ["discovered_at", "address"],
  },
]

// A pg client, or the PGlite adapter the tests use.
type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

const presentSchema = z.object({ present: z.boolean() })

/** False before 0013_row_seq.sql: there are no tombstones to write. */
export async function hasRowSeq(db: Queryable): Promise<boolean> {
  const result = await db.query(
    "SELECT to_regclass('matchbox.deleted_rows') IS NOT NULL AS present",
  )
  return z.array(presentSchema).parse(result.rows)[0]?.present ?? false
}

/**
 * Deletes every row of `table` for `network` inside the caller's
 * transaction, leaving one reset tombstone instead of one per row (a
 * replay empties whole tables; per-row tombstones would add a row for each
 * one deleted). Readers drop their copies stamped below the reset and
 * refill from the rows stamped after it. A TRUNCATE gets its reset from the
 * table's own trigger instead.
 */
export async function deleteNetworkRows(
  db: Queryable,
  table: string,
  network: Network,
  tombstones: boolean,
): Promise<void> {
  if (!tombstones) {
    await db.query(`DELETE FROM matchbox.${table} WHERE network = $1`, [
      network,
    ])
    return
  }
  await db.query(
    `INSERT INTO matchbox.deleted_rows (table_name, network, kind, row_key)
     VALUES ($1, $2, 'reset', NULL)`,
    [table, network],
  )
  await db.query("SELECT set_config('matchbox.bulk_reset', 'on', true)")
  await db.query(`DELETE FROM matchbox.${table} WHERE network = $1`, [network])
  await db.query("SELECT set_config('matchbox.bulk_reset', 'off', true)")
}

/** Whether a table name (without schema) is tracked. */
export function isTracked(table: string): boolean {
  return TRACKED_TABLES.some((tracked) => tracked.name === table)
}

/** Serializes history backfill runs, so their stamp ranges never overlap. */
export const ROW_SEQ_HISTORY_LOCK_KEY = 0x6d626f78686973n

const stampedSchema = z.object({
  stamped: z.coerce.number().int(),
  last: z.string().nullable(),
})

/**
 * Stamps up to `limit` rows of `table` that predate 0013 (row_seq NULL)
 * with history values, in the table's natural order, and commits. Returns
 * how many it stamped; 0 means the table is done. Resumable: each batch is
 * its own transaction and picks up the next unstamped rows. A row a live
 * write stamped meanwhile is skipped, since its live stamp is newer.
 */
export async function stampHistoryBatch(
  db: Queryable,
  table: TrackedTable,
  limit: number,
): Promise<number> {
  const keys = ["network", ...table.key]
  const order = ["network", ...table.order].join(", ")
  const join = keys.map((column) => `t.${column} = b.${column}`).join(" AND ")
  await db.query("BEGIN")
  try {
    await db.query("SELECT pg_advisory_xact_lock($1)", [
      ROW_SEQ_HISTORY_LOCK_KEY.toString(),
    ])
    // One base per batch, then base + rank: the stamps follow the order
    // exactly, whatever order the UPDATE visits rows in.
    const result = await db.query(
      `WITH b AS (
         SELECT ${keys.join(", ")}, row_number() OVER (ORDER BY ${order}) AS rank
         FROM (SELECT * FROM matchbox.${table.name}
               WHERE row_seq IS NULL ORDER BY ${order} LIMIT $1) AS unstamped
       ), base AS (
         SELECT nextval('matchbox.row_seq_history') AS value
       ), stamped AS (
         UPDATE matchbox.${table.name} AS t
         SET row_seq = base.value + b.rank
         FROM b, base
         WHERE ${join} AND t.row_seq IS NULL
         RETURNING t.row_seq
       )
       SELECT count(*)::int AS stamped, max(row_seq)::text AS last FROM stamped`,
      [limit],
    )
    const row = z.array(stampedSchema).parse(result.rows)[0]
    if (row !== undefined && row.last !== null) {
      await db.query("SELECT setval('matchbox.row_seq_history', $1)", [
        row.last,
      ])
    }
    await db.query("COMMIT")
    return row?.stamped ?? 0
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}

const countSchema = z.object({ unstamped: z.coerce.number().int() })

/** Rows of a tracked table without a stamp. */
export async function unstampedRows(
  db: Queryable,
  table: TrackedTable,
): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS unstamped FROM matchbox.${table.name}
     WHERE row_seq IS NULL`,
  )
  return z.array(countSchema).parse(result.rows)[0]?.unstamped ?? 0
}

const trackedRowSchema = z.object({
  table_name: z.string(),
  has_column: z.boolean(),
  not_null: z.boolean(),
  triggers: z.coerce.number().int(),
  has_index: z.boolean(),
})

export type RowSeqState = "absent" | "stamping" | "complete"

// Change markers (0013_row_seq.sql, 0014_row_seq_finish.sql), for
// scripts/verify-warehouse.ts: "absent" before 0013, "stamping" between the
// two (rows may still lack a stamp, and readers must not use row_seq yet),
// "complete" after 0014. Anything in between (a table without its four
// triggers, one NOT NULL and another not) fails, and so does a row_seq
// sequence with a cache other than 1: a session would take a block of
// stamps ahead of time, outside the advisory lock, and stamps would no
// longer follow commit order.
export async function rowSeqState(pool: Queryable): Promise<RowSeqState> {
  const tombstones = await pool.query(
    "SELECT to_regclass('matchbox.deleted_rows') IS NOT NULL AS present",
  )
  const present = z
    .array(z.object({ present: z.boolean() }))
    .parse(tombstones.rows)[0]?.present
  if (present !== true) return "absent"
  const cache = await pool.query(
    `SELECT cache_size::text AS cache_size FROM pg_sequences
     WHERE schemaname = 'matchbox' AND sequencename = 'row_seq'`,
  )
  const cacheSize = z
    .array(z.object({ cache_size: z.string() }))
    .parse(cache.rows)[0]?.cache_size
  if (cacheSize !== "1") {
    throw new Error(
      `matchbox.row_seq has cache ${cacheSize ?? "missing"}: it must be 1 (ALTER SEQUENCE matchbox.row_seq CACHE 1)`,
    )
  }
  const result = await pool.query(
    `SELECT t.table_name,
            EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'matchbox' AND c.table_name = t.table_name
                      AND c.column_name = 'row_seq') AS has_column,
            EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'matchbox' AND c.table_name = t.table_name
                      AND c.column_name = 'row_seq' AND c.is_nullable = 'NO') AS not_null,
            (SELECT count(*) FROM pg_trigger g
             WHERE g.tgrelid = ('matchbox.' || t.table_name)::regclass
               AND NOT g.tgisinternal AND g.tgname IN (
                 t.table_name || '_row_seq_insert', t.table_name || '_row_seq_update',
                 t.table_name || '_tombstone', t.table_name || '_reset')) AS triggers,
            to_regclass('matchbox.' || t.table_name || '_row_seq_idx') IS NOT NULL AS has_index
     FROM unnest($1::text[]) AS t(table_name)`,
    [TRACKED_TABLES.map((table) => table.name)],
  )
  const rows = z.array(trackedRowSchema).parse(result.rows)
  for (const row of rows) {
    if (!row.has_column || row.triggers !== 4) {
      throw new Error(
        `matchbox.${row.table_name} is missing its row_seq column or triggers; re-run 0013_row_seq.sql`,
      )
    }
  }
  const finished = rows.filter((row) => row.not_null && row.has_index)
  if (finished.length === rows.length) return "complete"
  if (finished.length === 0) return "stamping"
  throw new Error(
    "row_seq is NOT NULL and indexed on some tracked tables only; re-run 0014_row_seq_finish.sql",
  )
}
