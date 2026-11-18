import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { runScanCopy, type ScanCopyDeps } from "./copy"
import { labelSeed } from "./labels"
import type { TickSummary } from "./summary"
import {
  activityFixture,
  btc,
  dayE,
  dayE1,
  epochE,
  epochE1,
  fixtureReader,
  gaugeG,
  gaugeG2,
  marketM,
  mezo,
  musd,
  poolP,
  veBTC,
} from "./testing/fixture"

// The copy step against Miniflare D1, with the fixture's Neon rows: rows
// in, expected rows out, checkpoints, idempotent re-runs, a failed run
// resuming, the summary skip and the per-run row cap.

const logger = createLogger({ level: "error" })
const now = epochE1 + 3_600

const scanTables = [
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
  "scan_cursors",
  "scan_dirty",
  "scan_runs",
]

async function resetScan(): Promise<void> {
  await env.SCAN_DB.batch(
    scanTables.map((table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`)),
  )
}

beforeEach(async () => {
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await resetScan()
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

async function count(table: string): Promise<number> {
  const row = await env.SCAN_DB.prepare(
    `SELECT count(*) AS n FROM ${table}`,
  ).first()
  return z.object({ n: z.number() }).parse(row).n
}

async function rows(sql: string, ...params: (string | number)[]) {
  const result = await env.SCAN_DB.prepare(sql)
    .bind(...params)
    .all()
  return result.results
}

async function dataVersion(): Promise<number> {
  const row = await env.SCAN_DB.prepare(
    "SELECT data_version FROM scan_status WHERE id = 1",
  ).first()
  return z.object({ data_version: z.number() }).parse(row).data_version
}

async function cursor(name: string): Promise<string | null> {
  const row = await env.SCAN_DB.prepare(
    "SELECT value FROM scan_cursors WHERE name = ?1",
  )
    .bind(name)
    .first()
  return z.object({ value: z.string() }).nullable().parse(row)?.value ?? null
}

/** Everything a copy produces, for comparing two runs' end states. */
async function snapshot() {
  return {
    activity: await rows("SELECT * FROM activity ORDER BY id"),
    locks: await rows("SELECT * FROM locks ORDER BY escrow, token_id"),
    votes: await rows(
      "SELECT * FROM lock_votes ORDER BY epoch_start, gauge, token_id",
    ),
    deposits: await rows("SELECT * FROM incentive_deposits ORDER BY tx_hash"),
    totals: await rows("SELECT * FROM epoch_totals ORDER BY epoch_start").then(
      (list) => list.map(({ updated_at: _u, ...rest }) => rest),
    ),
    gauges: await rows(
      "SELECT * FROM gauge_epoch ORDER BY epoch_start, gauge",
    ).then((list) => list.map(({ updated_at: _u, ...rest }) => rest)),
    daily: await rows(
      "SELECT metric, dimension, day, value, source FROM daily ORDER BY metric, dimension, day",
    ),
  }
}

const advanced: TickSummary = {
  kind: "matchbox-indexer-tick",
  version: 1,
  network: "mezo",
  projection: { status: "advanced" },
  borrow: { status: "advanced" },
}

describe("scan copy step", () => {
  it("copies the fixture into the scan tables", async () => {
    const result = await runScanCopy(deps())
    expect(result).toMatchObject({ status: "ok", capped: [] })

    expect(await count("activity")).toBe(activityFixture.length)
    expect(await count("incentive_deposits")).toBe(3)
    expect(await count("trove_events")).toBe(2)
    expect(await count("morpho_events")).toBe(2)
    expect(await count("enclave_events")).toBe(1)

    // Votes map to the gauge and the lock's escrow; amounts stay TEXT.
    const [vote] = await rows(
      "SELECT * FROM activity WHERE action_type = 'BOOST_VOTE' ORDER BY id LIMIT 1",
    )
    expect(vote).toMatchObject({
      gauge: gaugeG,
      pool: poolP,
      lock_escrow: veBTC,
      token_id: "100",
      weight: "4000000000000000000000",
      epoch_start: epochE,
    })

    const locks = await rows("SELECT * FROM locks ORDER BY token_id")
    expect(locks).toHaveLength(2)
    expect(locks[0]).toMatchObject({
      escrow: veBTC,
      token_id: "100",
      amount: "6000000000000000000",
      amount_key: "6000000000000000000".padStart(40, "0"),
      is_permanent: 0,
    })

    // Epoch E: both locks on G. Epoch E+1: lock 100 carried, lock 101
    // reset and moved to G2.
    expect(
      await rows(
        "SELECT epoch_start, gauge, token_id, weight, carried FROM lock_votes ORDER BY epoch_start, gauge, token_id",
      ),
    ).toEqual([
      {
        epoch_start: epochE,
        gauge: gaugeG,
        token_id: "100",
        weight: "4000000000000000000000",
        carried: 0,
      },
      {
        epoch_start: epochE,
        gauge: gaugeG,
        token_id: "101",
        weight: "1000000000000000000000",
        carried: 0,
      },
      {
        epoch_start: epochE1,
        gauge: gaugeG,
        token_id: "100",
        weight: "4000000000000000000000",
        carried: 1,
      },
      {
        epoch_start: epochE1,
        gauge: gaugeG2,
        token_id: "101",
        weight: "1500000000000000000000",
        carried: 0,
      },
    ])

    const gauges = await rows(
      "SELECT epoch_start, gauge, vote_weight, voters, incentives, fees, rank FROM gauge_epoch ORDER BY epoch_start, gauge",
    )
    expect(gauges).toEqual([
      {
        epoch_start: epochE,
        gauge: gaugeG,
        vote_weight: "5000000000000000000000",
        voters: 2,
        incentives: JSON.stringify({ [mezo]: "500" }),
        fees: JSON.stringify({ [btc]: "40" }),
        rank: 1,
      },
      {
        epoch_start: epochE1,
        gauge: gaugeG,
        vote_weight: "4000000000000000000000",
        voters: 1,
        incentives: "{}",
        fees: "{}",
        rank: 1,
      },
      {
        epoch_start: epochE1,
        gauge: gaugeG2,
        vote_weight: "1500000000000000000000",
        voters: 1,
        incentives: JSON.stringify({ [musd]: "800" }),
        fees: "{}",
        rank: 2,
      },
    ])

    const totals = await rows(
      "SELECT epoch_start, emission, gauge_rewards, vote_transactions, voters, vote_weight, gauges, incentives, top_gauge FROM epoch_totals ORDER BY epoch_start",
    )
    expect(totals).toEqual([
      {
        epoch_start: epochE,
        emission: null,
        gauge_rewards: null,
        vote_transactions: 1,
        voters: 2,
        vote_weight: JSON.stringify({ POOLS_VOTER: "5000000000000000000000" }),
        gauges: 1,
        incentives: JSON.stringify({ [mezo]: "500" }),
        top_gauge: JSON.stringify({ POOLS_VOTER: gaugeG }),
      },
      {
        epoch_start: epochE1,
        emission: "1000000",
        gauge_rewards: "900000",
        vote_transactions: 1,
        voters: 2,
        vote_weight: JSON.stringify({ POOLS_VOTER: "5500000000000000000000" }),
        gauges: 2,
        incentives: JSON.stringify({ [musd]: "800" }),
        top_gauge: JSON.stringify({ POOLS_VOTER: gaugeG }),
      },
    ])

    const daily = await rows(
      "SELECT metric, dimension, day, value FROM daily WHERE day = ?1 ORDER BY metric, dimension",
      dayE,
    )
    expect(daily).toEqual([
      { metric: "dex.swaps", dimension: poolP, day: dayE, value: "2" },
      { metric: "fees.voters", dimension: btc, day: dayE, value: "40" },
      {
        metric: "incentives.deposited",
        dimension: mezo,
        day: dayE,
        value: "500",
      },
      { metric: "locks.created", dimension: "vebtc", day: dayE, value: "2" },
      {
        metric: "locks.deposited",
        dimension: "vebtc",
        day: dayE,
        value: "7000000000000000000",
      },
      {
        metric: "locks.net",
        dimension: "vebtc",
        day: dayE,
        value: "7000000000000000000",
      },
      {
        metric: "morpho.borrow_change",
        dimension: marketM,
        day: dayE,
        value: "300",
      },
      {
        metric: "morpho.supply_change",
        dimension: marketM,
        day: dayE,
        value: "1000",
      },
      // The fixture's one trove event is a borrower's: 1,000 borrowed.
      { metric: "musd.borrowed", dimension: "", day: dayE, value: "1000" },
      { metric: "musd.coll_change", dimension: "", day: dayE, value: "5" },
      { metric: "musd.debt_change", dimension: "", day: dayE, value: "1000" },
      { metric: "savings.deposited", dimension: "", day: dayE, value: "700" },
      { metric: "savings.net", dimension: "", day: dayE, value: "700" },
      {
        metric: "votes.transactions",
        dimension: "POOLS_VOTER",
        day: dayE,
        value: "1",
      },
    ])
    const repaid = await rows(
      "SELECT value FROM daily WHERE metric = 'musd.debt_change' AND day = ?1",
      dayE1,
    )
    expect(repaid).toEqual([{ value: "-400" }])
    expect(
      await rows(
        "SELECT value FROM daily WHERE metric = 'emissions.minted' AND day = ?1",
        dayE1,
      ),
    ).toEqual([{ value: "1000000" }])

    // Seed and derived labels; a curated name is never replaced.
    expect(await count("labels")).toBe(labelSeed().length + 3)
    expect(
      await rows(
        "SELECT name, source FROM labels WHERE address IN (?1, ?2) ORDER BY address",
        poolP,
        gaugeG,
      ),
    ).toEqual([
      { name: "vAMM BTC/MUSD", source: "contracts" },
      { name: "Gauge vAMM BTC/MUSD", source: "contracts" },
    ])
    expect(
      await rows("SELECT name, source FROM labels WHERE address = ?1", veBTC),
    ).toEqual([{ name: "veBTC", source: "curated" }])

    // Checkpoints, the run record, and nothing left dirty.
    expect(await cursor("copy:activity")).toBe(String(epochE1 + 200))
    expect(await cursor("copy:deposits")).toBe("202")
    expect(await cursor("copy:morpho")).toBe("104")
    expect(await cursor("copy:contracts")).toBe(
      `2026-11-05T00:01:41.000000Z|0x${"5".repeat(40)}`,
    )
    expect(await cursor("lock-votes:epoch")).toBe(String(epochE1))
    expect(await count("scan_dirty")).toBe(0)
    expect(await rows("SELECT job, trigger, status FROM scan_runs")).toEqual([
      { job: "scan-copy", trigger: "chained", status: "ok" },
    ])
  })

  it("advances checkpoints: a second run reads nothing new and writes nothing", async () => {
    await runScanCopy(deps())
    const version = await dataVersion()
    const reader = fixtureReader()
    const second = await runScanCopy(deps({ warehouse: reader }))
    // It re-reads only what it diffs or overlaps on purpose (the Enclave
    // table, the contracts' last hour, the lock sweep, the activity and
    // block overlaps) and changes no served row: data_version stays.
    expect(second).toMatchObject({ status: "ok" })
    if (second.status !== "ok") throw new Error("expected a run")
    expect(second.rowsRead).toBeGreaterThan(0)
    expect(await dataVersion()).toBe(version)
    expect(reader.reads[0]?.checkpoints).toMatchObject({
      activity: String(epochE1 + 200),
      troves: "210",
      enclave: "106",
    })
  })

  it("is idempotent: replaying the same rows from scratch changes nothing", async () => {
    await runScanCopy(deps())
    const first = await snapshot()
    await env.SCAN_DB.prepare("DELETE FROM scan_cursors").run()
    const replay = await runScanCopy(deps())
    expect(replay.status).toBe("ok")
    expect(await snapshot()).toEqual(first)
  })

  it("leaves checkpoints untouched when the copy batch fails, then resumes", async () => {
    let failNext = true
    const failing: D1Database = {
      prepare: (sql) => env.SCAN_DB.prepare(sql),
      batch: async (statements) => {
        if (failNext && statements.length > 10) {
          failNext = false
          throw new Error("D1 unavailable")
        }
        return env.SCAN_DB.batch(statements)
      },
      exec: (sql) => env.SCAN_DB.exec(sql),
      dump: () => env.SCAN_DB.dump(),
      withSession: (constraint) => env.SCAN_DB.withSession(constraint),
    }
    await expect(runScanCopy(deps({ db: failing }))).rejects.toThrow(
      "D1 unavailable",
    )
    expect(await count("activity")).toBe(0)
    expect(await cursor("copy:activity")).toBeNull()
    expect(await rows("SELECT status FROM scan_runs")).toEqual([
      { status: "failed" },
    ])

    await runScanCopy(deps({ db: failing }))
    const resumed = await snapshot()
    await resetScan()
    await runScanCopy(deps())
    expect(resumed).toEqual(await snapshot())
  })

  it("records a committed copy as ok when the aggregates fail after it, keeping their markers", async () => {
    let batches = 0
    const failing: D1Database = {
      prepare: (sql) => env.SCAN_DB.prepare(sql),
      batch: async (statements) => {
        batches += 1
        if (batches === 2) throw new Error("aggregate batch failed")
        return env.SCAN_DB.batch(statements)
      },
      exec: (sql) => env.SCAN_DB.exec(sql),
      dump: () => env.SCAN_DB.dump(),
      withSession: (constraint) => env.SCAN_DB.withSession(constraint),
    }
    // The copy batch (the first) committed; the aggregates fail after it.
    const result = await runScanCopy(deps({ db: failing }))
    expect(result).toMatchObject({ status: "ok", aggregates: null })
    expect(await count("activity")).toBe(activityFixture.length)
    expect(await count("scan_dirty")).toBeGreaterThan(0)
    // Not "failed, checkpoints unchanged": the checkpoints did move.
    const run = await env.SCAN_DB.prepare(
      "SELECT status, detail FROM scan_runs ORDER BY id DESC LIMIT 1",
    ).first()
    expect(run).toMatchObject({
      status: "ok",
      detail: expect.stringContaining("aggregates: aggregate batch failed"),
    })
    expect(
      await env.SCAN_DB.prepare(
        "SELECT last_run_status, last_error FROM scan_status",
      ).first(),
    ).toMatchObject({
      last_run_status: "ok",
      last_error: expect.stringContaining("aggregates"),
    })
    await runScanCopy(deps())
    expect(await count("scan_dirty")).toBe(0)
    expect(await count("epoch_totals")).toBe(2)
  })

  it("skips Neon when the tick summary says no stream advanced", async () => {
    const reader = fixtureReader()
    const result = await runScanCopy(
      deps({
        warehouse: reader,
        summary: {
          ...advanced,
          projection: { status: "at-head" },
          borrow: { status: "at-head" },
        },
      }),
    )
    expect(result).toMatchObject({
      status: "skipped",
      reason: "No stream advanced",
    })
    expect(reader.reads).toHaveLength(0)
    // The skip is recorded, so the cron fallback knows the tick was handled.
    expect(await rows("SELECT status, trigger FROM scan_runs")).toEqual([
      { status: "skipped", trigger: "chained" },
    ])
  })

  it("does not touch Neon on the cron fallback after a skipped chained run", async () => {
    const quiet = {
      ...advanced,
      projection: { status: "at-head" as const },
      borrow: { status: "at-head" as const },
    }
    await runScanCopy(deps({ summary: quiet }))
    const reader = fixtureReader()
    const cron = await runScanCopy(
      deps({ warehouse: reader, trigger: "cron", nowSeconds: now + 180 }),
    )
    expect(cron).toMatchObject({ status: "skipped" })
    expect(reader.reads).toHaveLength(0)
    // Ten minutes on, with no chained run, the fallback does copy.
    const later = await runScanCopy(
      deps({ warehouse: reader, trigger: "cron", nowSeconds: now + 700 }),
    )
    expect(later.status).toBe("ok")
    expect(reader.reads).toHaveLength(1)
  })

  it("does not start a cron run while a recent run is still running", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO scan_runs (job, trigger, started_at, status)
       VALUES ('scan-copy', 'chained', ?1, 'running')`,
    )
      .bind(now - 60)
      .run()
    const reader = fixtureReader()
    const cron = await runScanCopy(deps({ warehouse: reader, trigger: "cron" }))
    expect(cron).toMatchObject({ status: "skipped" })
    expect(reader.reads).toHaveLength(0)
  })

  it("reads only the streams that advanced", async () => {
    const reader = fixtureReader()
    await runScanCopy(
      deps({
        warehouse: reader,
        summary: { ...advanced, projection: { status: "at-head" } },
      }),
    )
    expect([...(reader.reads[0]?.tables ?? [])].sort()).toEqual([
      "enclave",
      "morpho",
    ])
    expect(await count("activity")).toBe(0)
    expect(await count("morpho_events")).toBe(2)
  })

  it("skips a cron fallback run after a recent chained run", async () => {
    await runScanCopy(deps())
    const result = await runScanCopy(deps({ trigger: "cron" }))
    expect(result).toMatchObject({
      status: "skipped",
      reason: "A scan run started recently",
    })
  })

  it("caps rows per run, completing the last block, and catches up over runs", async () => {
    const caps = {
      activity: 2,
      deposits: 1,
      troves: 1,
      morpho: 1,
      enclave: 1,
      contracts: 1,
    }
    const first = await runScanCopy(deps({ caps }))
    if (first.status !== "ok") throw new Error("expected a run")
    expect(first.capped).toContain("activity")
    // The cap is 2, but the second row's block holds a third: all three.
    expect(await count("activity")).toBe(3)
    expect(await count("morpho_events")).toBe(2)
    expect(await cursor("copy:activity")).toBe(String(epochE + 200))

    let runs = 1
    let capped = first.capped
    while (capped.length > 0 && runs < 20) {
      const next = await runScanCopy(deps({ caps, nowSeconds: now + runs }))
      if (next.status !== "ok") throw new Error("expected a run")
      capped = next.capped
      runs += 1
    }
    expect(runs).toBeGreaterThan(3)
    const caughtUp = await snapshot()
    await resetScan()
    await runScanCopy(deps())
    const uncapped = await snapshot()
    expect(caughtUp.activity).toEqual(uncapped.activity)
    expect(caughtUp.votes).toEqual(uncapped.votes)
    expect(caughtUp.totals).toEqual(uncapped.totals)
    expect(caughtUp.gauges).toEqual(uncapped.gauges)
    expect(caughtUp.daily).toEqual(uncapped.daily)
  })
})
