import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  scanDimensionMatches,
  scanMetricDefinition,
} from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import {
  historyChunks,
  historyStatements,
} from "../../scripts/scan-backfill/closes"
import { inlineStatementsOf } from "../../scripts/scan-backfill/lib"
import { troveDebtFlow } from "./aggregates"
import { earnPoolsPoints } from "./earn-pools"
import {
  incompleteBalanceDays,
  rollupDays,
  rollupPoints,
  tokenRollups,
  troveDaysDirtySql,
  withRollups,
} from "./market-rollups"

// Batch 2's market summaries: per-token sums across Mezo's pools, the
// trove debt split into borrowed, repaid, redeemed and liquidated, and the
// one-time backfill's SQL applied to SQLite (the engine D1 runs) after the
// real migrations.

const btc = "0x7b7c000000000000000000000000000000000000"
const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const poolA = "0x52e604c44417233b6ccedddc0d640a405caacefb"
const poolB = "0x9f3b0000000000000000000000000000000c2a8a"

describe("token rollups", () => {
  it("sums each pool-token metric per token, exactly", () => {
    const points = rollupPoints([
      {
        metric: "pool.balance",
        dimension: `${poolA}:${btc}`,
        value: 54_050_000_000_000_000_000n,
      },
      {
        metric: "pool.balance",
        dimension: `${poolA}:${musd}`,
        value: 5_706_374_000_000_000_000_000_000n,
      },
      {
        metric: "pool.balance",
        dimension: `${poolB}:${musd}`,
        value: 2_539_600_000_000_000_000_000_000n,
      },
      {
        metric: "dex.volume_in",
        dimension: `${poolA}:${musd}`,
        value: 1n,
      },
      // Not a pool-token metric: never rolled up.
      { metric: "token.total_supply", dimension: musd, value: 9n },
    ])
    expect(points).toEqual([
      { metric: "dex.token_volume_in", dimension: musd, value: 1n },
      {
        metric: "pool.token_balance",
        dimension: btc,
        value: 54_050_000_000_000_000_000n,
      },
      {
        metric: "pool.token_balance",
        dimension: musd,
        value: 8_245_974_000_000_000_000_000_000n,
      },
    ])
  })

  it("adds the rollups beside the points they come from", () => {
    const base = [
      {
        metric: "pool.balance",
        dimension: `${poolA}:${btc}`,
        value: 3n,
      },
    ]
    expect(withRollups(base)).toEqual([
      ...base,
      { metric: "pool.token_balance", dimension: btc, value: 3n },
    ])
  })

  it("writes only registered metrics with token dimensions", () => {
    for (const rollup of Object.values(tokenRollups)) {
      const definition = scanMetricDefinition(rollup)
      expect(definition?.dimension).toBe("token")
      expect(definition?.decimals).toBe("token")
      expect(scanDimensionMatches("token", btc)).toBe(true)
    }
    expect(scanMetricDefinition("pool.token_balance")?.kind).toBe("level")
    expect(scanMetricDefinition("dex.token_volume_in")?.kind).toBe("flow")
  })

  it("rolls the earn-pools subgraph's volume up per token, per day", () => {
    const micros = (seconds: number) => `${seconds}000000`
    const day = 1_762_732_800
    const ref = (pool: string) => ({
      id: pool,
      token0: { id: btc },
      token1: { id: musd },
    })
    const points = earnPoolsPoints({
      data: {
        poolVolumes: [
          {
            timestamp: micros(day),
            pool: ref(poolA),
            totalVolume0: "10",
            totalVolume1: "200",
          },
        ],
        clpoolVolumes: [
          {
            timestamp: micros(day),
            pool: ref(poolB),
            totalVolume0: "5",
            totalVolume1: "0",
          },
        ],
        feesStats_collection: [],
        clfeeStats_collection: [],
      },
    }).get(day)
    expect(
      points?.filter((point) => point.metric === "dex.token_volume_in"),
    ).toEqual([
      { metric: "dex.token_volume_in", dimension: btc, value: 15n },
      { metric: "dex.token_volume_in", dimension: musd, value: 200n },
    ])
  })
})

