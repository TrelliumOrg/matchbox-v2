import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { Address, Hex } from "viem"
import { afterAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  accountsAt,
  type CloseReader,
  closeBound,
  historySource,
  historyStatements,
  marketIdsOf,
  missingSupplies,
  readClosePoints,
} from "../../scripts/scan-backfill/closes"
import {
  compareWithPresent,
  lastBlockBefore,
  summarizeDays,
  writeSqlFiles,
} from "../../scripts/scan-backfill/lib"
import type { MorphoMarketState, MorphoPositionState } from "../live/morpho"
import type { DailyPoint } from "./aggregates"
import { isClosingRun, lastClosingMinute, supplyTokens } from "./closing"
import { dayStart } from "./transform"

// The daily-history backfill: its reads turned into points as the closing
// writer computes them, its closing block, and its SQL applied to SQLite
// (node:sqlite, the engine D1 runs) after the scan migrations, as
// `wrangler d1 execute --file` would.

const out = mkdtempSync(path.join(tmpdir(), "daily-history-"))
afterAll(() => rmSync(out, { recursive: true, force: true }))

const zero = "0x0000000000000000000000000000000000000000" as Address
const marketA = `0x${"a".repeat(64)}` as Hex
const marketB = `0x${"b".repeat(64)}` as Hex

function market(marketId: Hex, borrow: bigint): MorphoMarketState {
  return {
    marketId,
    loanToken: zero,
    collateralToken: zero,
    oracle: zero,
    irm: zero,
    lltv: 0n,
    totalSupplyAssets: borrow * 2n,
    totalSupplyShares: 0n,
    totalBorrowAssets: borrow,
    totalBorrowShares: 0n,
    lastUpdate: 1n,
    fee: 0n,
    borrowRate: null,
    oraclePrice: null,
  }
}

function trove(principal: bigint, interest: bigint) {
  return {
    owner: zero,
    status: "active" as const,
    coll: 5n,
    principal,
    interest,
    interestRate: 100,
  }
}

function position(
  marketId: Hex,
  account: string,
  collateral: bigint,
): MorphoPositionState {
  return {
    marketId,
    account: account as Address,
    supplyShares: 0n,
    borrowShares: 1n,
    collateral,
  }
}

const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

function fakeReader(input: {
  vebtc: bigint | null
  troves: ReturnType<typeof trove>[]
  markets: MorphoMarketState[]
  positions?: MorphoPositionState[]
  /** totalSupply() per token; absent tokens read as null (a revert). */
  supplies?: Record<string, bigint>
}): CloseReader & { blocks: bigint[]; accounts: string[][] } {
  const blocks: bigint[] = []
  const seenAccounts: string[][] = []
  return {
    blocks,
    accounts: seenAccounts,
    async escrowSupply(block) {
      blocks.push(block)
      return { vebtc: input.vebtc, vemezo: 7n }
    },
    async troves(block) {
      blocks.push(block)
      return {
        troves: input.troves,
        stabilityPool: { totalMusdDeposits: 11n, totalCollateral: 1n },
        musdPrice: null,
      }
    },
    async morpho(_ids, accounts, block) {
      seenAccounts.push([...accounts])
      blocks.push(block)
      return { markets: input.markets, positions: input.positions ?? [] }
    },
    async totalSupply(token, block) {
      blocks.push(BigInt(block ?? -1))
      return input.supplies?.[token] ?? null
    },
  }
}

function sorted(points: DailyPoint[]) {
  return points
    .map((point) => `${point.metric}|${point.dimension}=${point.value}`)
    .sort()
}

describe("readClosePoints", () => {
  it("computes every close as the closing writer does, at one block", async () => {
    const accountA = "0x1111111111111111111111111111111111111111"
    const accountB = "0x2222222222222222222222222222222222222222"
    const reader = fakeReader({
      vebtc: 804_300_384_691_486_817_856n,
      troves: [trove(10n ** 21n, 3n), trove(2n * 10n ** 21n, 4n)],
      markets: [market(marketA, 72_720_423_279n), market(marketB, 0n)],
      positions: [
        position(marketA, accountA, 10n ** 18n),
        position(marketA, accountB, 35n * 10n ** 16n),
        position(marketB, accountA, 0n),
      ],
      supplies: { [musd]: 9_000n },
    })
    const points = await readClosePoints(
      reader,
      [marketA, marketB],
      [accountA, accountB],
      13_142_708,
    )
    expect(sorted(points)).toEqual([
      "escrow.supply|vebtc=804300384691486817856",
      "escrow.supply|vemezo=7",
      `morpho.total_borrow|${marketA}=72720423279`,
      `morpho.total_borrow|${marketB}=0`,
      `morpho.total_collateral|${marketA}=1350000000000000000`,
      `morpho.total_collateral|${marketB}=0`,
      `morpho.total_supply|${marketA}=145440846558`,
      `morpho.total_supply|${marketB}=0`,
      "musd.stability_pool|=11",
      "musd.trove_coll|=10",
      "musd.trove_debt|=3000000000000000000007",
      `token.total_supply|${musd}=9000`,
    ])
    expect(reader.accounts).toEqual([[accountA, accountB]])
    expect(new Set(reader.blocks)).toEqual(new Set([13_142_708n]))
  })

  it("leaves out what the live writer leaves out", async () => {
    // A failed escrow read and no troves: no escrow row, no trove totals
    // (the writer writes them only when a trove exists), no collateral
    // without positions, no supply for a token whose read reverts.
    const points = await readClosePoints(
      fakeReader({ vebtc: null, troves: [], markets: [] }),
      [],
      [],
      1,
    )
    expect(sorted(points)).toEqual([
      "escrow.supply|vemezo=7",
      "musd.stability_pool|=11",
    ])
  })
})

