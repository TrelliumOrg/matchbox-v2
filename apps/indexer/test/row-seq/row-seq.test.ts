import { PGlite } from "@electric-sql/pglite"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { PgBorrowStore, type SqlPool } from "../../src/borrow/pg-store"
import { resetProjection } from "../../src/decode/projection"
import { pruneRaw } from "../../src/maintenance"
import {
  LIVE_ROW_SEQ_START,
  stampHistoryBatch,
  TRACKED_TABLES,
  unstampedRows,
} from "../../src/row-seq"
import {
  applyMigrations,
  migrationSql,
  pgClient,
  seedTrackedRows,
} from "./pglite"

// The change markers on tables that already hold rows: 0013 on top of the
// full migration set, the history backfill, 0014, and what the triggers do
// to inserts, updates and deletes. The interleaved-transaction hazard needs
// two connections, which PGlite does not have: see concurrency.pg.test.ts.

const stampSchema = z.object({ row_seq: z.string().nullable() })

async function stamps(db: PGlite, table: string): Promise<(bigint | null)[]> {
  const result = await db.query(
    `SELECT row_seq::text AS row_seq FROM matchbox.${table}
     ORDER BY ${TRACKED_TABLES.find((t) => t.name === table)?.order.join(", ")}`,
  )
  return z
    .array(stampSchema)
    .parse(result.rows)
    .map((row) => (row.row_seq === null ? null : BigInt(row.row_seq)))
}

async function stampOf(
  db: PGlite,
  table: string,
  where: string,
): Promise<bigint | null> {
  const result = await db.query(
    `SELECT row_seq::text AS row_seq FROM matchbox.${table} WHERE ${where}`,
  )
  const value = z.array(stampSchema).parse(result.rows)[0]?.row_seq
  return value === undefined || value === null ? null : BigInt(value)
}

async function before0013(): Promise<PGlite> {
  const db = new PGlite()
  await applyMigrations(db, (name) => name < "0013")
  // Inserted out of block order, the way a back-filled Enclave or a widened
  // contract set inserts rows behind a reader's checkpoint.
  for (const block of [9_000_000n, 8_000_000n, 8_500_000n]) {
    await seedTrackedRows(db, block)
  }
  return db
}

describe("0013 on populated tables", { timeout: 60_000 }, () => {
  let db: PGlite

  beforeEach(async () => {
    db = await before0013()
    await applyMigrations(db, (name) => name === "0013_row_seq.sql")
  }, 60_000)

  it("adds the column without stamping existing rows, and re-applies cleanly", async () => {
    for (const table of TRACKED_TABLES) {
      expect(await stamps(db, table.name)).toEqual([null, null, null])
    }
    await applyMigrations(db, (name) => name === "0013_row_seq.sql")
    for (const table of TRACKED_TABLES) {
      expect(await unstampedRows(pgClient(db), table)).toBe(3)
    }
  })

  it("stamps every insert from the live range, whatever row_seq it names", async () => {
    await db.query(
      `INSERT INTO matchbox.contracts (network, address, kind, template,
         created_block, row_seq)
       VALUES ('mezo', '0x00000000000000000000000000000000000000c1', 'pool',
         'Pool', 1, 5)`,
    )
    const stamp = await stampOf(
      db,
      "contracts",
      "address = '0x00000000000000000000000000000000000000c1'",
    )
    expect(stamp).toBe(LIVE_ROW_SEQ_START)
  })

  it("stamps history in natural order below every live stamp", async () => {
    // A live change before the backfill: this lock keeps its live stamp.
    await db.query(
      `UPDATE matchbox.lock_positions SET amount = 6
       WHERE id = '0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279-8500000'`,
    )
    const client = pgClient(db)
    for (const table of TRACKED_TABLES) {
      let total = 0
      for (;;) {
        const stamped = await stampHistoryBatch(client, table, 2)
        if (stamped === 0) break
        total += stamped
      }
      expect(total).toBe(table.name === "lock_positions" ? 2 : 3)
      expect(await unstampedRows(client, table)).toBe(0)
    }
    for (const table of TRACKED_TABLES) {
      const values = await stamps(db, table.name)
      const history = values.filter(
        (value): value is bigint =>
          value !== null && value < LIVE_ROW_SEQ_START,
      )
      // Natural order (block, log index; token id for locks) is stamp order.
      expect([...history].sort((a, b) => (a < b ? -1 : 1))).toEqual(history)
    }
    const live = await stampOf(
      db,
      "lock_positions",
      "id = '0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279-8500000'",
    )
    expect(live).toBeGreaterThanOrEqual(LIVE_ROW_SEQ_START)

    await applyMigrations(db, (name) => name === "0014_row_seq_finish.sql")
    await applyMigrations(db, (name) => name === "0014_row_seq_finish.sql")
    const indexes = await db.query(
      `SELECT count(*)::int AS count FROM pg_indexes
       WHERE schemaname = 'matchbox' AND indexname LIKE '%_row_seq_idx'`,
    )
    expect(indexes.rows).toEqual([{ count: TRACKED_TABLES.length }])
    await expect(
      db.query(
        `INSERT INTO matchbox.activity_events
         SELECT * FROM json_populate_recordset(NULL::matchbox.activity_events,
           '[{"network":"mezo","id":"x","action_type":"LOCK_CREATED",
              "boost_context":"UNKNOWN","source":"VOTING_ESCROW",
              "tx_hash":"0x01","log_index":0,"block_number":1,"timestamp":1,
              "contract_address":"0x02","decoder_version":2,
              "explorer_parity":true}]')`,
      ),
    ).resolves.toBeDefined()
  })

  it("refuses 0014 while a row is unstamped", async () => {
    await expect(
      db.exec(await migrationSql("0014_row_seq_finish.sql")),
    ).rejects.toThrow(/backfill:row-seq/)
  })

  it("moves a stamp only on a real change, and never by hand", async () => {
    const client = pgClient(db)
    for (const table of TRACKED_TABLES) {
      while ((await stampHistoryBatch(client, table, 100)) > 0) {}
    }
    const id = "id = '0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279-8000000'"
    const history = await stampOf(db, "lock_positions", id)
    await db.query(
      `UPDATE matchbox.lock_positions SET amount = amount WHERE ${id}`,
    )
    expect(await stampOf(db, "lock_positions", id)).toBe(history)
    await db.query(`UPDATE matchbox.lock_positions SET row_seq = 3 WHERE ${id}`)
    const moved = await stampOf(db, "lock_positions", id)
    expect(moved).toBeGreaterThanOrEqual(LIVE_ROW_SEQ_START)
    await db.query(`UPDATE matchbox.lock_positions SET boost = 4 WHERE ${id}`)
    expect(await stampOf(db, "lock_positions", id)).toBeGreaterThan(moved ?? 0n)
  })
})

