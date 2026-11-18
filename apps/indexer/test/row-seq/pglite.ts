import { fileURLToPath } from "node:url"
import type { PGlite } from "@electric-sql/pglite"
import type { ClientBase, Pool } from "pg"
import { readMigrations } from "../../scripts/migration-lib"

// PGlite (Postgres compiled to WebAssembly, in process) with the warehouse
// migrations, applied the way scripts/migrate.ts applies them: each file in
// its own transaction. Nothing here talks to Neon.

const MIGRATIONS = fileURLToPath(
  new URL("../../db/migrations/matchbox/", import.meta.url),
)

export async function applyMigrations(
  db: PGlite,
  filter: (filename: string) => boolean,
): Promise<void> {
  for (const migration of await readMigrations(MIGRATIONS)) {
    if (!filter(migration.filename)) continue
    await db.exec("BEGIN")
    try {
      await db.exec(migration.sql)
      await db.exec("COMMIT")
    } catch (error) {
      await db.exec("ROLLBACK")
      throw error
    }
  }
}

export async function migrationSql(filename: string): Promise<string> {
  const migration = (await readMigrations(MIGRATIONS)).find(
    (candidate) => candidate.filename === filename,
  )
  if (migration === undefined) throw new Error(`No migration ${filename}`)
  return migration.sql
}

type QueryResult = { rows: unknown[]; rowCount: number }

async function run(
  db: PGlite,
  text: string,
  values?: unknown[],
): Promise<QueryResult> {
  const result = await db.query(text, values)
  return { rows: result.rows, rowCount: result.affectedRows ?? 0 }
}

/**
 * A pg client and pool over one PGlite database, for the indexer's
 * Postgres code (runProjection, PgIngestStore, pruneRaw). PGlite has a
 * single connection, so every "client" shares it; callers never overlap.
 */
export function pgClient(db: PGlite): ClientBase {
  const client = {
    query: (text: string, values?: unknown[]) => run(db, text, values),
    release() {},
    on() {
      return client
    },
    removeListener() {
      return client
    },
  }
  // The indexer code calls only query() (and, on pooled clients, release()
  // and on/removeListener("error")).
  return client as unknown as ClientBase
}

export function pgPool(db: PGlite): Pool {
  const pool = {
    query: (text: string, values?: unknown[]) => run(db, text, values),
    async connect() {
      return pgClient(db)
    },
  }
  return pool as unknown as Pool
}

/** One representative row in every table 0013 tracks, as of decoder v2. */
export async function seedTrackedRows(
  db: PGlite,
  block: bigint,
): Promise<void> {
  const n = block.toString()
  const tx = `0x${block.toString(16).padStart(64, "0")}`
  await db.query(
    `INSERT INTO matchbox.activity_events (network, id, action_type,
       boost_context, source, tx_hash, tx_from, log_index, block_number,
       timestamp, actor, token_id, amount, contract_address, decoder_version)
     VALUES ('mezo', $1 || '-1-LOCK_CREATED', 'LOCK_CREATED', 'UNKNOWN',
       'VOTING_ESCROW', $1, '0x000000000000000000000000000000000000a11c', 1,
       $2::bigint, 1790000000 + $2::bigint,
       '0x000000000000000000000000000000000000a11c', $2::numeric,
       5000000000000000000, '0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279', 2)`,
    [tx, n],
  )
  await db.query(
    `INSERT INTO matchbox.lock_positions (network, id, token_id,
       contract_address, owner, amount, is_permanent, is_withdrawn, is_merged,
       activity_count)
     VALUES ('mezo', '0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279-' || $1::text,
       $1::numeric,
       '0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279',
       '0x000000000000000000000000000000000000a11c', 5, false, false, false, 1)`,
    [n],
  )
  await db.query(
    `INSERT INTO matchbox.reward_deposits VALUES ('mezo', $1, 2, $2::bigint,
       1790000000, '0x000000000000000000000000000000000000a11c',
       '0x00000000000000000000000000000000000bb1be', 'Bribe', 'BOOST_VOTER',
       '0x00000000000000000000000000000000000aa0e0', NULL,
       '0x7b7c000000000000000000000000000000000001', 1790208000, 10,
       '0x000000000000000000000000000000000000a11c', 2)`,
    [tx, n],
  )
  await db.query(
    `INSERT INTO matchbox.trove_updates (network, tx_hash, log_index,
       block_number, timestamp, tx_from, contract_address, emitter, borrower,
       operation, action, principal, interest, coll, stake, decoder_version)
     VALUES ('mezo', $1, 3, $2::bigint, 1790000000,
       '0x000000000000000000000000000000000000a11c',
       '0x44b1bac67dda612a41a58aaf779143b181dee031', 'BORROWER_OPERATIONS',
       '0x000000000000000000000000000000000000a11c', 0, 'LOAN_OPENED', 1, 0,
       1, 1, 2)`,
    [tx, n],
  )
  await db.query(
    `INSERT INTO matchbox.morpho_events (network, tx_hash, log_index,
       block_number, timestamp, tx_from, market_id, action, assets,
       decoder_version)
     VALUES ('mezo', $1, 4, $2::bigint, 1790000000,
       '0x000000000000000000000000000000000000a11c', '0x01', 'SUPPLIED', 7, 1)`,
    [tx, n],
  )
  await db.query(
    `INSERT INTO matchbox.enclave_events (network, tx_hash, log_index,
       ve_btc_token_id, block_number, timestamp, tx_from, contract_address,
       enclave, action, pledged_ve_btc, decoder_version)
     VALUES ('mezo', $1, 5, 9, $2::bigint, 1790000000,
       '0x000000000000000000000000000000000000a11c',
       '0x00000000000000000000000000000000000e0c1a',
       '0x00000000000000000000000000000000000e0c1a', 'VEBTC_LOCKED',
       ARRAY[9]::numeric[], 1)`,
    [tx, n],
  )
  await db.query(
    `INSERT INTO matchbox.contracts (network, address, kind, template,
       created_block)
     VALUES ('mezo', '0x' || lpad(to_hex($1::bigint), 40, '0'), 'pool', 'Pool',
       $1::bigint)`,
    [n],
  )
}