describe("Morpho accounts and token supplies", () => {
  it("reads the accounts first seen in a window starting at or before the block", () => {
    const firstSeen = { "0xb": 200, "0xa": 100, "0xc": 300 }
    expect(accountsAt(firstSeen, 99)).toEqual([])
    expect(accountsAt(firstSeen, 200)).toEqual(["0xa", "0xb"])
    expect(accountsAt(firstSeen, 10_000)).toEqual(["0xa", "0xb", "0xc"])
  })

  it("treats a supply that vanished after an earlier day as a failed read", () => {
    const earlier = [
      { [`token.total_supply|${musd}`]: "5", "musd.trove_debt|": "1" },
    ]
    const withMusd: DailyPoint[] = [
      { metric: "token.total_supply", dimension: musd, value: 6n },
    ]
    expect(missingSupplies(earlier, withMusd)).toEqual([])
    expect(missingSupplies(earlier, [])).toEqual([musd])
    // Not deployed yet: no earlier supply, nothing missing.
    expect(missingSupplies([], [])).toEqual([])
  })

  it("covers the closing writer's eight tokens", () => {
    expect(supplyTokens).toHaveLength(8)
    expect(supplyTokens).toContain(musd)
  })
})

describe("dry-run summary and comparison", () => {
  const days = {
    "2026-11-09": { "musd.trove_coll|": "5", "token.total_supply|0xm": "1" },
    "2026-11-10": { "musd.trove_coll|": "6", "token.total_supply|0xm": "2" },
    "2026-11-11": { "musd.trove_coll|": "7" },
  }

  it("prints rows, range and first and last value per series", () => {
    expect(summarizeDays(days)).toEqual([
      {
        series: "musd.trove_coll|",
        rows: 3,
        first: { day: "2026-11-09", value: "5" },
        last: { day: "2026-11-11", value: "7" },
      },
      {
        series: "token.total_supply|0xm",
        rows: 2,
        first: { day: "2026-11-09", value: "1" },
        last: { day: "2026-11-10", value: "2" },
      },
    ])
  })

  it("counts absent days as inserts and checks overlapping days", () => {
    const comparison = compareWithPresent(days, [
      {
        series: "musd.trove_coll|",
        day: "2026-11-11",
        value: "7",
        source: "live",
      },
      {
        series: "musd.trove_coll|",
        day: "2026-11-12",
        value: "8",
        source: "live",
      },
      {
        series: "token.total_supply|0xm",
        day: "2026-11-10",
        value: "3",
        source: "live",
      },
    ])
    expect(comparison).toEqual([
      {
        series: "musd.trove_coll|",
        present: 2,
        presentFirst: "2026-11-11",
        presentLast: "2026-11-12",
        wouldInsert: 2,
        overlap: 1,
        equal: 1,
        differences: [],
      },
      {
        series: "token.total_supply|0xm",
        present: 1,
        presentFirst: "2026-11-10",
        presentLast: "2026-11-10",
        wouldInsert: 1,
        overlap: 1,
        equal: 0,
        differences: [
          { day: "2026-11-10", backfill: "2", present: "3", source: "live" },
        ],
      },
    ])
  })
})

