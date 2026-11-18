import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { MarketRead } from "@matchbox/api/market/reader"
import { buildSnapshot } from "@matchbox/api/market/snapshot"
import {
  createD1MarketStore,
  type MarketDatabase,
  type MarketStatement,
} from "@matchbox/api/market/store"
import { EPOCH_SECONDS } from "@matchbox/domain"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  epochCloseBound,
  epochStarts,
  epochStatements,
  gaugeFingerprint,
} from "../../scripts/scan-backfill/gauge-rows"
import { inlineStatementsOf } from "../../scripts/scan-backfill/lib"
import {
  missingPrices,
  priceCloseBound,
  priceHistorySource,
  priceRowsOf,
} from "../../scripts/scan-backfill/price-rows"
import {
  btcUsdAt,
  type ContractReader,
  mezoUsdAt,
} from "../../scripts/scan-backfill/prices-at"
import { isClosingRun, isPriceCloseMinute, priceDailySpec } from "./closing"
import { servedBatch, upsertStatements } from "./statements"
import { dayStart } from "./transform"

// The price and gauge-epoch backfills: their closing blocks, their reads
// as the live readers make them, and their SQL applied to SQLite (the
// engine D1 runs) after the real migrations.

describe("price closes", () => {
  it("closes a day with the head at 00:00:00, the live job's last write", () => {
    const bound = priceCloseBound("2026-11-10")
    expect(bound - 1).toBe(dayStart("2026-11-11"))
    expect(isPriceCloseMinute(bound - 1)).toBe(true)
  })

  it("retries a source that answered before, not one that never has", () => {
    const earlier = [{ btc: "70000" }, { btc: "71000", mezo: "0.01" }]
    expect(missingPrices(earlier, { btc: "72000", mezo: "0.02" })).toEqual([])
    expect(missingPrices(earlier, { btc: "72000" })).toEqual(["mezo"])
    expect(missingPrices([{ btc: "1" }], { btc: "2" })).toEqual([])
  })
})

/** A reader that answers by function name, or throws. */
function fakeContracts(
  answers: Record<string, unknown>,
): ContractReader & { blocks: bigint[] } {
  const blocks: bigint[] = []
  return {
    blocks,
    async readContract({ functionName, address, blockNumber }) {
      blocks.push(blockNumber)
      const key = `${address.toLowerCase()}.${functionName}`
      const answer = answers[key] ?? answers[functionName]
      if (answer instanceof Error) throw answer
      if (answer === undefined) throw new Error(`no answer for ${key}`)
      return answer
    },
  }
}

describe("prices at a block", () => {
  const oracleTs = 1_794_441_000

  it("reads BTC as the live reader formats it, at the given block", async () => {
    const mezo = fakeContracts({
      latestRoundData: [1n, 7_392_852_896_000n, 0n, BigInt(oracleTs), 1n],
      decimals: 8,
    })
    const result = await btcUsdAt(mezo, 13_165_343n, oracleTs + 60)
    expect(result).toEqual({
      price: { usd: "73928.52896", source: "skip-oracle" },
      reason: null,
      rejected: false,
    })
    expect(new Set(mezo.blocks)).toEqual(new Set([13_165_343n]))
  })

  it("refuses a round stale at the block's time, and keeps read errors apart", async () => {
    const stale = await btcUsdAt(
      fakeContracts({
        latestRoundData: [1n, 1n, 0n, BigInt(oracleTs), 1n],
        decimals: 8,
      }),
      1n,
      oracleTs + 3_601,
    )
    expect(stale.price).toBeNull()
    expect(stale.rejected).toBe(true)
    const failed = await btcUsdAt(
      fakeContracts({ latestRoundData: new Error("timeout"), decimals: 8 }),
      1n,
      oracleTs,
    )
    expect(failed).toEqual({ price: null, reason: "timeout", rejected: false })
  })

  it("prices MEZO from the pool in either token order", async () => {
    const mezoToken = "0x8e4cbbcc33db6c0a18561fde1f6ba35906d4848b"
    const musdToken = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
    // sqrtPriceX96 for 0.004 MUSD per MEZO with MEZO as token0.
    const sqrt = 5_010_828_967_500_958_623_334_400_000n
    const asToken0 = await mezoUsdAt(
      fakeContracts({
        slot0: [sqrt, 0, 0, 0, 0, true],
        liquidity: 10n,
        token0: mezoToken,
        token1: musdToken,
        decimals: 18,
      }),
      5n,
    )
    expect(asToken0.price?.source).toBe("aerodrome-cl")
    expect(Number(asToken0.price?.usd)).toBeCloseTo(0.004, 9)
    const empty = await mezoUsdAt(
      fakeContracts({
        slot0: [sqrt, 0, 0, 0, 0, true],
        liquidity: 0n,
        token0: mezoToken,
        token1: musdToken,
        decimals: 18,
      }),
      5n,
    )
    expect(empty).toMatchObject({ price: null, rejected: true })
  })
})

