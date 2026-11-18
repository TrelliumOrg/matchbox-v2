import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  scanActivityRowSchema,
  scanEnclaveEventRowSchema,
  scanIncentiveDepositRowSchema,
  scanLabelRowSchema,
  scanLockRowSchema,
  scanMorphoEventRowSchema,
  scanPoolRowSchema,
  scanQuarantineRowSchema,
  scanStatusRowSchema,
  scanTroveEventRowSchema,
} from "@matchbox/contracts/scan"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import recorded from "../../test/fixtures/warehouse.json"
import { resetStorage } from "../../test/reset"
import { emptyChainReader } from "../../test/warehouse-fixture"
import { createWarehouseReader } from "../warehouse/reader"
import { recordedQueryRunner, recordingSchema } from "../warehouse/recorded"
import { runWarehouseSnapshot } from "../warehouse/snapshot"
import { epochVoteTxSql } from "./aggregates"
import { runPriceClose } from "./closing"
import {
  runScanCopy,
  type ScanCopyDeps,
  staleRunSeconds,
  startScanCopy,
} from "./copy"
import type { RejectedRow, ScanWarehouseReader } from "./neon"
import {
  dirtyStatement,
  inlineStatement,
  monotonicCursorStatement,
  runBatch,
  upsertStatements,
} from "./statements"
import {
  activity,
  dayE,
  enclaveFixture,
  epochE,
  epochE1,
  fixtureReader,
  gaugeG,
  gaugeG2,
  ownerA,
  poolsVoter,
} from "./testing/fixture"
import {
  deleteVotesStatements,
  quarantineCap,
  quarantineSpec,
} from "./transform"

// The second review round: malformed warehouse rows, the quarantine cap,
// API-schema validation, the read timeout, the overlap re-read and the
// count check, crashed and overlapping runs, cheaper queries, and
// data_version.

const logger = createLogger({ level: "error" })
const now = epochE1 + 3_600

const tables = [
  "activity",
  "locks",
  "lock_votes",
  "incentive_deposits",
  "trove_events",
  "morpho_events",
  "enclave_events",
  "labels",
  "pools",
  "epoch_totals",
  "gauge_epoch",
  "daily",
  "price_daily",
  "scan_cursors",
  "scan_dirty",
  "scan_runs",
  "scan_quarantine",
]

