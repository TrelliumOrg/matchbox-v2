import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { EPOCH_ZERO_START } from "@matchbox/domain"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { aggregateOrder, runAggregates } from "./aggregates"
import { runScanCopy, type ScanCopyDeps, startScanCopy } from "./copy"
import { dirtyStatement, runBatch } from "./statements"
import type { TickSummary } from "./summary"
import {
  activity,
  activityFixture,
  dayE,
  dayE1,
  depositFixture,
  enclaveFixture,
  epochE,
  epochE1,
  fixtureReader,
  gaugeG,
  gaugeG2,
  marketM,
  mezo,
  morphoFixture,
  ownerA,
  poolsVoter,
} from "./testing/fixture"

// The repairs from the review: late and changed rows, the status row,
// replays, quarantine, the aggregate order and marker race, and the
// aggregate fixes (future-epoch deposits, killed gauges, bad debt).

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
  "epoch_totals",
  "gauge_epoch",
  "daily",
  "price_daily",
  "pools",
  "scan_cursors",
  "scan_dirty",
  "scan_runs",
  "scan_status",
  "scan_quarantine",
]

beforeEach(async () => {
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await env.SCAN_DB.batch(
    tables.map((table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`)),
  )
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

const summary = (projection: number, borrow: number): TickSummary => ({
  kind: "matchbox-indexer-tick",
  version: 1,
  network: "mezo",
  projection: { status: "advanced", decoderVersion: projection },
  borrow: { status: "advanced", decoderVersion: borrow },
})

describe("rows behind the checkpoint and changed rows", () => {
  it("copies an Enclave row inserted behind its checkpoint", async () => {
    const reader = fixtureReader()
    await runScanCopy(deps({ warehouse: reader }))
    // A newly granted Enclave's earlier logs are back-filled weeks behind.
    const [first] = enclaveFixture
    if (first === undefined) throw new Error("fixture")
    reader.source.enclave.push({
      ...first,
      tx_hash: `0x${"9".repeat(64)}`,
      block_number: "50",
      timestamp: String(epochE - 86_400),
    })
    await runScanCopy(deps({ warehouse: reader, nowSeconds: now + 900 }))
    expect(
      await rows(
        "SELECT block_number FROM enclave_events ORDER BY block_number",
      ),
    ).toEqual([{ block_number: 50 }, { block_number: 106 }])
  })

  it("repairs a changed event row when it is read again, and writes nothing otherwise", async () => {
    const reader = fixtureReader()
    await runScanCopy(deps({ warehouse: reader }))
    // A decoder fix changes a copied row; a re-fill (checkpoints reset)
    // reads it again.
    const index = reader.source.deposits.findIndex((row) => row.token === mezo)
    const deposit = reader.source.deposits[index]
    if (deposit === undefined) throw new Error("fixture")
    reader.source.deposits[index] = { ...deposit, amount: "650" }
    await env.SCAN_DB.prepare(
      "DELETE FROM scan_cursors WHERE name LIKE 'copy:%'",
    ).run()
    await runScanCopy(deps({ warehouse: reader, nowSeconds: now + 900 }))
    expect(
      await rows(
        "SELECT amount FROM incentive_deposits WHERE token = ?1",
        mezo,
      ),
    ).toEqual([{ amount: "650" }])
    expect(
      await rows(
        "SELECT incentives FROM gauge_epoch WHERE gauge = ?1 AND epoch_start = ?2",
        gaugeG,
        epochE,
      ),
    ).toEqual([{ incentives: JSON.stringify({ [mezo]: "650" }) }])
  })

  it("picks up a lock change that has no activity row (boost) through the sweep", async () => {
    const reader = fixtureReader()
    await runScanCopy(deps({ warehouse: reader }))
    const index = reader.source.locks.findIndex(
      (lock) => lock.token_id === "101",
    )
    const lock = reader.source.locks[index]
    if (lock === undefined) throw new Error("fixture")
    reader.source.locks[index] = { ...lock, boost: "1500000000000000000" }
    // No new activity: only the sweep re-reads lock positions.
    await runScanCopy(deps({ warehouse: reader, nowSeconds: now + 900 }))
    expect(
      await rows("SELECT boost FROM locks WHERE token_id = '101'"),
    ).toEqual([{ boost: "1500000000000000000" }])
  })
})

describe("replays, quarantine and the status row", () => {
  it("records the status row the API reads", async () => {
    await runScanCopy(deps())
    expect(await status()).toMatchObject({
      last_run_status: "ok",
      last_ok_at: now,
      consecutive_failures: 0,
      copied_through: epochE1 + 200,
      dirty_epochs: 0,
      dirty_days: 0,
      aggregates_complete: 1,
      history_filled: 0,
      refill_required: 0,
      quarantined_rows: 0,
    })
  })

  it("counts consecutive failed runs and clears them on success", async () => {
    const broken = {
      async read(): Promise<never> {
        throw new Error("Neon unavailable")
      },
    }
    await expect(runScanCopy(deps({ warehouse: broken }))).rejects.toThrow()
    await expect(
      runScanCopy(deps({ warehouse: broken, nowSeconds: now + 900 })),
    ).rejects.toThrow()
    expect(await status()).toMatchObject({
      last_run_status: "failed",
      consecutive_failures: 2,
      last_error: "Neon unavailable",
    })
    await runScanCopy(deps({ nowSeconds: now + 1_800 }))
    expect(await status()).toMatchObject({
      last_run_status: "ok",
      consecutive_failures: 0,
    })
    // Readers key caches on the last ok run's finished_at (scan_runs).
    expect(
      await rows("SELECT status FROM scan_runs ORDER BY started_at"),
    ).toEqual([{ status: "failed" }, { status: "failed" }, { status: "ok" }])
  })

  it("flags a re-fill when the warehouse is rebuilt under a new decoder", async () => {
    await runScanCopy(deps({ summary: summary(2, 1) }))
    expect(await status()).toMatchObject({ refill_required: 0 })
    await runScanCopy(deps({ summary: summary(3, 1), nowSeconds: now + 900 }))
    const row = z
      .object({ refill_required: z.number(), refill_reason: z.string() })
      .parse(await status())
    expect(row.refill_required).toBe(1)
    expect(row.refill_reason).toContain("projection decoder 2 -> 3")
  })

  it("logs an error on every run once the re-fill flag is over a day old", async () => {
    const lines: { level: string; line: string }[] = []
    const recording = createLogger({
      level: "error",
      format: "json",
      sink: (level, line) => lines.push({ level, line }),
    })
    const pending = () =>
      lines.filter(
        (entry) =>
          entry.level === "error" && entry.line.includes("RE-FILL PENDING"),
      )
    await runScanCopy(deps({ summary: summary(2, 1), logger: recording }))
    await runScanCopy(
      deps({
        summary: summary(3, 1),
        nowSeconds: now + 900,
        logger: recording,
      }),
    )
    expect(pending()).toEqual([])
    // Still pending a day later, on a skipped run (nothing advanced).
    await runScanCopy(
      deps({
        summary: {
          ...summary(3, 1),
          projection: { status: "at-head", decoderVersion: 3 },
          borrow: { status: "at-head", decoderVersion: 1 },
        },
        nowSeconds: now + 900 + 86_400 - 60,
        logger: recording,
      }),
    )
    expect(pending()).toEqual([])
    await runScanCopy(
      deps({
        summary: summary(3, 1),
        nowSeconds: now + 900 + 86_400 + 60,
        logger: recording,
      }),
    )
    expect(pending()).toHaveLength(1)
    expect(pending()[0]?.line).toContain("projection decoder 2 -> 3")
    expect(pending()[0]?.line).toContain('"hours":24')
  })

  it("quarantines a row it cannot transform and copies the rest", async () => {
    const reader = fixtureReader()
    reader.source.activity.push(
      activity({
        n: 77,
        block: 210,
        log: 0,
        ts: epochE1 + 300,
        action: "BOOST_VOTE",
        source: "POOLS_VOTER",
        contract: poolsVoter,
        actor: ownerA,
        token_id: "100",
        gauge: gaugeG,
        weight: "9".repeat(41),
      }),
    )
    const result = await runScanCopy(deps({ warehouse: reader }))
    expect(result).toMatchObject({ status: "ok", quarantined: 1 })
    expect(await rows("SELECT count(*) AS n FROM activity")).toEqual([
      { n: activityFixture.length },
    ])
    expect(await rows("SELECT source FROM scan_quarantine")).toEqual([
      { source: "activity" },
    ])
    expect(await status()).toMatchObject({ quarantined_rows: 1 })
  })

  it("passes unknown enum values through instead of failing", async () => {
    const [deposit] = depositFixture
    if (deposit === undefined) throw new Error("fixture")
    const reader = fixtureReader({
      deposits: [
        ...depositFixture,
        { ...deposit, log_index: "9", reward_type: "Boost" },
      ],
    })
    const result = await runScanCopy(deps({ warehouse: reader }))
    expect(result).toMatchObject({ status: "ok", quarantined: 0 })
    expect(
      await rows(
        "SELECT reward_type FROM incentive_deposits WHERE log_index = 9",
      ),
    ).toEqual([{ reward_type: "Boost" }])
  })
})

describe("aggregates", () => {
  it("counts a deposit for a future epoch on the day it was made", async () => {
    const [deposit] = depositFixture
    if (deposit === undefined) throw new Error("fixture")
    // Deposited on day E, for epoch E+1.
    const reader = fixtureReader({
      deposits: [
        ...depositFixture,
        {
          ...deposit,
          tx_hash: `0x${"8".repeat(64)}`,
          epoch_start: String(epochE1),
          amount: "25",
        },
      ],
    })
    await runScanCopy(deps({ warehouse: reader }))
    expect(
      await rows(
        "SELECT value FROM daily WHERE metric = 'incentives.deposited' AND dimension = ?1 AND day = ?2",
        mezo,
        dayE,
      ),
    ).toEqual([{ value: "525" }])
  })

  it("leaves a killed gauge unranked, keeping its weight apart", async () => {
    const reader = fixtureReader()
    reader.source.activity.push(
      activity({
        n: 60,
        block: 203,
        log: 0,
        ts: epochE1 + 250,
        action: "GAUGE_KILLED",
        source: "POOLS_VOTER",
        contract: poolsVoter,
        gauge: gaugeG,
      }),
    )
    await runScanCopy(deps({ warehouse: reader }))
    expect(
      await rows(
        "SELECT gauge, rank, killed FROM gauge_epoch WHERE epoch_start = ?1 ORDER BY gauge",
        epochE1,
      ),
    ).toEqual([
      { gauge: gaugeG, rank: null, killed: 1 },
      { gauge: gaugeG2, rank: 1, killed: 0 },
    ])
    const [totals] = await rows(
      "SELECT top_gauge, gauges, killed_weight, vote_weight FROM epoch_totals WHERE epoch_start = ?1",
      epochE1,
    )
    expect(totals).toEqual({
      top_gauge: JSON.stringify({ POOLS_VOTER: gaugeG2 }),
      gauges: 1,
      killed_weight: JSON.stringify({ POOLS_VOTER: "4000000000000000000000" }),
      // The voters keep a killed gauge's weight in totalWeight.
      vote_weight: JSON.stringify({ POOLS_VOTER: "5500000000000000000000" }),
    })
    // Epoch E, before the kill, is unaffected.
    expect(
      await rows(
        "SELECT rank, killed FROM gauge_epoch WHERE epoch_start = ?1 AND gauge = ?2",
        epochE,
        gaugeG,
      ),
    ).toEqual([{ rank: 1, killed: 0 }])
  })

  it("writes a liquidation's bad debt off borrow and supply", async () => {
    const [event] = morphoFixture
    if (event === undefined) throw new Error("fixture")
    const reader = fixtureReader({
      morpho: [
        {
          ...event,
          log_index: "7",
          action: "LIQUIDATED",
          assets: "100",
          seized_assets: "3",
          bad_debt_assets: "20",
        },
      ],
    })
    await runScanCopy(deps({ warehouse: reader }))
    expect(
      await rows(
        "SELECT metric, value FROM daily WHERE dimension = ?1 AND day = ?2 ORDER BY metric",
        marketM,
        dayE,
      ),
    ).toEqual([
      { metric: "morpho.borrow_change", value: "-120" },
      { metric: "morpho.collateral_change", value: "-3" },
      { metric: "morpho.supply_change", value: "-20" },
    ])
  })

  it("marks a day partial until the copy has read past its end", async () => {
    await runScanCopy(deps())
    // The copy has read to E1 + 200 s: day E is complete, day E1 is not.
    expect(
      await rows("SELECT DISTINCT day, partial FROM daily ORDER BY day"),
    ).toEqual([
      { day: dayE, partial: 0 },
      { day: dayE1, partial: 1 },
    ])
  })

  it("recomputes the current epoch and day first, then newest first", () => {
    const keys = [
      { kind: "epoch" as const, key: String(epochE), generation: 0 },
      { kind: "day" as const, key: "2026-11-01", generation: 0 },
      { kind: "day" as const, key: dayE1, generation: 0 },
      { kind: "epoch" as const, key: String(epochE1), generation: 0 },
      { kind: "day" as const, key: dayE, generation: 0 },
    ]
    expect(aggregateOrder(keys, epochE1 + 60).map((item) => item.key)).toEqual([
      String(epochE1),
      dayE1,
      dayE,
      "2026-11-01",
      String(epochE),
    ])
  })

  it("stays within its D1 call budget, leaving the rest dirty", async () => {
    await runScanCopy(deps({ aggregateBudget: 8 }))
    const left = await rows("SELECT count(*) AS n FROM scan_dirty")
    expect(left).not.toEqual([{ n: 0 }])
    expect(await status()).toMatchObject({ aggregates_complete: 0 })
    // A skipped run (D1 only) keeps working through them.
    await runScanCopy(
      deps({
        nowSeconds: now + 900,
        summary: {
          ...summary(2, 1),
          projection: { status: "at-head" },
          borrow: { status: "at-head" },
        },
      }),
    )
    await runScanCopy(
      deps({
        nowSeconds: now + 1_800,
        summary: {
          ...summary(2, 1),
          projection: { status: "at-head" },
          borrow: { status: "at-head" },
        },
      }),
    )
    expect(await rows("SELECT count(*) AS n FROM scan_dirty")).toEqual([
      { n: 0 },
    ])
    expect(await status()).toMatchObject({
      last_run_status: "skipped",
      aggregates_complete: 1,
    })
  })

  it("keeps a marker re-set while its aggregate was computed", async () => {
    await runScanCopy(deps())
    await runBatch(env.SCAN_DB, dirtyStatement("epoch", [String(epochE)]))
    // A concurrent copy re-marks the epoch while this run reads its votes.
    let remarked = false
    const racing: D1Database = {
      prepare(sql) {
        const statement = env.SCAN_DB.prepare(sql)
        if (!remarked && sql.includes("FROM lock_votes")) {
          remarked = true
          return {
            ...statement,
            bind: (...values: unknown[]) => {
              const bound = statement.bind(...values)
              return {
                ...bound,
                all: async () => {
                  await runBatch(
                    env.SCAN_DB,
                    dirtyStatement("epoch", [String(epochE)]),
                  )
                  return bound.all()
                },
              }
            },
          } as D1PreparedStatement
        }
        return statement
      },
      batch: (statements) => env.SCAN_DB.batch(statements),
      exec: (sql) => env.SCAN_DB.exec(sql),
      dump: () => env.SCAN_DB.dump(),
      withSession: (constraint) => env.SCAN_DB.withSession(constraint),
    }
    await runAggregates(racing, now)
    expect(
      await rows("SELECT key, generation FROM scan_dirty WHERE kind = 'epoch'"),
    ).toEqual([{ key: String(epochE), generation: 1 }])
    await runAggregates(env.SCAN_DB, now)
    expect(await rows("SELECT count(*) AS n FROM scan_dirty")).toEqual([
      { n: 0 },
    ])
  })
})

describe("concurrent runs", () => {
  it("an overlapping run with older inputs never undoes a newer one", async () => {
    // The second run starts past the 10-minute guard, so both copy at once,
    // and reads an older warehouse state: day E's activity only, no
    // deposits. It finishes last.
    const newer = await startScanCopy(deps({ warehouse: fixtureReader() }))
    const older = await startScanCopy(
      deps({
        nowSeconds: now + 700,
        warehouse: fixtureReader({
          activity: activityFixture.filter(
            (row) => Number(row.timestamp) <= epochE + 600,
          ),
          deposits: [],
        }),
      }),
    )
    await Promise.all([newer.read(), older.read()])
    expect((await newer.finish()).status).toBe("ok")
    expect((await older.finish()).status).toBe("ok")
    await runAggregates(env.SCAN_DB, now + 700)
    const state = async () => ({
      cursors: await rows(
        "SELECT name, value FROM scan_cursors WHERE name LIKE 'copy:%' ORDER BY name",
      ),
      activity: await rows("SELECT * FROM activity ORDER BY id"),
      deposits: await rows(
        "SELECT * FROM incentive_deposits ORDER BY tx_hash, log_index",
      ),
      votes: await rows(
        "SELECT epoch_start, gauge, escrow, token_id, weight, carried FROM lock_votes ORDER BY epoch_start, gauge, token_id",
      ),
      gauges: await rows(
        "SELECT epoch_start, gauge, vote_weight, rank FROM gauge_epoch ORDER BY epoch_start, gauge",
      ),
    })
    const concurrent = await state()
    await env.SCAN_DB.batch(
      tables.map((table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`)),
    )
    await runScanCopy(deps())
    await runAggregates(env.SCAN_DB, now)
    expect(concurrent).toEqual(await state())
  })
})

describe("epochs before Epoch 0", () => {
  it("writes no totals for the week before Epoch 0, and clears its marker", async () => {
    const before = String(EPOCH_ZERO_START - 604_800)
    await runBatch(env.SCAN_DB, dirtyStatement("epoch", [before]))
    await runAggregates(env.SCAN_DB, now)
    expect(
      await rows(
        "SELECT count(*) AS n FROM epoch_totals WHERE epoch_start < ?1",
        EPOCH_ZERO_START,
      ),
    ).toEqual([{ n: 0 }])
    expect(
      await rows("SELECT count(*) AS n FROM scan_dirty WHERE key = ?1", before),
    ).toEqual([{ n: 0 }])
  })
})