describe("price SQL applied to SQLite", () => {
  it("inserts absent days only and keeps the live close", () => {
    const db = new DatabaseSync(":memory:")
    const dir = path.resolve(import.meta.dirname, "../../scan-migrations")
    for (const file of readdirSync(dir).sort()) {
      db.exec(readFileSync(path.join(dir, file), "utf8"))
    }
    db.exec(`INSERT INTO price_daily (token, day, price, source, updated_at)
      VALUES ('btc', '2026-11-11', '73928.52896', 'mezo-oracle', 1)`)
    const rows = priceRowsOf(
      {
        "2026-11-10": { btc: "75000.1", mezo: "0.004" },
        "2026-11-11": { btc: "1" },
      },
      priceHistorySource,
      2,
    )
    const sql = inlineStatementsOf(
      servedBatch(upsertStatements({ ...priceDailySpec, update: [] }, rows)),
    )
    db.exec(sql)
    db.exec(sql)
    expect(
      db
        .prepare(
          "SELECT token, day, price, source FROM price_daily ORDER BY day, token",
        )
        .all(),
    ).toEqual([
      {
        token: "btc",
        day: "2026-11-10",
        price: "75000.1",
        source: priceHistorySource,
      },
      {
        token: "mezo",
        day: "2026-11-10",
        price: "0.004",
        source: priceHistorySource,
      },
      {
        token: "btc",
        day: "2026-11-11",
        price: "73928.52896",
        source: "mezo-oracle",
      },
    ])
  })
})

/** MARKET_DB on node:sqlite with the API's migrations, for the D1 store. */
function marketDatabase(): { db: DatabaseSync; market: MarketDatabase } {
  const db = new DatabaseSync(":memory:")
  const dir = path.resolve(import.meta.dirname, "../../../api/migrations")
  for (const file of readdirSync(dir).sort()) {
    db.exec(readFileSync(path.join(dir, file), "utf8"))
  }
  function statement(sql: string, values: SQLInputValue[]): MarketStatement {
    return {
      bind: (...next) => statement(sql, next as SQLInputValue[]),
      async first() {
        const row = db.prepare(sql).get(...values)
        return row === undefined ? null : { ...row }
      },
      async all() {
        return {
          results: db
            .prepare(sql)
            .all(...values)
            .map((row) => ({ ...row })),
        }
      },
      async run() {
        return db.prepare(sql).run(...values)
      },
    }
  }
  return {
    db,
    market: {
      prepare: (sql) => statement(sql, []),
      async batch(statements) {
        for (const item of statements) await item.run()
      },
    },
  }
}

const gaugeA = "0x00000000000000000000000000000000000000aa"
const gaugeB = "0x00000000000000000000000000000000000000bb"