beforeEach(async () => {
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await env.SCAN_DB.batch([
    ...tables.map((table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`)),
    env.SCAN_DB.prepare("DELETE FROM scan_status"),
    env.SCAN_DB.prepare(
      `INSERT INTO scan_status (id, last_run_status, last_run_at, updated_at)
       VALUES (1, 'skipped', 0, 0)`,
    ),
  ])
})

function deps(overrides: Partial<ScanCopyDeps> = {}): ScanCopyDeps {
  return {
    db: env.SCAN_DB,
    warehouse: fixtureReader(),
    trigger: "chained",
    summary: null,
    nowSeconds: now,
    logger,
    ...overrides,
  }
}

async function rows(sql: string, ...params: (string | number)[]) {
  const result = await env.SCAN_DB.prepare(sql)
    .bind(...params)
    .all()
  return result.results
}

async function status() {
  return env.SCAN_DB.prepare("SELECT * FROM scan_status WHERE id = 1").first()
}

async function cursor(name: string) {
  const row = await env.SCAN_DB.prepare(
    "SELECT value FROM scan_cursors WHERE name = ?1",
  )
    .bind(name)
    .first()
  return z.object({ value: z.string() }).nullable().parse(row)?.value ?? null
}

async function dataVersion(): Promise<number> {
  return z
    .object({ data_version: z.number() })
    .parse(
      await env.SCAN_DB.prepare(
        "SELECT data_version FROM scan_status WHERE id = 1",
      ).first(),
    ).data_version
}

/** A reader that adds rejected rows to the fixture's answer. */
function withRejected(
  rejected: RejectedRow[],
  base = fixtureReader(),
): ScanWarehouseReader {
  return {
    async read(plan) {
      return { ...(await base.read(plan)), rejected }
    },
  }
}

function rejectedDeposit(index: number, payload = "{}"): RejectedRow {
  return {
    source: "deposits",
    rowKey: `0x${index.toString(16).padStart(64, "0")}-0`,
    reason: "tx_from: Invalid input: expected string, received null",
    payload,
    timestamp: epochE + 900,
    position: "160",
  }
}

describe("1. a malformed warehouse row", () => {
  it("is quarantined, the rest copied, and its table moves past it", async () => {
    const result = await runScanCopy(
      deps({
        warehouse: withRejected([
          {
            source: "activity",
            rowKey: "0xbad-0-SWAP",
            reason: "amount: Invalid string",
            payload: '{"amount":"12.0"}',
            timestamp: epochE1 + 250,
            position: String(epochE1 + 250),
          },
        ]),
      }),
    )
    expect(result).toMatchObject({ status: "ok", quarantined: 1 })
    expect(await cursor("copy:activity")).toBe(String(epochE1 + 250))
    expect(
      await rows("SELECT source, row_key, day FROM scan_quarantine"),
    ).toEqual([
      { source: "activity", row_key: "0xbad-0-SWAP", day: "2026-11-12" },
    ])
    expect(await rows("SELECT count(*) AS n FROM activity")).not.toEqual([
      { n: 0 },
    ])
  })
})

describe("2. quarantine writes", () => {
  it("are chunked, capped and halt a table on a systematic failure", async () => {
    const big = JSON.stringify({ blob: "x".repeat(4_000) })
    const many = Array.from({ length: quarantineCap + 10 }, (_, index) =>
      rejectedDeposit(index, big),
    )
    const before = await cursor("copy:deposits")
    const result = await runScanCopy(deps({ warehouse: withRejected(many) }))
    if (result.status !== "ok") throw new Error("expected a run")
    expect(Object.keys(result.halted)).toEqual(["deposits"])
    // The deposits checkpoint did not move and nothing of deposits landed.
    expect(await cursor("copy:deposits")).toBe(before ?? "0")
    expect(await rows("SELECT count(*) AS n FROM incentive_deposits")).toEqual([
      { n: 0 },
    ])
    // At most the cap is recorded, payloads truncated.
    const stored = await rows(
      "SELECT count(*) AS n, max(length(payload)) AS longest FROM scan_quarantine",
    )
    expect(stored).toEqual([{ n: quarantineCap, longest: 1_000 }])
    const row = z.object({ halted_tables: z.string() }).parse(await status())
    expect(row.halted_tables).toContain("deposits")
    // Other tables still copied.
    expect(await rows("SELECT count(*) AS n FROM trove_events")).toEqual([
      { n: 2 },
    ])
  })

  it("fit D1's statement limits far past the cap (600 rows of 4 KB)", async () => {
    const statements = upsertStatements(
      quarantineSpec,
      Array.from({ length: 600 }, (_, index) => ({
        source: "check",
        row_key: `row-${index}`,
        reason: "batch check",
        payload: "x".repeat(4_096),
        day: null,
        first_seen: now,
        last_seen: now,
      })),
    )
    expect(statements.length).toBeGreaterThan(1)
    for (const statement of statements) {
      expect(statement.params.length).toBeLessThanOrEqual(100)
      expect(
        statement.sql.length + JSON.stringify(statement.params).length,
      ).toBeLessThan(100_000)
    }
    await runBatch(env.SCAN_DB, statements)
    expect(await rows("SELECT count(*) AS n FROM scan_quarantine")).toEqual([
      { n: 600 },
    ])
  })
})

describe("3. what is written parses with the API's schemas", () => {
  it("every row the fixture copy emits", async () => {
    await runScanCopy(deps())
    for (const [table, schema] of [
      ["activity", scanActivityRowSchema],
      ["locks", scanLockRowSchema],
      ["incentive_deposits", scanIncentiveDepositRowSchema],
      ["trove_events", scanTroveEventRowSchema],
      ["morpho_events", scanMorphoEventRowSchema],
      ["enclave_events", scanEnclaveEventRowSchema],
      ["labels", scanLabelRowSchema],
      ["pools", scanPoolRowSchema],
    ] as const) {
      const all = await rows(`SELECT * FROM ${table}`)
      expect(all.length, table).toBeGreaterThan(0)
      for (const row of all) {
        expect(
          schema.safeParse(row).success,
          `${table} ${JSON.stringify(row)}`,
        ).toBe(true)
      }
    }
  })

  it("quarantines a row the Neon schema accepts but the API's rejects", async () => {
    const reader = fixtureReader()
    reader.source.activity.push(
      activity({
        n: 90,
        block: 204,
        log: 0,
        ts: epochE1 + 220,
        action: "SWAP",
        source: "POOL",
        contract: poolsVoter,
        actor: "not-an-address",
        amount: "-5",
      }),
    )
    const result = await runScanCopy(deps({ warehouse: reader }))
    expect(result).toMatchObject({ status: "ok", quarantined: 1 })
    expect(await rows("SELECT reason FROM scan_quarantine")).toEqual([
      { reason: expect.stringContaining("API schema") },
    ])
  })
})

describe("4. a hung scan read", () => {
  it("never holds up the Pro snapshot, and the run reports it", async () => {
    await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
    await resetStorage()
    const recording = recordingSchema.parse(recorded)
    const copy = await startScanCopy(
      deps({
        warehouse: { read: () => new Promise(() => {}) },
        readTimeoutMs: 50,
      }),
    )
    const pro = await runWarehouseSnapshot({
      db: env.READ_DB,
      kv: env.PRICES,
      warehouse: createWarehouseReader(recordedQueryRunner(recording)),
      chain: emptyChainReader,
      trigger: "chained",
      sweepWallets: 4,
      nowSeconds: recording.nowSeconds,
      logger,
      afterWarehouseReads: copy.read,
    })
    expect(pro.status).toBe("ok")
    await expect(copy.finish()).rejects.toThrow("timed out after 50 ms")
    expect(await status()).toMatchObject({ last_run_status: "failed" })
  })
})

describe("5. rows behind the checkpoint", () => {
  it("copies a second that committed after it was read, keeping vote order", async () => {
    const reader = fixtureReader()
    await runScanCopy(deps({ warehouse: reader }))
    // A later block with the same timestamp as the checkpoint second: lock
    // 100 resets from G and votes for G2 in one transaction.
    for (const [log, action, gauge] of [
      [0, "BOOST_ABSTAIN", gaugeG],
      [1, "BOOST_VOTE", gaugeG2],
    ] as const) {
      reader.source.activity.push(
        activity({
          n: 95,
          block: 203,
          log,
          ts: epochE1 + 200,
          action,
          source: "POOLS_VOTER",
          contract: poolsVoter,
          actor: ownerA,
          token_id: "100",
          gauge,
          weight: "4000000000000000000000",
        }),
      )
    }
    await runScanCopy(deps({ warehouse: reader, nowSeconds: now + 900 }))
    expect(
      await rows(
        "SELECT gauge FROM lock_votes WHERE epoch_start = ?1 AND token_id = '100'",
        epochE1,
      ),
    ).toEqual([{ gauge: gaugeG2 }])
  })

  it("flags a re-fill when two daily checks find the same day short", async () => {
    await runScanCopy(deps())
    expect(await status()).toMatchObject({ refill_required: 0 })
    expect(await cursor("verify:counts:activity")).toBe("2026-11-12")
    const recheck = () =>
      env.SCAN_DB.prepare(
        "DELETE FROM scan_cursors WHERE name = 'verify:counts:activity'",
      ).run()
    // A row of day E goes missing from SCAN_DB; the next check (the check
    // runs once a day, so its marker is cleared) finds it, and waits.
    await env.SCAN_DB.prepare(
      "DELETE FROM activity WHERE id = (SELECT id FROM activity WHERE action_type = 'SWAP' LIMIT 1)",
    ).run()
    await recheck()
    await runScanCopy(deps({ nowSeconds: now + 600 }))
    expect(await status()).toMatchObject({ refill_required: 0 })
    expect(await cursor("verify:pending:activity")).toBe(`["${dayE}"]`)
    // The next daily check finds the same day short: now it is flagged.
    await recheck()
    await runScanCopy(deps({ nowSeconds: now + 1_200 }))
    const row = z
      .object({ refill_required: z.number(), refill_reason: z.string() })
      .parse(await status())
    expect(row.refill_required).toBe(1)
    expect(row.refill_reason).toContain(`activity ${dayE}`)
  })

  it("lets a difference that healed by the next check go unflagged", async () => {
    await runScanCopy(deps())
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        "DELETE FROM activity WHERE id = (SELECT id FROM activity WHERE action_type = 'SWAP' LIMIT 1)",
      ),
      env.SCAN_DB.prepare(
        "DELETE FROM scan_cursors WHERE name = 'verify:counts:activity'",
      ),
    ])
    await runScanCopy(deps({ nowSeconds: now + 600 }))
    expect(await cursor("verify:pending:activity")).toBe(`["${dayE}"]`)
    // The row comes back (here: the copy re-reads activity from the start).
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        "UPDATE scan_cursors SET value = '0' WHERE name = 'copy:activity'",
      ),
      env.SCAN_DB.prepare(
        "DELETE FROM scan_cursors WHERE name = 'verify:counts:activity'",
      ),
    ])
    await runScanCopy(deps({ nowSeconds: now + 1_200 }))
    expect(await status()).toMatchObject({ refill_required: 0 })
    expect(await cursor("verify:pending:activity")).toBeNull()
  })
})

describe("7 and 8. crashed and overlapping runs", () => {
  it("marks a run left running failed and counts it", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO scan_runs (job, trigger, started_at, status)
       VALUES ('scan-copy', 'chained', ?1, 'running')`,
    )
      .bind(now - staleRunSeconds - 60)
      .run()
    await runScanCopy(deps())
    expect(
      await rows("SELECT status FROM scan_runs ORDER BY started_at"),
    ).toEqual([{ status: "failed" }, { status: "ok" }])
    expect(await status()).toMatchObject({
      last_run_status: "ok",
      failed_runs_24h: 1,
    })
  })

  it("a chained run does not overlap one still running (different inputs)", async () => {
    const newer = fixtureReader()
    const older = fixtureReader({ activity: [], deposits: [] })
    const first = await startScanCopy(deps({ warehouse: newer }))
    const second = await startScanCopy(
      deps({ warehouse: older, nowSeconds: now + 30 }),
    )
    await Promise.all([first.read(), second.read()])
    const [a, b] = await Promise.all([first.finish(), second.finish()])
    expect(a.status).toBe("ok")
    expect(b).toMatchObject({
      status: "skipped",
      reason: "A scan run is still running",
    })
    expect(await cursor("copy:activity")).toBe(String(epochE1 + 200))
  })

  it("never moves a checkpoint backward", async () => {
    await runBatch(env.SCAN_DB, [
      monotonicCursorStatement("copy:activity", String(epochE1 + 200), now),
      monotonicCursorStatement("copy:activity", String(epochE + 200), now),
      monotonicCursorStatement(
        "copy:contracts",
        "2026-11-05T00:01:41.000000Z|0xb",
        now,
      ),
      monotonicCursorStatement(
        "copy:contracts",
        "2026-11-05T00:01:40.000000Z|0xa",
        now,
      ),
    ])
    expect(await cursor("copy:activity")).toBe(String(epochE1 + 200))
    expect(await cursor("copy:contracts")).toBe(
      "2026-11-05T00:01:41.000000Z|0xb",
    )
  })
})

describe("9. query costs", () => {
  it("counts an epoch's vote transactions by a timestamp range on activity_action", async () => {
    const plan = await rows(
      `EXPLAIN QUERY PLAN ${epochVoteTxSql}`,
      epochE,
      epochE1,
    )
    const detail = plan.map((row) => String(row.detail)).join(" | ")
    expect(detail).toContain("activity_action")
    expect(detail).toMatch(/timestamp[<>]/)
  })

  it("keeps diffing Enclave past 1,000 rows, a rotating 1,000 a run", async () => {
    const [first] = enclaveFixture
    if (first === undefined) throw new Error("fixture")
    const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
    const many = Array.from({ length: 1_500 }, (_, index) => ({
      ...first,
      tx_hash: hash(index + 1),
      block_number: String(1_000 + index),
    }))
    const reader = fixtureReader({ enclave: many })
    const run = (n: number) =>
      runScanCopy(
        deps({
          warehouse: reader,
          nowSeconds: now + n * 900,
          caps: { enclave: 5_000 },
        }),
      )
    await run(0)
    expect(await status()).toMatchObject({ enclave_full_diff: 0 })
    // An Enclave granted later: its old log lands far behind the
    // checkpoint (block 2,499), past any overlap.
    reader.source.enclave.push({
      ...first,
      tx_hash: hash(9_999),
      block_number: "1500",
    })
    const late = () =>
      rows(
        "SELECT count(*) AS n FROM enclave_events WHERE tx_hash = ?1",
        hash(9_999),
      )
    await run(1) // the sweep's second page, then it wraps
    await run(2) // from the start again: block 1,500 is in the first page
    expect(await late()).toEqual([{ n: 1 }])
    expect(reader.reads.map((plan) => plan.enclaveSweep?.after)).toEqual([
      "",
      `1999|${first.log_index}|${first.ve_btc_token_id}`,
      "",
    ])
  })
})

describe("11. data_version", () => {
  it("is in the status row the API parses, which still parses without it", async () => {
    await runScanCopy(deps({ warehouse: withRejected([rejectedDeposit(1)]) }))
    const row = scanStatusRowSchema.parse(await status())
    expect(row.data_version).toBeGreaterThan(0)
    expect(row).toMatchObject({ failed_runs_24h: 0, enclave_full_diff: 1 })
    for (const quarantined of await rows("SELECT * FROM scan_quarantine")) {
      expect(scanQuarantineRowSchema.parse(quarantined).day).toBe(dayE)
    }
    // A status row from before scan-migrations 0003.
    const {
      data_version: _version,
      change_mark: _mark,
      halted_tables: _halted,
      failed_runs_24h: _failed,
      enclave_full_diff: _enclave,
      ...older
    } = z.record(z.string(), z.unknown()).parse(await status())
    expect(scanStatusRowSchema.parse(older).data_version).toBeUndefined()
  })

  it("moves with every change to served rows, and only then", async () => {
    const start = await dataVersion()
    await runScanCopy(deps())
    const copied = await dataVersion()
    expect(copied).toBeGreaterThan(start)
    // A skipped run whose aggregates rewrite a row moves it too.
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare("DELETE FROM daily WHERE day = ?1").bind(dayE),
      env.SCAN_DB.prepare(
        "INSERT INTO scan_dirty (kind, key, generation) VALUES ('day', ?1, 0)",
      ).bind(dayE),
    ])
    await runScanCopy(
      deps({
        nowSeconds: now + 900,
        summary: {
          kind: "matchbox-indexer-tick",
          version: 1,
          network: "mezo",
          projection: { status: "at-head" },
          borrow: { status: "at-head" },
        },
      }),
    )
    const aggregated = await dataVersion()
    expect(aggregated).toBeGreaterThan(copied)
    // A price close moves it; the same price again does not.
    const prices = {
      btc: {
        usd: "75000",
        change24h: null,
        source: "mezo-oracle" as const,
        updatedAt: now,
      },
      mezo: null,
    }
    const minute = now - (now % 3_600) + 59 * 60
    await runPriceClose({ scanDb: env.SCAN_DB, prices, nowSeconds: minute })
    const priced = await dataVersion()
    expect(priced).toBe(aggregated + 1)
    await runPriceClose({ scanDb: env.SCAN_DB, prices, nowSeconds: minute })
    expect(await dataVersion()).toBe(priced)
  })
})

