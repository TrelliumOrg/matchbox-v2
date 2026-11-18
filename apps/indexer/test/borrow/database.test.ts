import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { BORROW_CONTRACT_KINDS } from "@matchbox/chain"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readMigrations } from "../../scripts/migration-lib"
import { BORROW_DECODER_VERSION } from "../../src/borrow/decoder"
import {
  borrowStaticContracts,
  ingestBorrowToHead,
} from "../../src/borrow/ingest"
import { PgBorrowStore, type SqlPool } from "../../src/borrow/pg-store"
import { ENCLAVE_ACTIONS, MORPHO_ACTIONS } from "../../src/borrow/rows"
import {
  BorrowCheckpointMovedError,
  BorrowReplayRequiredError,
  MemoryBorrowStore,
} from "../../src/borrow/store"
import { RpcClient } from "../../src/ingest/rpc"
import { loadBorrowFixture, RecordedChain } from "./recorded-chain"

// Every migration, then the borrow stream's Postgres store, on PGlite: a
// real Postgres compiled to WebAssembly, in process. Nothing here talks to
// Neon.

function pool(db: PGlite): SqlPool {
  async function query(text: string, values?: unknown[]) {
    const result = await db.query(text, values)
    return { rows: result.rows }
  }
  return {
    query,
    async connect() {
      return { query, release() {} }
    },
  }
}

const CONFIG = {
  network: "mezo" as const,
  chainId: 31612,
  startBlock: 5_000_000n,
  confirmations: 2n,
  windowSize: 10_000n,
  endpoints: [
    { url: "https://recorded.test", maxAddresses: 100, maxBlockRange: 10_000 },
  ],
}

function deps(store: PgBorrowStore | MemoryBorrowStore) {
  const fixture = loadBorrowFixture()
  const chain = new RecordedChain(
    fixture.rawLogs,
    fixture.transactions,
    BigInt(fixture.to) + CONFIG.confirmations,
  )
  return {
    config: CONFIG,
    rpc: new RpcClient({
      network: "mezo",
      endpoints: CONFIG.endpoints,
      fetch: chain.fetch,
      sleep: async () => {},
    }),
    store,
    staticContracts: borrowStaticContracts("mezo"),
  }
}

describe("borrow tables on Postgres", () => {
  let db: PGlite
  let store: PgBorrowStore

  beforeAll(async () => {
    db = new PGlite()
    for (const schema of ["matchbox", "matchbox-pro"]) {
      const directory = fileURLToPath(
        new URL(`../../db/migrations/${schema}/`, import.meta.url),
      )
      for (const migration of await readMigrations(directory)) {
        await db.exec(migration.sql)
      }
    }
    store = new PgBorrowStore(pool(db))
  }, 60_000)

  afterAll(async () => {
    await db.close()
  })

  it("applies every migration on an empty database", async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'matchbox' ORDER BY table_name`,
    )
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "borrow_contracts",
        "borrow_state",
        "enclave_events",
        "morpho_events",
        "morpho_markets",
        "trove_updates",
      ]),
    )
  })

  it("checks the same actions and kinds the code writes", async () => {
    const result = await db.query<{ table: string; definition: string }>(
      `SELECT conrelid::regclass::text AS table, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE contype = 'c'
         AND conrelid::regclass::text IN (
           'matchbox.morpho_events', 'matchbox.enclave_events',
           'matchbox.borrow_contracts'
         )`,
    )
    function listed(table: string, column: string): string[] {
      const definition = result.rows.find(
        (row) => row.table === table && row.definition.includes(`(${column} =`),
      )?.definition
      return [...(definition ?? "").matchAll(/'([A-Za-z_]+)'/g)].map(
        (match) => match[1] ?? "",
      )
    }
    expect(listed("matchbox.morpho_events", "action").sort()).toEqual(
      [...MORPHO_ACTIONS].sort(),
    )
    expect(listed("matchbox.enclave_events", "action").sort()).toEqual(
      [...ENCLAVE_ACTIONS].sort(),
    )
    expect(listed("matchbox.borrow_contracts", "kind").sort()).toEqual(
      [...BORROW_CONTRACT_KINDS].sort(),
    )
  })

  it("writes the same rows as the memory store, in two ticks", async () => {
    await ingestBorrowToHead(deps(store), 2_500_000n)
    await ingestBorrowToHead(deps(store), 5_000_000n)
    const memory = new MemoryBorrowStore()
    await ingestBorrowToHead(deps(memory), 5_000_000n)

    expect(await store.getCheckpoint("mezo")).toBe(
      memory.checkpoints.get("mezo"),
    )
    const counts = await db.query<{ morpho: number; enclave: number }>(
      `SELECT (SELECT count(*)::int FROM matchbox.morpho_events) AS morpho,
              (SELECT count(*)::int FROM matchbox.enclave_events) AS enclave`,
    )
    expect(counts.rows[0]).toEqual({
      morpho: memory.morphoEvents.size,
      enclave: memory.enclaveEvents.size,
    })

    const state = await store.loadState("mezo")
    const memoryState = await memory.loadState("mezo")
    expect(state.markets).toEqual(memoryState.markets)
    expect(state.positions).toEqual(memoryState.positions)

    const amounts = await db.query<{ assets: string; shares: string }>(
      `SELECT assets::text AS assets, shares::text AS shares
       FROM matchbox.morpho_events WHERE action = 'BORROWED'
       ORDER BY block_number, log_index LIMIT 1`,
    )
    const firstBorrow = [...memory.morphoEvents.values()]
      .filter((row) => row.action === "BORROWED")
      .sort((left, right) => Number(left.blockNumber - right.blockNumber))[0]
    expect(amounts.rows[0]).toEqual({
      assets: firstBorrow?.assets?.toString(),
      shares: firstBorrow?.shares?.toString(),
    })
  }, 180_000)

  it("refuses a stale window and keeps the decoder version", async () => {
    await expect(
      store.commitWindow({
        network: "mezo",
        fromBlock: 1n,
        toBlock: 2n,
        expectedCheckpoint: 0n,
        contracts: [],
        morphoEvents: [],
        enclaveEvents: [],
        markets: [],
      }),
    ).rejects.toBeInstanceOf(BorrowCheckpointMovedError)
    expect(await store.builtWithDecoderVersion("mezo")).toBe(
      BORROW_DECODER_VERSION,
    )
    await db.query(
      "UPDATE matchbox.borrow_state SET decoder_version = $1 WHERE network = 'mezo'",
      [BORROW_DECODER_VERSION + 1],
    )
    await expect(store.ensureDecoderVersion("mezo")).rejects.toBeInstanceOf(
      BorrowReplayRequiredError,
    )
  })

  it("resets rows but keeps discovered contracts", async () => {
    await store.reset("mezo")
    expect(await store.getCheckpoint("mezo")).toBe(null)
    expect(await store.builtWithDecoderVersion("mezo")).toBe(null)
    const rows = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM matchbox.enclave_events",
    )
    expect(rows.rows[0]?.count).toBe(0)
    expect((await store.loadContracts("mezo")).length).toBe(4)
  })
})
