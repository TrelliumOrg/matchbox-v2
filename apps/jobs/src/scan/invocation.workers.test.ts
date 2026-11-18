import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import recorded from "../../test/fixtures/warehouse.json"
import { resetStorage } from "../../test/reset"
import { emptyChainReader } from "../../test/warehouse-fixture"
import { createWarehouseReader } from "../warehouse/reader"
import { recordedQueryRunner, recordingSchema } from "../warehouse/recorded"
import { runWarehouseSnapshot } from "../warehouse/snapshot"
import { runScanCopy, startScanCopy } from "./copy"
import { dirtyStatement, runBatch } from "./statements"
import { fixtureReader } from "./testing/fixture"

// D1 calls per chained invocation (the Pro snapshot plus the scan copy)
// against Workers Paid's 1,000 queries per invocation (a batch counts as
// one), during a backlog: a recorded warehouse snapshot, then a scan copy
// with hundreds of dirty epochs and days.

const logger = createLogger({ level: "error" })
const recording = recordingSchema.parse(recorded)
const invocationLimit = 1_000

/** A D1 wrapper that counts calls the way the invocation limit does. */
function counting(db: D1Database): { db: D1Database; calls: () => number } {
  let calls = 0
  const real = new WeakMap<object, D1PreparedStatement>()
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values))
        }
        const value: unknown = Reflect.get(target, property)
        if (typeof value !== "function") return value
        if (["first", "all", "run", "raw"].includes(String(property))) {
          return (...args: unknown[]) => {
            calls += 1
            return Reflect.apply(value, target, args)
          }
        }
        return (...args: unknown[]) => Reflect.apply(value, target, args)
      },
    })
    real.set(proxy, statement)
    return proxy
  }
  const wrapped: D1Database = {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: (statements) => {
      calls += 1
      return db.batch(
        statements.map((statement) => real.get(statement) ?? statement),
      )
    },
    exec: (sql) => db.exec(sql),
    dump: () => db.dump(),
    withSession: (constraint) => db.withSession(constraint),
  }
  return { db: wrapped, calls: () => calls }
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await resetStorage()
  await env.SCAN_DB.batch(
    ["scan_dirty", "scan_cursors", "scan_runs", "activity", "daily"].map(
      (table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`),
    ),
  )
})

describe("D1 calls per chained invocation", () => {
  it("stays under the per-invocation limit during a backlog", async () => {
    const read = counting(env.READ_DB)
    const scan = counting(env.SCAN_DB)
    // A backlog: 600 dirty days and epochs, as after the first fill.
    const days = Array.from({ length: 550 }, (_, index) =>
      new Date(Date.UTC(2025, 4, 1) + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
    )
    const epochs = Array.from({ length: 50 }, (_, index) =>
      String(1_765_411_200 + index * 604_800),
    )
    await runBatch(env.SCAN_DB, [
      ...dirtyStatement("day", days),
      ...dirtyStatement("epoch", epochs),
    ])
    const copy = await startScanCopy({
      db: scan.db,
      warehouse: fixtureReader(),
      trigger: "chained",
      summary: null,
      nowSeconds: recording.nowSeconds,
      logger,
    })
    await runWarehouseSnapshot({
      db: read.db,
      kv: env.PRICES,
      warehouse: createWarehouseReader(recordedQueryRunner(recording)),
      chain: emptyChainReader,
      trigger: "chained",
      sweepWallets: 4,
      nowSeconds: recording.nowSeconds,
      logger,
      afterWarehouseReads: copy.read,
    })
    const pro = read.calls()
    const result = await copy.finish()
    expect(result.status).toBe("ok")
    const total = pro + scan.calls()
    // Measured 9 Nov 2026: Pro 73 (4 swept wallets; about 100 with 150),
    // scan 203 (the aggregate budget of 200 plus the copy's own calls).
    // 10 Nov 2026, with the run guards and the daily count check: scan 215.
    expect(scan.calls()).toBeLessThanOrEqual(260)
    expect(total).toBeLessThan(invocationLimit / 2)
  })

  it("reads Neon for the scan before the Pro snapshot's D1 writes", async () => {
    const order: string[] = []
    const reader = fixtureReader()
    const copy = await startScanCopy({
      db: env.SCAN_DB,
      warehouse: {
        async read(plan) {
          order.push("scan neon read")
          return reader.read(plan)
        },
      },
      trigger: "chained",
      summary: null,
      nowSeconds: recording.nowSeconds,
      logger,
    })
    const writes: D1Database = {
      prepare: (sql) => env.READ_DB.prepare(sql),
      batch: (statements) => {
        if (!order.includes("pro d1 batch")) order.push("pro d1 batch")
        return env.READ_DB.batch(statements)
      },
      exec: (sql) => env.READ_DB.exec(sql),
      dump: () => env.READ_DB.dump(),
      withSession: (constraint) => env.READ_DB.withSession(constraint),
    }
    await runWarehouseSnapshot({
      db: writes,
      kv: env.PRICES,
      warehouse: createWarehouseReader(recordedQueryRunner(recording)),
      chain: emptyChainReader,
      trigger: "chained",
      sweepWallets: 4,
      nowSeconds: recording.nowSeconds,
      logger,
      afterWarehouseReads: copy.read,
    })
    order.push("pro done")
    await copy.finish()
    expect(order).toEqual(["scan neon read", "pro d1 batch", "pro done"])
  })

  it("makes a handful of calls on a skipped tick", async () => {
    const scan = counting(env.SCAN_DB)
    await runScanCopy({
      db: scan.db,
      warehouse: fixtureReader(),
      trigger: "chained",
      summary: {
        kind: "matchbox-indexer-tick",
        version: 1,
        network: "mezo",
        projection: { status: "at-head" },
        borrow: { status: "at-head" },
      },
      nowSeconds: recording.nowSeconds,
      logger,
    })
    // 9 since the copy reads its halt markers first (a halted table is
    // read even on a quiet tick).
    expect(scan.calls()).toBeLessThanOrEqual(9)
  })
})