// ---- Review 3 ----------------------------------------------------------

const atHead = {
  kind: "matchbox-indexer-tick",
  version: 1,
  network: "mezo",
  projection: { status: "at-head" },
  borrow: { status: "at-head" },
} as const

describe("review 3, item 2: a halt stays visible until its table copies", () => {
  it("keeps halted_tables through runs that still fail, skipped and failed runs, and holds last_ok_at", async () => {
    await runScanCopy(deps())
    expect(await status()).toMatchObject({ last_ok_at: now })
    const many = Array.from({ length: quarantineCap }, (_, index) =>
      rejectedDeposit(index),
    )
    const halting = await runScanCopy(
      deps({ warehouse: withRejected(many), nowSeconds: now + 900 }),
    )
    expect(halting).toMatchObject({ status: "ok" })
    const halted = expect.stringContaining('"deposits"')
    // The run committed (ok), but the data is not current: last_ok_at holds.
    expect(await status()).toMatchObject({
      last_run_status: "ok",
      last_ok_at: now,
      halted_tables: halted,
    })
    // Nothing advanced, but the halted table is read again, still bad.
    await runScanCopy(
      deps({
        warehouse: withRejected(many),
        nowSeconds: now + 1_800,
        summary: atHead,
      }),
    )
    expect(await status()).toMatchObject({
      last_run_status: "ok",
      last_ok_at: now,
      halted_tables: halted,
    })
    // A run skipped (another is still running) keeps it.
    await env.SCAN_DB.prepare(
      `INSERT INTO scan_runs (job, trigger, started_at, status)
       VALUES ('scan-copy', 'chained', ?1, 'running')`,
    )
      .bind(now + 2_000)
      .run()
    await runScanCopy(deps({ nowSeconds: now + 2_100 }))
    expect(await status()).toMatchObject({
      last_run_status: "skipped",
      halted_tables: halted,
    })
    await env.SCAN_DB.prepare(
      "UPDATE scan_runs SET status = 'failed' WHERE status = 'running'",
    ).run()
    await expect(
      runScanCopy(
        deps({
          nowSeconds: now + 2_700,
          warehouse: {
            read: async () => {
              throw new Error("Neon down")
            },
          },
        }),
      ),
    ).rejects.toThrow("Neon down")
    expect(await status()).toMatchObject({
      last_run_status: "failed",
      halted_tables: halted,
    })
    expect(await cursor("halt:deposits")).toContain("deposits rows")
    // Deposits copy cleanly again: the halt clears, last_ok_at moves.
    await runScanCopy(deps({ nowSeconds: now + 4_500 }))
    expect(await status()).toMatchObject({
      halted_tables: null,
      last_ok_at: now + 4_500,
    })
    expect(await cursor("halt:deposits")).toBeNull()
  })
})

