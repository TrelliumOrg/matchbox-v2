import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { PGlite } from "@electric-sql/pglite"
import { createLogger } from "@matchbox/logger"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  type FillState,
  fillFinished,
  fillHaltAt,
  fillMarker,
  fillStep,
  initialFillState,
  replaceStatements,
} from "../../scripts/scan-backfill/first-fill"
import { writeSqlFiles } from "../../scripts/scan-backfill/lib"
import { runScanCopy } from "./copy"
import { labelSeed } from "./labels"
import { createScanWarehouseReader } from "./neon"
import { cursorStatement, inlineStatement } from "./statements"
import type { TickSummary } from "./summary"
import { activityFixture, epochE, epochE1, gaugeG2 } from "./testing/fixture"
import { fixtureWarehouse, pgliteRunner } from "./testing/pglite"
import sqliteD1 from "./testing/sqlite-d1"

// The first-fill script end to end: PGlite stands in for Neon, the SQL
// files it writes are applied to SQLite (node:sqlite, the engine D1 runs)
// after the scan migrations, as `wrangler d1 execute --file` would.

let warehouse: PGlite
let out: string
/** The whole fill's files, from the first case, reused by the resume case. */
let wholeFiles: string[] = []
const now = epochE1 + 3_600

beforeAll(async () => {
  warehouse = await fixtureWarehouse()
  out = mkdtempSync(path.join(tmpdir(), "scan-fill-"))
}, 60_000)

afterAll(async () => {
  await warehouse.close()
  rmSync(out, { recursive: true, force: true })
})

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  const dir = path.resolve(import.meta.dirname, "../../scan-migrations")
  for (const file of readdirSync(dir).sort()) {
    db.exec(readFileSync(path.join(dir, file), "utf8"))
  }
  return db
}

/** Each fill writes to its own directory, so no file is overwritten. */
let fills = 0

async function fill(
  run: ReturnType<typeof pgliteRunner>,
  limit: number,
  state: FillState,
) {
  let current = state
  const files: string[] = []
  fills += 1
  const dir = path.join(out, `fill-${fills}`)
  for (let step = 0; step < limit && !fillFinished(current); step += 1) {
    const next = await fillStep(run, current, now)
    const statements = fillFinished(next.state)
      ? [...next.statements, fillMarker(now)]
      : next.statements
    files.push(
      ...writeSqlFiles(dir, `neon-${step}-${current.chunks}`, statements),
    )
    current = next.state
  }
  return { state: current, files }
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get()
  return Number(row?.n)
}