describe("closing block", () => {
  it("is the last block at or before the 23:55 closing run", () => {
    const day = "2026-11-10"
    const bound = closeBound(day)
    expect(bound - 1).toBe(dayStart(day) + 23 * 3_600 + 55 * 60)
    // The writer's last closing run of the day starts at that minute.
    expect(isClosingRun(bound - 1)).toBe(true)
    expect(isClosingRun(bound - 1 - 5 * 60)).toBe(false)
    expect(lastClosingMinute).toBe(1_435)
  })

  it("finds the highest block below the bound", async () => {
    // Blocks every 3 s from t=1,000; block 0 at t=1,000.
    const timestamp = async (block: number) => 1_000 + block * 3
    const bound = 1_000 + 500 * 3 + 1
    const block = await lastBlockBefore(timestamp, bound, {
      low: 1,
      lowTs: 1_003,
      high: 2_000,
      highTs: 7_000,
    })
    expect(block).toBe(500)
  })

  it("reads configured and discovered markets once each", () => {
    const ids = marketIdsOf([
      "0x29C2A844B71BB5DB40CA26E8880552DCD40517AA10E945B15EF616C46D5D6707",
      marketA,
    ])
    expect(ids).toEqual([...new Set(ids)].sort())
    expect(ids).toContain(marketA)
    expect(ids).toHaveLength(3)
  })
})

describe("historyStatements applied to SQLite", () => {
  function migrated(): DatabaseSync {
    const db = new DatabaseSync(":memory:")
    const dir = path.resolve(import.meta.dirname, "../../scan-migrations")
    for (const file of readdirSync(dir).sort()) {
      db.exec(readFileSync(path.join(dir, file), "utf8"))
    }
    return db
  }

  const rowSchema = z.object({
    metric: z.string(),
    dimension: z.string(),
    day: z.string(),
    value: z.string(),
    source: z.string(),
    partial: z.number(),
  })
  function rows(db: DatabaseSync) {
    return z
      .array(rowSchema)
      .parse(
        db
          .prepare(
            "SELECT metric, dimension, day, value, source, partial FROM daily ORDER BY metric, dimension, day",
          )
          .all(),
      )
  }
  function dataVersion(db: DatabaseSync): number {
    return z
      .object({ data_version: z.number() })
      .parse(db.prepare("SELECT data_version FROM scan_status").get())
      .data_version
  }

  const byDay = new Map<string, DailyPoint[]>([
    [
      "2026-11-09",
      [
        { metric: "escrow.supply", dimension: "vebtc", value: 5n },
        { metric: "musd.trove_debt", dimension: "", value: 9n },
      ],
    ],
    [
      "2026-11-10",
      [
        { metric: "escrow.supply", dimension: "vebtc", value: 6n },
        { metric: "musd.trove_debt", dimension: "", value: 10n },
      ],
    ],
  ])

  it("inserts absent days only, and applying twice changes nothing", () => {
    const db = migrated()
    // A day the live writer already has, and one another backfill has.
    db.exec(`INSERT INTO daily (metric, dimension, day, value, source, partial, updated_at)
      VALUES ('escrow.supply', 'vebtc', '2026-11-10', '600', 'live', 1, 1),
             ('musd.trove_debt', '', '2026-11-09', '900', 'backfill:other', 0, 1)`)
    const files = writeSqlFiles(
      path.join(out, "apply"),
      "daily-history",
      historyStatements(byDay, 2_000),
      Number.MAX_SAFE_INTEGER,
    )
    expect(files).toHaveLength(1)
    const sql = readFileSync(files[0] ?? "", "utf8")
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|UPDATE daily|DO UPDATE/i)
    expect(sql).toContain("ON CONFLICT (metric, dimension, day) DO NOTHING")

    const before = dataVersion(db)
    db.exec(sql)
    expect(dataVersion(db)).toBe(before + 1)
    const applied = rows(db)
    expect(applied).toEqual([
      {
        metric: "escrow.supply",
        dimension: "vebtc",
        day: "2026-11-09",
        value: "5",
        source: historySource,
        partial: 0,
      },
      {
        metric: "escrow.supply",
        dimension: "vebtc",
        day: "2026-11-10",
        value: "600",
        source: "live",
        partial: 1,
      },
      {
        metric: "musd.trove_debt",
        dimension: "",
        day: "2026-11-09",
        value: "900",
        source: "backfill:other",
        partial: 0,
      },
      {
        metric: "musd.trove_debt",
        dimension: "",
        day: "2026-11-10",
        value: "10",
        source: historySource,
        partial: 0,
      },
    ])

    db.exec(sql)
    expect(rows(db)).toEqual(applied)
    expect(dataVersion(db)).toBe(before + 1)
  })

  it("leaves data_version alone when every day is already there", () => {
    const db = migrated()
    const sql = historyStatements(byDay, 2_000)
    const files = writeSqlFiles(
      path.join(out, "present"),
      "daily-history",
      sql,
      Number.MAX_SAFE_INTEGER,
    )
    const text = readFileSync(files[0] ?? "", "utf8")
    db.exec(text)
    const version = dataVersion(db)
    db.exec(text)
    expect(dataVersion(db)).toBe(version)
  })
})