describe("review 3, item 4: contracts re-checked an hour back", () => {
  it("labels a contract registered behind the checkpoint after the last run", async () => {
    const reader = fixtureReader()
    await runScanCopy(deps({ warehouse: reader }))
    expect(await cursor("copy:contracts")).toContain("2026-11-05T00:01:41")
    const late = "0x00000000000000000000000000000000000000aa"
    // Committed late: 40 seconds behind the checkpoint, after it was set.
    reader.source.contracts.push({
      address: late,
      kind: "pool",
      template: "Pool",
      pool: late,
      gauge: null,
      token0: null,
      token1: null,
      pool_type: "stable",
      discovered_at: "2026-11-05T00:01:01.000000Z",
    })
    await runScanCopy(deps({ warehouse: reader, nowSeconds: now + 900 }))
    expect(
      await rows("SELECT address FROM labels WHERE address = ?1", late),
    ).toEqual([{ address: late }])
  })
})

describe("review 3, item 5: after the copy committed", () => {
  it("leaves the lock sweep where it was when activity is halted", async () => {
    const [lock] = fixtureReader().source.locks
    if (lock === undefined) throw new Error("fixture")
    // More locks than one sweep reads, so a sweep would move its cursor.
    const locks = Array.from({ length: 600 }, (_, index) => ({
      ...lock,
      token_id: String(10_000 + index),
    }))
    const bad: RejectedRow[] = Array.from(
      { length: quarantineCap },
      (_, index) => ({
        source: "activity",
        rowKey: `0xbad-${index}`,
        reason: "amount: Invalid string",
        payload: "{}",
        timestamp: epochE + 50,
        position: String(epochE + 50),
      }),
    )
    await runScanCopy(
      deps({ warehouse: withRejected(bad, fixtureReader({ locks })) }),
    )
    expect(await status()).toMatchObject({
      halted_tables: expect.stringContaining('"activity"'),
    })
    // The swept locks were discarded with the halted table: read them again.
    expect(await cursor("copy:lock-sweep")).toBeNull()
    expect(await rows("SELECT count(*) AS n FROM locks")).toEqual([{ n: 0 }])
    // The same read without the halt moves the sweep.
    await runScanCopy(
      deps({ warehouse: fixtureReader({ locks }), nowSeconds: now + 900 }),
    )
    expect(await cursor("copy:lock-sweep")).not.toBeNull()
  })
})