describe("first fill script (PGlite in, SQLite out)", () => {
  it("writes SQL files that build the scan tables", async () => {
    const run = pgliteRunner(warehouse)
    const { state, files } = await fill(run, 10, initialFillState())
    wholeFiles = files
    expect(fillFinished(state)).toBe(true)
    expect(state.rows.activity).toBe(activityFixture.length)

    const db = migrated()
    for (const file of files) db.exec(readFileSync(file, "utf8"))
    expect(count(db, "activity")).toBe(activityFixture.length)
    expect(count(db, "locks")).toBe(2)
    expect(count(db, "incentive_deposits")).toBe(3)
    expect(count(db, "labels")).toBe(labelSeed().length + 3)
    expect(
      db
        .prepare(
          "SELECT epoch_start, gauge, token_id, carried FROM lock_votes WHERE token_id = '101' ORDER BY epoch_start",
        )
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([
      expect.objectContaining({ epoch_start: epochE, token_id: "101" }),
      { epoch_start: epochE1, gauge: gaugeG2, token_id: "101", carried: 0 },
    ])
    // Every epoch and day is left dirty for the Worker's aggregates.
    expect(count(db, "scan_dirty")).toBeGreaterThan(2)
    const cursor = db
      .prepare("SELECT value FROM scan_cursors WHERE name = 'copy:activity'")
      .get()
    expect(cursor?.value).toBe(String(epochE1 + 200))
    expect(
      db
        .prepare("SELECT value FROM scan_cursors WHERE name = 'fill:neon'")
        .get()?.value,
    ).toBe(String(now))
    // Statements stay under D1's 100 KB limit.
    for (const file of files) {
      for (const statement of readFileSync(file, "utf8").split(";\n")) {
        expect(statement.length).toBeLessThan(100_000)
      }
    }
  })

  it("resumes from its state after stopping, with the same result", async () => {
    const run = pgliteRunner(warehouse)
    const first = await fill(run, 1, initialFillState())
    expect(fillFinished(first.state)).toBe(false)
    const rest = await fill(run, 10, first.state)
    const resumed = migrated()
    for (const file of [...first.files, ...rest.files]) {
      resumed.exec(readFileSync(file, "utf8"))
    }
    const whole = migrated()
    expect(wholeFiles.length).toBeGreaterThan(0)
    for (const file of wholeFiles) {
      whole.exec(readFileSync(file, "utf8"))
    }
    // Row for row, not just counts.
    const ordered: Record<string, string> = {
      activity: "id",
      locks: "escrow, token_id",
      lock_votes: "epoch_start, gauge, escrow, token_id",
      incentive_deposits: "tx_hash, log_index",
      trove_events: "tx_hash, log_index",
      morpho_events: "tx_hash, log_index",
      enclave_events: "tx_hash, log_index, ve_btc_token_id",
      labels: "address",
      pools: "pool",
      scan_cursors: "name",
      scan_dirty: "kind, key",
    }
    for (const [table, order] of Object.entries(ordered)) {
      expect(count(resumed, table), table).toBeGreaterThan(0)
      expect(
        resumed.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all(),
        table,
      ).toEqual(whole.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all())
    }
  })
})

describe("first fill: quarantine and halt per chunk", () => {
  /** The warehouse with `bad` extra deposits that fail their schema. */
  function withBadDeposits(bad: number) {
    const run = pgliteRunner(warehouse)
    let added = false
    return async (queries: Parameters<typeof run>[0]) => {
      const results = await run(queries)
      return results.map((answer) => {
        const rows = z.array(z.record(z.string(), z.unknown())).parse(answer)
        const [deposit] = rows.filter((row) => "depositor" in row)
        if (deposit === undefined || added) return rows
        added = true
        return [
          ...rows,
          ...Array.from({ length: bad }, (_, index) => ({
            ...deposit,
            tx_hash: `0xeeeeeeee${(index + 1).toString(16).padStart(56, "0")}`,
            tx_from: null,
          })),
        ]
      })
    }
  }

  it("quarantines a few bad rows and goes on", async () => {
    const step = await fillStep(
      withBadDeposits(fillHaltAt - 1),
      initialFillState(),
      now,
    )
    expect(step.quarantined).toMatchObject({ deposits: fillHaltAt - 1 })
    expect(step.halted).toEqual({})
    // Every quarantined row is recorded, so the count check adds them up.
    const db = migrated()
    for (const statement of step.statements) {
      db.exec(inlineStatement(statement))
    }
    expect(count(db, "scan_quarantine")).toBe(fillHaltAt - 1)
  })

  it("halts at the chunk's threshold, not the Worker's 50", async () => {
    const step = await fillStep(
      withBadDeposits(fillHaltAt),
      initialFillState(),
      now,
    )
    expect(Object.keys(step.halted)).toEqual(["deposits"])
    expect(step.halted.deposits).toContain(`cap ${fillHaltAt}`)
    // Its checkpoint holds: the next chunk would read the same rows.
    expect(step.state.checkpoints.deposits).toBe("0")
  })

  it("quarantines a bad lock position instead of failing the page", async () => {
    const run = pgliteRunner(warehouse)
    const broken = async (queries: Parameters<typeof run>[0]) => {
      const results = await run(queries)
      return results.map((answer) => {
        const rows = z.array(z.record(z.string(), z.unknown())).parse(answer)
        return rows.map((row, index) =>
          index === 0 && "is_permanent" in row
            ? { ...row, amount: "1.5" }
            : row,
        )
      })
    }
    const state: FillState = { ...initialFillState(), done: true }
    const step = await fillStep(broken, state, now)
    expect(step.quarantined).toEqual({ locks: 1 })
    expect(step.halted).toEqual({})
    expect(step.rowsRead).toBeGreaterThan(1)
  })
})

describe("first fill: decoder versions", () => {
  let rebuilt: PGlite

  beforeAll(async () => {
    // A warehouse replayed under projection decoder v3 (borrow still v1).
    rebuilt = await fixtureWarehouse()
    await rebuilt.exec(`
      INSERT INTO matchbox.projection_state (network, decoder_version)
      VALUES ('mezo', 3);
      INSERT INTO matchbox.borrow_state (network, decoder_version)
      VALUES ('mezo', 1);
    `)
  }, 60_000)

  afterAll(async () => {
    await rebuilt.close()
  })

  const summary = (projection: number): TickSummary => ({
    kind: "matchbox-indexer-tick",
    version: 1,
    network: "mezo",
    projection: { status: "advanced", decoderVersion: projection },
    borrow: { status: "advanced", decoderVersion: 1 },
  })

  /** SCAN_DB that a copy filled under v2, flagged for the v3 replay. */
  function filledUnderV2(): DatabaseSync {
    const db = migrated()
    db.exec(`INSERT INTO scan_cursors (name, value, updated_at) VALUES
      ('decoder:projection', '2', 1), ('decoder:borrow', '1', 1),
      ('refill:required', 'projection decoder 2 -> 3 at 1', 1)`)
    return db
  }

  async function refill(db: DatabaseSync) {
    const run = pgliteRunner(rebuilt)
    for (const statement of replaceStatements()) {
      db.exec(inlineStatement(statement))
    }
    const { files } = await fill(run, 10, initialFillState())
    for (const file of files) db.exec(readFileSync(file, "utf8"))
  }

  function cursor(db: DatabaseSync, name: string): unknown {
    return db.prepare("SELECT value FROM scan_cursors WHERE name = ?").get(name)
      ?.value
  }

  it("records the warehouse's versions, so the next copy does not flag a re-fill", async () => {
    const db = filledUnderV2()
    await refill(db)
    expect(cursor(db, "decoder:projection")).toBe("3")
    expect(cursor(db, "decoder:borrow")).toBe("1")
    expect(cursor(db, "refill:required")).toBeUndefined()

    await runScanCopy({
      db: sqliteD1(db),
      warehouse: createScanWarehouseReader(pgliteRunner(rebuilt)),
      trigger: "chained",
      summary: summary(3),
      nowSeconds: now + 900,
      logger: createLogger({ level: "error" }),
    })
    expect(cursor(db, "refill:required")).toBeUndefined()
    expect(
      db
        .prepare(
          "SELECT refill_required, refill_reason FROM scan_status WHERE id = 1",
        )
        .get(),
    ).toEqual({ refill_required: 0, refill_reason: null })
  })

  it("still flags a replay that happens after the fill", async () => {
    const db = filledUnderV2()
    await refill(db)
    await runScanCopy({
      db: sqliteD1(db),
      warehouse: createScanWarehouseReader(pgliteRunner(rebuilt)),
      trigger: "chained",
      summary: summary(4),
      nowSeconds: now + 900,
      logger: createLogger({ level: "error" }),
    })
    expect(cursor(db, "refill:required")).toContain("projection decoder 3 -> 4")
  })

  it("flags a replay after only the first file of a --replace fill was applied", async () => {
    const db = filledUnderV2()
    // Chunk 0 as the script writes it with --replace (the replace first),
    // in small files, so the decoder versions at its end are not in the
    // first one. Only that first file is applied.
    const step = await fillStep(pgliteRunner(rebuilt), initialFillState(), now)
    fills += 1
    const files = writeSqlFiles(
      path.join(out, `fill-${fills}`),
      "neon-0",
      [...replaceStatements(), ...step.statements],
      2_000,
    )
    const upsert = inlineStatement(
      cursorStatement("decoder:projection", "3", now),
    )
    const [first, ...rest] = files.map((file) => readFileSync(file, "utf8"))
    if (first === undefined) throw new Error("no file")
    expect(first).not.toContain(upsert)
    expect(rest.some((sql) => sql.includes(upsert))).toBe(true)
    db.exec(first)

    // The warehouse is replayed again before the rest is applied.
    await runScanCopy({
      db: sqliteD1(db),
      warehouse: createScanWarehouseReader(pgliteRunner(rebuilt)),
      trigger: "chained",
      summary: summary(4),
      nowSeconds: now + 900,
      logger: createLogger({ level: "error" }),
    })
    expect(cursor(db, "refill:required")).toContain("projection decoder")
    expect(
      db.prepare("SELECT refill_required FROM scan_status WHERE id = 1").get(),
    ).toEqual({ refill_required: 1 })
  })
})