describe("trove debt flows", () => {
  const event = (
    emitter: string,
    action: string,
    debt_change: string | null,
  ) => ({ emitter, action, debt_change })

  it("splits borrower operations into borrowed and repaid", () => {
    expect(
      troveDebtFlow(event("BORROWER_OPERATIONS", "LOAN_OPENED", "2200")),
    ).toEqual({ metric: "musd.borrowed", amount: 2200n })
    expect(
      troveDebtFlow(event("BORROWER_OPERATIONS", "LOAN_REFINANCED", "12")),
    ).toEqual({ metric: "musd.borrowed", amount: 12n })
    expect(
      troveDebtFlow(event("BORROWER_OPERATIONS", "LOAN_REPAID", "-500")),
    ).toEqual({ metric: "musd.repaid", amount: 500n })
    expect(
      troveDebtFlow(event("BORROWER_OPERATIONS", "LOAN_CLOSED", "-1700")),
    ).toEqual({ metric: "musd.repaid", amount: 1700n })
  })

  it("keeps redemptions and liquidations apart, and leaves the rest out", () => {
    expect(
      troveDebtFlow(event("TROVE_MANAGER", "LOAN_REDEEMED", "-40")),
    ).toEqual({ metric: "musd.redeemed", amount: 40n })
    expect(
      troveDebtFlow(event("TROVE_MANAGER", "LOAN_LIQUIDATED", "-90")),
    ).toEqual({ metric: "musd.liquidated", amount: 90n })
    // Redistributed debt is neither minted nor repaid.
    expect(
      troveDebtFlow(event("TROVE_MANAGER", "LOAN_REWARDS_APPLIED", "7")),
    ).toBeNull()
    // An unknown change and no change are none.
    expect(
      troveDebtFlow(event("BORROWER_OPERATIONS", "LOAN_ADJUSTED", null)),
    ).toBeNull()
    expect(
      troveDebtFlow(event("BORROWER_OPERATIONS", "LOAN_COLL_ADDED", "0")),
    ).toBeNull()
    for (const metric of [
      "musd.borrowed",
      "musd.repaid",
      "musd.redeemed",
      "musd.liquidated",
    ]) {
      expect(scanMetricDefinition(metric)?.dimension).toBe("total")
    }
  })
})

function scanDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  const dir = path.resolve(import.meta.dirname, "../../scan-migrations")
  for (const file of readdirSync(dir).sort()) {
    db.exec(readFileSync(path.join(dir, file), "utf8"))
  }
  return db
}