describe("review 3, item 6", () => {
  it("(a) splits vote resets and dirty markers under D1's 100 KB statement", async () => {
    const keys = Array.from({ length: 2_000 }, (_, index) => ({
      epoch_start: epochE,
      gauge: gaugeG,
      escrow: ownerA,
      token_id: String(index),
    }))
    // One statement for all of them would be far over the limit.
    expect(
      inlineStatement({ sql: "SELECT ?1", params: [JSON.stringify(keys)] })
        .length,
    ).toBeGreaterThan(100_000)
    const votes = deleteVotesStatements(keys)
    const days = dirtyStatement(
      "day",
      Array.from({ length: 20_000 }, (_, index) => `day-${index}`),
    )
    for (const statement of [...votes, ...days]) {
      expect(inlineStatement(statement).length).toBeLessThan(100_000)
    }
    expect(votes.length).toBeGreaterThan(1)
    expect(days.length).toBeGreaterThan(1)
    await runBatch(env.SCAN_DB, [...votes, ...days])
    expect(
      await rows("SELECT count(*) AS n FROM scan_dirty WHERE kind = 'day'"),
    ).toEqual([{ n: 20_000 }])
  })

  it("(b) counts only tables this run read to their end", async () => {
    // The borrow stream did not advance: Morpho and Enclave are not read,
    // so SCAN_DB has none of their rows while Neon has some.
    const projectionOnly = {
      ...atHead,
      projection: { status: "advanced" as const },
    }
    await runScanCopy(deps({ summary: projectionOnly }))
    expect(await count("morpho_events")).toBe(0)
    expect(await status()).toMatchObject({ refill_required: 0 })
    expect(await cursor("verify:counts:activity")).toBe("2026-11-12")
    expect(await cursor("verify:counts:morpho")).toBeNull()
    // Once the borrow stream is read, its tables are checked too.
    await runScanCopy(deps({ nowSeconds: now + 900 }))
    expect(await status()).toMatchObject({ refill_required: 0 })
    expect(await cursor("verify:counts:morpho")).toBe("2026-11-12")
  })

  it("(c) a skipped run leaves the aggregates to a run in progress", async () => {
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        `INSERT INTO scan_runs (job, trigger, started_at, status)
         VALUES ('scan-copy', 'chained', ?1, 'running')`,
      ).bind(now - 60),
      env.SCAN_DB.prepare(
        "INSERT INTO scan_dirty (kind, key, generation) VALUES ('day', ?1, 0)",
      ).bind(dayE),
    ])
    const result = await runScanCopy(deps({ summary: atHead }))
    expect(result).toMatchObject({ status: "skipped", aggregates: null })
    expect(await count("scan_dirty")).toBe(1)
    expect(await count("daily")).toBe(0)
  })
})