describe("tombstones", { timeout: 60_000 }, () => {
  const tombstoneSchema = z.object({
    table_name: z.string(),
    network: z.string().nullable(),
    kind: z.enum(["row", "reset"]),
    row_key: z.record(z.string(), z.string()).nullable(),
    row_seq: z.string(),
  })

  async function tombstones(db: PGlite) {
    const result = await db.query(
      `SELECT table_name, network, kind, row_key, row_seq::text AS row_seq
       FROM matchbox.deleted_rows ORDER BY row_seq`,
    )
    return z.array(tombstoneSchema).parse(result.rows)
  }

  let db: PGlite

  beforeEach(async () => {
    db = await before0013()
    await applyMigrations(db, (name) => name === "0013_row_seq.sql")
    const client = pgClient(db)
    for (const table of TRACKED_TABLES) {
      while ((await stampHistoryBatch(client, table, 100)) > 0) {}
    }
    await applyMigrations(db, (name) => name > "0013_row_seq.sql")
  }, 60_000)

  it("records a deleted row by its key", async () => {
    await db.query(
      `DELETE FROM matchbox.enclave_events WHERE block_number = 8000000`,
    )
    expect(await tombstones(db)).toMatchObject([
      {
        table_name: "enclave_events",
        network: "mezo",
        kind: "row",
        row_key: {
          tx_hash: `0x${(8_000_000).toString(16).padStart(64, "0")}`,
          log_index: "5",
          ve_btc_token_id: "9",
        },
      },
    ])
  })

  it("records one reset for a TRUNCATE, stamped after the rows it removed", async () => {
    await db.query("TRUNCATE matchbox.activity_events")
    const [reset] = await tombstones(db)
    expect(reset).toMatchObject({
      table_name: "activity_events",
      network: null,
      kind: "reset",
      row_key: null,
    })
    await seedTrackedRows(db, 9_500_000n)
    const refill = await stampOf(
      db,
      "activity_events",
      "block_number = 9500000",
    )
    expect(refill).toBeGreaterThan(BigInt(reset?.row_seq ?? "0"))
  })
  it("records one reset per tracked table when a replay empties a network", async () => {
    // Another network's row makes resetProjection DELETE rather than
    // TRUNCATE; the projection's untracked tables get no tombstone.
    await db.query(
      `INSERT INTO matchbox.activity_events (network, id, action_type,
         boost_context, source, tx_hash, log_index, block_number, timestamp,
         contract_address, decoder_version)
       VALUES ('mezo-testnet', 't', 'LOCK_CREATED', 'UNKNOWN', 'VOTING_ESCROW',
         '0x01', 0, 1, 1, '0x02', 2)`,
    )
    await resetProjection(pgClient(db), "mezo")
    const resets = await tombstones(db)
    expect(
      resets.map((row) => [row.table_name, row.network, row.kind]),
    ).toEqual([
      ["activity_events", "mezo", "reset"],
      ["lock_positions", null, "reset"],
      ["reward_deposits", null, "reset"],
      ["trove_updates", null, "reset"],
    ])
    expect(await stamps(db, "activity_events")).toHaveLength(1)
  })

  it("records one reset per borrow table on a borrow replay", async () => {
    const pool: SqlPool = {
      query: (text, values) => db.query(text, values),
      async connect() {
        return { query: (text, values) => db.query(text, values), release() {} }
      },
    }
    await new PgBorrowStore(pool).reset("mezo")
    expect(
      (await tombstones(db)).map((row) => [
        row.table_name,
        row.network,
        row.kind,
      ]),
    ).toEqual([
      ["morpho_events", "mezo", "reset"],
      ["enclave_events", "mezo", "reset"],
    ])
  })

  it("records nothing when raw history is pruned", async () => {
    await db.query(
      `INSERT INTO matchbox_raw.logs (id, network, block_number, block_hash,
         block_timestamp, transaction_hash, transaction_index, log_index,
         address, topics, data)
       VALUES ('0x01-0', 'mezo', 100, '0xaa', 1, '0x01', 0, 0, '0x02', '', '0x')`,
    )
    await db.query(
      `INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block)
       VALUES ('mezo', 'logs', 500000), ('mezo', 'projection', 500000)`,
    )
    expect(await pruneRaw(pgClient(db), "mezo")).toMatchObject({ logs: 1 })
    expect(await tombstones(db)).toEqual([])
  })
})