describe("the market rollups backfill", () => {
  const stored = [
    { metric: "pool.balance", dimension: `${poolA}:${musd}`, value: "100" },
    { metric: "pool.balance", dimension: `${poolB}:${musd}`, value: "50" },
    { metric: "dex.volume_in", dimension: `${poolA}:${btc}`, value: "7" },
  ]

  it("rolls up whole days only, never today", () => {
    const days = rollupDays(
      [
        ...stored.map((row) => ({ ...row, day: "2026-11-13" })),
        ...stored.map((row) => ({ ...row, day: "2026-11-15" })),
      ],
      "2026-11-15",
    )
    expect([...days.keys()]).toEqual(["2026-11-13"])
    expect(days.get("2026-11-13")).toEqual([
      { metric: "dex.token_volume_in", dimension: btc, value: 7n },
      { metric: "pool.token_balance", dimension: musd, value: 150n },
    ])
  })

  it("inserts absent rows only and bumps data_version once", () => {
    const db = scanDatabase()
    db.exec(
      "UPDATE scan_status SET data_version = 5, change_mark = 0 WHERE id = 1",
    )
    // The live writer already wrote 13 Nov's MUSD rollup: it stays.
    db.exec(`INSERT INTO daily (metric, dimension, day, value, source, partial, updated_at)
      VALUES ('pool.token_balance', '${musd}', '2026-11-13', '149', 'live', 0, 1)`)
    const days = rollupDays(
      [
        ...stored.map((row) => ({ ...row, day: "2026-11-12" })),
        ...stored.map((row) => ({ ...row, day: "2026-11-13" })),
      ],
      "2026-11-15",
    )
    const sql = inlineStatementsOf(
      historyStatements(days, 1_763_200_000, "backfill:market-rollups"),
    )
    db.exec(sql)
    const rows = () =>
      db
        .prepare(
          "SELECT metric, dimension, day, value, source FROM daily ORDER BY day, metric",
        )
        .all()
    expect(rows()).toEqual([
      {
        metric: "dex.token_volume_in",
        dimension: btc,
        day: "2026-11-12",
        value: "7",
        source: "backfill:market-rollups",
      },
      {
        metric: "pool.token_balance",
        dimension: musd,
        day: "2026-11-12",
        value: "150",
        source: "backfill:market-rollups",
      },
      {
        metric: "dex.token_volume_in",
        dimension: btc,
        day: "2026-11-13",
        value: "7",
        source: "backfill:market-rollups",
      },
      {
        metric: "pool.token_balance",
        dimension: musd,
        day: "2026-11-13",
        value: "149",
        source: "live",
      },
    ])
    const version = () =>
      db.prepare("SELECT data_version FROM scan_status WHERE id = 1").get()
    expect(version()).toEqual({ data_version: 6 })
    // Applying the file again changes nothing.
    db.exec(sql)
    expect(version()).toEqual({ data_version: 6 })
    expect(rows()).toHaveLength(4)
  })

  it("leaves out a day's balances when a pool's read is missing", () => {
    // archive-reads lets one read fail: poolB has rows the day before and
    // after the 12th but none on it, so the 12th's balance sum would be
    // short. Its volume (no row is no swap) still rolls up.
    const rows = [
      ...stored.map((row) => ({ ...row, day: "2026-11-11" })),
      ...stored
        .filter((row) => row.dimension !== `${poolB}:${musd}`)
        .map((row) => ({ ...row, day: "2026-11-12" })),
      ...stored.map((row) => ({ ...row, day: "2026-11-13" })),
    ]
    expect(incompleteBalanceDays(rows)).toEqual(["2026-11-12"])
    const days = rollupDays(rows, "2026-11-15")
    expect(days.get("2026-11-12")).toEqual([
      { metric: "dex.token_volume_in", dimension: btc, value: 7n },
    ])
    expect(days.get("2026-11-13")).toHaveLength(2)
  })

  it("moves data_version with every file, each applied on its own", () => {
    // `wrangler d1 execute --file` runs each file in its own session, and
    // total_changes() counts per connection: each file is its own batch.
    const dir = mkdtempSync(path.join(tmpdir(), "rollups-"))
    const file = path.join(dir, "scan.db")
    try {
      const setup = new DatabaseSync(file)
      const migrations = path.resolve(
        import.meta.dirname,
        "../../scan-migrations",
      )
      for (const name of readdirSync(migrations).sort()) {
        setup.exec(readFileSync(path.join(migrations, name), "utf8"))
      }
      setup.exec(
        "UPDATE scan_status SET data_version = 5, change_mark = 0 WHERE id = 1",
      )
      setup.close()
      const days = rollupDays(
        ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].flatMap(
          (day) => stored.map((row) => ({ ...row, day })),
        ),
        "2026-11-15",
      )
      // Two rows a day, at most three a file: one day a file.
      const chunks = historyChunks(days, 3)
      expect(chunks.map((chunk) => [...chunk.keys()])).toEqual([
        ["2026-11-10"],
        ["2026-11-11"],
        ["2026-11-12"],
        ["2026-11-13"],
      ])
      const versions: unknown[] = []
      for (const chunk of chunks) {
        const db = new DatabaseSync(file)
        db.exec(
          inlineStatementsOf(
            historyStatements(chunk, 1_763_200_000, "backfill:market-rollups"),
          ),
        )
        versions.push(
          db.prepare("SELECT data_version FROM scan_status WHERE id = 1").get(),
        )
        db.close()
      }
      expect(versions).toEqual(
        [6, 7, 8, 9].map((data_version) => ({ data_version })),
      )
      expect(historyChunks(days, 4).map((chunk) => chunk.size)).toEqual([2, 2])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("marks each day with a trove event dirty, once per day", () => {
    const db = scanDatabase()
    const insert = db.prepare(`INSERT INTO trove_events (tx_hash, log_index,
      block_number, timestamp, tx_from, contract_address, emitter, borrower,
      operation, action, principal, interest, coll, stake)
      VALUES (?, ?, 1, ?, ?, ?, 'BORROWER_OPERATIONS', ?, 0, 'LOAN_OPENED',
      '0', '0', '0', '0')`)
    const address = `0x${"1".repeat(40)}`
    for (const [index, timestamp] of [
      1_762_732_800, 1_762_740_000, 1_762_819_200,
    ].entries()) {
      insert.run(
        `0x${String(index).padStart(64, "0")}`,
        0,
        timestamp,
        address,
        address,
        address,
      )
    }
    db.exec(
      "INSERT INTO scan_dirty (kind, key, generation) VALUES ('day', '2025-11-11', 3)",
    )
    db.exec(troveDaysDirtySql)
    expect(
      db
        .prepare("SELECT kind, key, generation FROM scan_dirty ORDER BY key")
        .all(),
    ).toEqual([
      { kind: "day", key: "2025-11-10", generation: 0 },
      { kind: "day", key: "2025-11-11", generation: 4 },
    ])
  })
})