async function count(table: string): Promise<number> {
  const [row] = await rows(`SELECT count(*) AS n FROM ${table}`)
  return z.object({ n: z.number() }).parse(row).n
}

// ---- Review 4 ----------------------------------------------------------

function rejectedEnclave(index: number): RejectedRow {
  return {
    source: "enclave",
    rowKey: `0x${(index + 1).toString(16).padStart(64, "0")}-0-1`,
    reason: "amount: Invalid input",
    payload: "{}",
    timestamp: epochE + 900,
    position: null,
  }
}

describe("review 4", () => {
  it("1. counts a bad row read by both the window and the sweep once", async () => {
    // 30 bad Enclave rows, each rejected twice (window and rotating diff).
    const bad = Array.from({ length: 30 }, (_, index) => rejectedEnclave(index))
    const result = await runScanCopy(
      deps({ warehouse: withRejected([...bad, ...bad]) }),
    )
    expect(result).toMatchObject({ status: "ok", quarantined: 30, halted: {} })
    expect(await cursor("halt:enclave")).toBeNull()
  })

  it("2. leaves Enclave out of the count check while its diff rotates", async () => {
    const [first] = enclaveFixture
    if (first === undefined) throw new Error("fixture")
    const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
    const reader = fixtureReader({
      enclave: Array.from({ length: 1_500 }, (_, index) => ({
        ...first,
        tx_hash: hash(index + 1),
        block_number: String(1_000 + index),
      })),
    })
    const run = (n: number) =>
      runScanCopy(
        deps({
          warehouse: reader,
          nowSeconds: now + n * 900,
          caps: { enclave: 5_000 },
        }),
      )
    await run(0) // the sweep's first page
    await run(1) // its second, then it wraps
    // Back-filled behind the checkpoint (block 2,499), in the second page:
    // the next sweep from the start reads the first page only.
    reader.source.enclave.push({
      ...first,
      tx_hash: hash(9_999),
      block_number: "2450",
    })
    await env.SCAN_DB.prepare(
      "DELETE FROM scan_cursors WHERE name = 'verify:counts:enclave'",
    ).run()
    await run(2)
    expect(reader.reads[2]?.countTables).toContain("enclave")
    // Not compared (the sweep read one page, not the table), so no
    // mismatch is noted; the day's check is done.
    expect(await cursor("verify:pending:enclave")).toBeNull()
    expect(await cursor("verify:counts:enclave")).toBe("2026-11-12")
    expect(await status()).toMatchObject({ refill_required: 0 })
    // The sweep reaches the row on its own.
    await run(3)
    expect(
      await rows(
        "SELECT count(*) AS n FROM enclave_events WHERE tx_hash = ?1",
        hash(9_999),
      ),
    ).toEqual([{ n: 1 }])
  })

  it("3. does not mark a halted daily contracts re-read done", async () => {
    const bad: RejectedRow[] = Array.from(
      { length: quarantineCap },
      (_, index) => ({
        source: "contracts",
        rowKey: `0x${(index + 1).toString(16).padStart(40, "0")}`,
        reason: "address: Invalid",
        payload: "{}",
        timestamp: null,
        position: null,
      }),
    )
    await runScanCopy(deps({ warehouse: withRejected(bad) }))
    expect(await cursor("halt:contracts")).not.toBeNull()
    // The full re-read is still due: the next run does it again.
    expect(await cursor("copy:contracts-full")).toBeNull()
    const reader = fixtureReader()
    await runScanCopy(deps({ warehouse: reader, nowSeconds: now + 900 }))
    expect(reader.reads[0]?.fullContracts).toBe(true)
    expect(await cursor("halt:contracts")).toBeNull()
    expect(await cursor("copy:contracts-full")).toBe("2026-11-12")
  })

  it("4. re-reads a halted table on a quiet tick, so a fix clears the halt", async () => {
    const many = Array.from({ length: quarantineCap }, (_, index) =>
      rejectedDeposit(index),
    )
    await runScanCopy(deps({ warehouse: withRejected(many) }))
    expect(await cursor("halt:deposits")).not.toBeNull()
    // The warehouse is fixed; no stream advances.
    const reader = fixtureReader()
    const result = await runScanCopy(
      deps({ warehouse: reader, nowSeconds: now + 900, summary: atHead }),
    )
    expect(result).toMatchObject({ status: "ok" })
    expect([...(reader.reads[0]?.tables ?? [])]).toEqual(["deposits"])
    expect(await cursor("halt:deposits")).toBeNull()
    expect(await status()).toMatchObject({ halted_tables: null })
  })
})