function readAt(epochStart: number, weight: bigint): MarketRead {
  return {
    network: "mezo",
    blockNumber: 1_000n + BigInt(epochStart % 1_000),
    epochStarts: [epochStart],
    totalWeights: {
      boost: weight,
      pools: 0n,
      validators: 0n,
      "third-party": 0n,
    },
    gauges: [
      {
        gaugeAddress: gaugeA,
        isAlive: true,
        weight,
        bribeContract: null,
        link: {
          voter: "boost",
          vebtcTokenId: "7",
          beneficiary: null,
          boost: null,
        },
        rewards: [
          {
            kind: "bribe",
            contract: "0x00000000000000000000000000000000000000cc",
            token: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
            amounts: [5n * 10n ** 18n],
          },
        ],
      },
      {
        gaugeAddress: gaugeB,
        isAlive: true,
        weight: 0n,
        bribeContract: null,
        link: { voter: "third-party" },
        rewards: [],
      },
    ],
    tokens: new Map([
      [
        "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
        { symbol: "MUSD", decimals: 18 },
      ],
    ]),
  }
}

const prices = {
  btcUsd: { usd: "70000", source: "skip-oracle" as const },
  mezoUsd: null,
}

describe("gauge epochs", () => {
  const live = 1_793_836_800 // 5 Nov 2026, a Thursday epoch start

  it("reads a finished epoch at its last 23:55 market run", () => {
    const bound = epochCloseBound(live)
    expect(bound - 1).toBe(live + EPOCH_SECONDS - 300)
    expect(isClosingRun(bound - 1)).toBe(true)
    expect(epochStarts(live - 2 * EPOCH_SECONDS, live)).toEqual([
      live - 2 * EPOCH_SECONDS,
      live - EPOCH_SECONDS,
      live,
    ])
  })

  it("fingerprints weight and rewards, not prices", () => {
    expect(
      gaugeFingerprint({
        weight: "3",
        rewards: [
          { token: "0xb", amount: "2" },
          { token: "0xa", amount: "1" },
        ],
      }),
    ).toBe("weight=3 rewards=[0xa:1,0xb:2]")
  })

  it("fills past epochs for listGaugeHistory and never touches a live epoch", async () => {
    const { db, market } = marketDatabase()
    const store = createD1MarketStore(market)
    // The live cron's epoch, saved by the store itself.
    await store.saveSnapshot(
      buildSnapshot(
        readAt(live, 900n),
        prices,
        new Date("2026-11-11T23:55:17Z"),
      ),
    )
    const before = db
      .prepare("SELECT * FROM market_gauges WHERE epoch_start = ?")
      .all(live)
    // Three past epochs, and the live one read again with other values.
    const statements = []
    for (const [start, weight] of [
      [live - 3 * EPOCH_SECONDS, 100n],
      [live - 2 * EPOCH_SECONDS, 200n],
      [live - EPOCH_SECONDS, 300n],
      [live, 1n],
    ] as const) {
      const snapshot = buildSnapshot(
        readAt(start, weight),
        prices,
        new Date((start + EPOCH_SECONDS - 300) * 1000),
      )
      const epoch = snapshot.epochs[0]
      if (epoch === undefined) throw new Error("no epoch")
      statements.push(...(await epochStatements(epoch)))
    }
    const sql = inlineStatementsOf(statements)
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bUPDATE\b/i)
    db.exec(sql)
    db.exec(sql)

    const history = await store.listGaugeHistory("mezo", gaugeA, live, 12)
    expect(
      history.map((entry) => [entry.epoch.epochStart, entry.incentives.weight]),
    ).toEqual([
      [live, "900"],
      [live - EPOCH_SECONDS, "300"],
      [live - 2 * EPOCH_SECONDS, "200"],
      [live - 3 * EPOCH_SECONDS, "100"],
    ])
    expect(history[1]?.incentives.rewards[0]?.amount).toBe(
      "5000000000000000000",
    )
    expect(
      db.prepare("SELECT * FROM market_gauges WHERE epoch_start = ?").all(live),
    ).toEqual(before)
    // The rows are the store's own: an unchanged re-save writes nothing.
    const resave = buildSnapshot(
      readAt(live - EPOCH_SECONDS, 300n),
      prices,
      new Date((live - 300) * 1000),
    )
    const summary = await store.saveSnapshot(resave)
    expect(summary).toMatchObject({ written: 0, unchanged: 2 })
    expect(
      z
        .object({ n: z.number() })
        .parse(db.prepare("SELECT COUNT(*) AS n FROM market_gauges").get()).n,
    ).toBe(8)
  })
})