describe("scan migration 0004: locks_owner_lock", () => {
  it("is a unique index the copy's owner changes never violate", async () => {
    const indexes = await rows("PRAGMA index_list(locks)")
    expect(indexes).toContainEqual(
      expect.objectContaining({ name: "locks_owner_lock", unique: 1 }),
    )
    // A lock changes owner in a later run (the lock sweep re-reads it).
    const reader = fixtureReader()
    await runScanCopy(deps({ warehouse: reader }))
    const [lock] = reader.source.locks
    if (lock === undefined) throw new Error("fixture")
    const other = "0x00000000000000000000000000000000000000d4"
    reader.source.locks = reader.source.locks.map((row) =>
      row === lock ? { ...row, owner: other } : row,
    )
    await runScanCopy(deps({ warehouse: reader, nowSeconds: now + 900 }))
    expect(
      await rows(
        "SELECT owner FROM locks WHERE escrow = ?1 AND token_id = ?2",
        lock.contract_address.toLowerCase(),
        lock.token_id,
      ),
    ).toEqual([{ owner: other }])
    // Two locks swapping owners in one statement.
    const [a, b] = await rows(
      "SELECT escrow, token_id, owner FROM locks ORDER BY token_id LIMIT 2",
    )
    if (a === undefined || b === undefined) throw new Error("two locks")
    await env.SCAN_DB.prepare(
      `UPDATE locks SET owner = CASE token_id WHEN ?1 THEN ?2 ELSE ?3 END
       WHERE token_id IN (?1, ?4)`,
    )
      .bind(
        String(a.token_id),
        String(b.owner),
        String(a.owner),
        String(b.token_id),
      )
      .run()
  })
})
