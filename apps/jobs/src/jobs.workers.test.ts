import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  pricesKvKey,
  readPricesFromKv,
} from "@matchbox/api/read-models/prices-kv"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { resetStorage } from "../test/reset"
import {
  type DiscoveredMarket,
  type MorphoRead,
  marketFromLog,
} from "./live/morpho"
import {
  type LiveChainReader,
  readEscrowSupply,
  runLiveSnapshot,
} from "./live/snapshot"
import { type TroveRead, troveHeader } from "./live/troves"
import { runPriceJob } from "./prices"

const logger = createLogger({ level: "error" })
// An even minute, so the price job publishes to KV.
const now = 1_794_138_720

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await resetStorage()
})

describe("price job", () => {
  it("samples, computes the 24h change and publishes to KV", async () => {
    await env.READ_DB.prepare(
      `INSERT INTO price_samples (token, sampled_at, usd, source)
       VALUES ('btc', ?1, '103841', 'mezo-oracle')`,
    )
      .bind(now - 86_400)
      .run()
    const prices = await runPriceJob({
      db: env.READ_DB,
      kv: env.PRICES,
      readPrices: async () => ({
        btcUsd: { usd: "105710", source: "skip-oracle" },
        mezoUsd: { usd: "0.184", source: "aerodrome-cl" },
      }),
      nowSeconds: now,
      logger,
    })
    expect(prices).toEqual({
      btc: {
        usd: "105710",
        change24h: "1.80",
        source: "mezo-oracle",
        updatedAt: now,
      },
      mezo: {
        usd: "0.184",
        change24h: null,
        source: "aerodrome-cl",
        updatedAt: now,
      },
    })
    expect(await readPricesFromKv(env.PRICES)).toEqual(prices)
    const samples = await env.READ_DB.prepare(
      "SELECT count(*) AS n FROM price_samples",
    ).first<{ n: number }>()
    expect(samples?.n).toBe(3)
  })

  it("names CoinGecko and keeps a reused reading's time", async () => {
    const previous = {
      btc: null,
      mezo: {
        usd: "0.00457",
        change24h: null,
        source: "coingecko" as const,
        updatedAt: now - 60,
      },
    }
    await env.PRICES.put(pricesKvKey, JSON.stringify(previous))
    const seen: unknown[] = []
    const prices = await runPriceJob({
      db: env.READ_DB,
      kv: env.PRICES,
      readPrices: async (last) => {
        seen.push(last)
        return {
          btcUsd: null,
          mezoUsd: { usd: "0.00457", source: "coingecko" },
          mezoReadAt: now - 60,
        }
      },
      nowSeconds: now,
      logger,
    })
    expect(seen).toEqual([previous])
    expect(prices.mezo).toEqual({ ...previous.mezo, updatedAt: now - 60 })
    const sample = await env.READ_DB.prepare(
      "SELECT source FROM price_samples WHERE token = 'mezo'",
    ).first<{ source: string }>()
    expect(sample?.source).toBe("coingecko")
  })

  it("carries a recent price over a failed read, then drops it", async () => {
    await env.PRICES.put(
      pricesKvKey,
      JSON.stringify({
        btc: {
          usd: "105000",
          change24h: null,
          source: "mezo-oracle",
          updatedAt: now - 120,
        },
        mezo: null,
      }),
    )
    const missing = async () => ({ btcUsd: null, mezoUsd: null })
    const carried = await runPriceJob({
      db: env.READ_DB,
      kv: env.PRICES,
      readPrices: missing,
      nowSeconds: now,
      logger,
    })
    expect(carried.btc?.usd).toBe("105000")
    const dropped = await runPriceJob({
      db: env.READ_DB,
      kv: env.PRICES,
      readPrices: missing,
      nowSeconds: now + 1_200,
      logger,
    })
    expect(dropped.btc).toBeNull()
  })
})

const marketId =
  "0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db"
const borrower = "0xC853E78877c758cC43ad152726Cb593f03D23030"
const configuredBtcMusd =
  "0x29c2a844b71bb5db40ca26e8880552dcd40517aa10e945b15ef616c46d5d6707"
const troveOwner = "0x593c427d8C7bf5C555Ed41cd7CB7cCe8C9F15bB5"

function fakeChain(state: {
  head: bigint
  morpho: MorphoRead
  troves: TroveRead
  supply?: { vebtc: bigint | null; vemezo: bigint | null }
  /** CreateMarket logs the account scan finds. */
  created?: DiscoveredMarket[]
  /** CreateMarket logs on chain, for the backfill (by block). */
  history?: DiscoveredMarket[]
  decimals?: Record<string, number | null>
}): LiveChainReader & {
  scans: bigint[]
  backfills: [bigint, bigint][]
  marketReads: string[][]
} {
  const scans: bigint[] = []
  const backfills: [bigint, bigint][] = []
  const marketReads: string[][] = []
  return {
    scans,
    backfills,
    marketReads,
    async head() {
      return state.head
    },
    async discoverAccounts(fromBlock, toBlock) {
      scans.push(fromBlock)
      return {
        accounts: new Set([borrower.toLowerCase()]),
        markets: state.created ?? [],
        scannedTo: toBlock,
      }
    },
    async discoverMarkets(fromBlock, toBlock, windows) {
      // Ten thousand blocks a window, like the real scan.
      const last = fromBlock + BigInt(windows) * 10_000n - 1n
      const scannedTo = last < toBlock ? last : toBlock
      backfills.push([fromBlock, scannedTo])
      return {
        markets: (state.history ?? []).filter(
          (market) =>
            market.createdBlock >= fromBlock &&
            market.createdBlock <= scannedTo,
        ),
        scannedTo,
      }
    },
    async tokenDecimals(tokens) {
      return new Map(
        tokens.map((token) => [
          token.toLowerCase(),
          state.decimals !== undefined && token.toLowerCase() in state.decimals
            ? (state.decimals[token.toLowerCase()] ?? null)
            : 18,
        ]),
      )
    },
    async morpho(marketIds) {
      marketReads.push([...marketIds])
      return state.morpho
    },
    async troves() {
      return state.troves
    },
    async escrowSupply() {
      return state.supply ?? { vebtc: null, vemezo: null }
    },
  }
}

describe("live snapshot", () => {
  const morpho: MorphoRead = {
    markets: [
      {
        marketId,
        loanToken: "0x04671C72Aab5AC02A03c1098314b1BB6B560c197",
        collateralToken: "0x7b7C000000000000000000000000000000000000",
        oracle: "0xeA0597D3d44FF2ea1E4c35501e153f4C025e48d1",
        irm: "0x3760Ebc636F912a4dB9540fdA4Dec09C25C6C1e7",
        lltv: 860_000_000_000_000_000n,
        totalSupplyAssets: 77_629_070_000n,
        totalSupplyShares: 77_000_000_000_000_000n,
        totalBorrowAssets: 62_710_840_000n,
        totalBorrowShares: 62_000_000_000_000_000n,
        lastUpdate: 1_794_000_000n,
        fee: 0n,
        borrowRate: 645_000_000n,
        oraclePrice: 75_328_800_000_000_000_000_000_000n,
      },
    ],
    positions: [
      {
        marketId,
        account: borrower,
        supplyShares: 0n,
        borrowShares: 60_000_000_000_000_000n,
        collateral: 1_303_962_000_000_000_000n,
      },
    ],
  }
  const troves: TroveRead = {
    troves: [
      {
        owner: troveOwner,
        status: "active",
        coll: 16_589_214_000_000_000_000n,
        principal: 14_486_900_000_000_000_000_000n,
        interest: 8_030_000_000_000_000_000n,
        interestRate: 100,
      },
    ],
    stabilityPool: {
      totalMusdDeposits: 14_170_000n * 10n ** 18n,
      totalCollateral: 0n,
    },
    musdPrice: 74_665_554_160_000_000_000_000n,
  }

  it("writes every other row when migration 0005 is not applied yet", async () => {
    // A jobs deploy before READ_DB migration 0005: no price columns.
    const columns = [
      "musd_btc_price_raw TEXT",
      "musd_btc_price_scale INTEGER",
      "musd_btc_price_block INTEGER",
    ]
    for (const column of columns) {
      await env.READ_DB.prepare(
        `ALTER TABLE stability_pool DROP COLUMN ${column.split(" ")[0]}`,
      ).run()
    }
    try {
      const summary = await runLiveSnapshot({
        db: env.READ_DB,
        chain: fakeChain({ head: 13_124_941n, morpho, troves }),
        logWindowsPerRun: 5,
        nowSeconds: now,
        logger,
      })
      expect(summary).toMatchObject({ troves: 1, priceStored: false })
      expect(
        await env.READ_DB.prepare(
          "SELECT owner FROM troves WHERE network = 'mezo'",
        ).all(),
      ).toMatchObject({ results: [{ owner: troveOwner.toLowerCase() }] })
      expect(
        await env.READ_DB.prepare(
          "SELECT total_musd_deposits_raw, block FROM stability_pool",
        ).first(),
      ).toEqual({
        total_musd_deposits_raw: (14_170_000n * 10n ** 18n).toString(),
        block: 13_124_941,
      })
      expect(
        await env.READ_DB.prepare(
          "SELECT count(*) AS n FROM morpho_markets",
        ).first(),
      ).toEqual({ n: 1 })
    } finally {
      for (const column of columns) {
        await env.READ_DB.prepare(
          `ALTER TABLE stability_pool ADD COLUMN ${column}`,
        ).run()
      }
    }
  })

  it("stores MUSD's own BTC price with its scale and the block of the last read", async () => {
    const price = 74_665_554_160_000_000_000_000n
    const run = (head: bigint, musdPrice: bigint | null) =>
      runLiveSnapshot({
        db: env.READ_DB,
        chain: fakeChain({ head, morpho, troves: { ...troves, musdPrice } }),
        logWindowsPerRun: 5,
        nowSeconds: now,
        logger,
      })
    const stored = () =>
      env.READ_DB.prepare(
        `SELECT musd_btc_price_raw, musd_btc_price_scale, musd_btc_price_block
         FROM stability_pool WHERE network = 'mezo'`,
      ).first()
    await run(13_124_941n, price)
    expect(await stored()).toEqual({
      musd_btc_price_raw: "74665554160000000000000",
      musd_btc_price_scale: 18,
      musd_btc_price_block: 13_124_941,
    })
    // The same price read later: the block moves to the latest read, so a
    // reader can tell a current price (block >= the pool's and troves'
    // blocks) from one a failed write left behind.
    await run(13_125_000n, price)
    expect(await stored()).toMatchObject({
      musd_btc_price_raw: "74665554160000000000000",
      musd_btc_price_block: 13_125_000,
    })
    await run(13_125_100n, price + 1n)
    expect(await stored()).toMatchObject({
      musd_btc_price_raw: "74665554160000000000001",
      musd_btc_price_block: 13_125_100,
    })
    // fetchPrice() reverted (stale oracle): no protocol price at that block.
    await run(13_125_200n, null)
    expect(await stored()).toEqual({
      musd_btc_price_raw: null,
      musd_btc_price_scale: null,
      musd_btc_price_block: 13_125_200,
    })
  })

  it("lets the price revert but never the pool reads", () => {
    const ok = (result: bigint) => ({ status: "success" as const, result })
    const failed = { status: "failure" as const, error: new Error("stale") }
    expect(troveHeader([ok(3n), ok(10n), ok(0n), failed])).toEqual({
      count: 3n,
      deposits: 10n,
      collateral: 0n,
      musdPrice: null,
    })
    expect(troveHeader([ok(3n), ok(10n), ok(0n), ok(7n)]).musdPrice).toBe(7n)
    expect(() => troveHeader([ok(3n), failed, ok(0n), ok(7n)])).toThrow(
      "getTotalMUSDDeposits failed: stale",
    )
  })

  describe("Morpho market discovery", () => {
    const musdBtc: DiscoveredMarket = {
      marketId:
        "0x4bff245ddc101cd43e365aa1faff97351ab36a225e43d9a76aab82ff763030b8",
      loanToken: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
      collateralToken: "0x7b7C000000000000000000000000000000000000",
      oracle: "0x0000000000000000000000000000000000000a11",
      irm: "0x3760Ebc636F912a4dB9540fdA4Dec09C25C6C1e7",
      lltv: 860_000_000_000_000_000n,
      createdBlock: 13_118_789n,
    }
    // A market whose loan token answers no decimals().
    const odd: DiscoveredMarket = {
      ...musdBtc,
      marketId: `0x${"ab".repeat(32)}`,
      loanToken: "0x00000000000000000000000000000000000000Ee",
      createdBlock: 10_000_000n,
    }
    const known = () =>
      env.READ_DB.prepare(
        `SELECT market_id, loan_decimals, collateral_decimals, created_block
         FROM morpho_known_markets ORDER BY created_block`,
      ).all()
    const cursor = (job: string) =>
      env.READ_DB.prepare("SELECT value FROM job_cursors WHERE job = ?1")
        .bind(job)
        .first()
    async function scannedTo(block: number) {
      await env.READ_DB.prepare(
        `INSERT INTO job_cursors (job, network, value, updated_at)
         VALUES ('morpho-logs', 'mezo', ?1, 0)`,
      )
        .bind(String(block))
        .run()
    }

    it("backfills markets created before the scan asked for CreateMarket, and reads them", async () => {
      // Deployed with the account scan already near the head.
      await scannedTo(13_120_000)
      const chain = fakeChain({
        head: 13_120_100n,
        morpho,
        troves,
        history: [odd, musdBtc],
        decimals: { [odd.loanToken.toLowerCase()]: null },
      })
      const run = () =>
        runLiveSnapshot({
          db: env.READ_DB,
          chain,
          logWindowsPerRun: 200,
          nowSeconds: now,
          logger,
        })
      // 200 windows of 10,000 blocks from the deploy block: the first
      // market only.
      expect(await run()).toMatchObject({ marketsDiscovered: 1 })
      expect(chain.backfills[0]).toEqual([9_206_917n, 11_206_916n])
      expect(await cursor("morpho-markets-backfill")).toEqual({
        value: "11206916",
      })
      // An unknown token's decimals are stored as NULL, never 18.
      expect((await known()).results).toEqual([
        {
          market_id: odd.marketId,
          loan_decimals: null,
          collateral_decimals: 18,
          created_block: 10_000_000,
        },
      ])
      await run()
      expect(await cursor("morpho-markets-backfill")).toEqual({ value: "done" })
      expect((await known()).results).toHaveLength(2)
      // The configured markets and both discovered ones, read every run.
      expect(chain.marketReads.at(-1)).toEqual(
        [marketId, configuredBtcMusd, odd.marketId, musdBtc.marketId].sort(),
      )
      // Done: the backfill never scans again.
      await run()
      expect(chain.backfills).toHaveLength(2)
    })

    it("parses a decoded CreateMarket log and ignores the other events", () => {
      const args = {
        id: musdBtc.marketId.toUpperCase().replace("0X", "0x"),
        marketParams: {
          loanToken: musdBtc.loanToken.toLowerCase(),
          collateralToken: musdBtc.collateralToken,
          oracle: musdBtc.oracle,
          irm: musdBtc.irm,
          lltv: musdBtc.lltv,
        },
      }
      expect(
        marketFromLog({
          eventName: "CreateMarket",
          args,
          blockNumber: 13_118_789n,
        }),
      ).toEqual(musdBtc)
      expect(
        marketFromLog({ eventName: "Supply", args, blockNumber: 1n }),
      ).toBeNull()
      expect(
        marketFromLog({
          eventName: "CreateMarket",
          args: { id: "0x12" },
          blockNumber: 1n,
        }),
      ).toBeNull()
    })

    it("reads a market the account scan finds in the run that finds it", async () => {
      await scannedTo(13_120_000)
      await env.READ_DB.prepare(
        `INSERT INTO job_cursors (job, network, value, updated_at)
         VALUES ('morpho-markets-backfill', 'mezo', 'done', 0)`,
      ).run()
      const chain = fakeChain({
        head: 13_120_100n,
        morpho,
        troves,
        created: [{ ...musdBtc, createdBlock: 13_120_050n }],
      })
      await runLiveSnapshot({
        db: env.READ_DB,
        chain,
        logWindowsPerRun: 5,
        nowSeconds: now,
        logger,
      })
      expect(chain.marketReads[0]).toContain(musdBtc.marketId)
      expect((await known()).results).toHaveLength(1)
      expect(chain.backfills).toEqual([])
    })

    it("needs no backfill on a first scan from the deploy block", async () => {
      const chain = fakeChain({ head: 13_120_100n, morpho, troves })
      await runLiveSnapshot({
        db: env.READ_DB,
        chain,
        logWindowsPerRun: 5,
        nowSeconds: now,
        logger,
      })
      expect(chain.backfills).toEqual([])
      expect(await cursor("morpho-markets-backfill")).toEqual({ value: "done" })
    })

    it("keeps its cursors when migration 0006 is not applied yet, and writes the rest", async () => {
      await scannedTo(13_120_000)
      await env.READ_DB.prepare("DROP TABLE morpho_known_markets").run()
      try {
        const chain = fakeChain({
          head: 13_120_100n,
          morpho,
          troves,
          created: [{ ...musdBtc, createdBlock: 13_120_050n }],
        })
        const summary = await runLiveSnapshot({
          db: env.READ_DB,
          chain,
          logWindowsPerRun: 5,
          nowSeconds: now,
          logger,
        })
        expect(summary).toMatchObject({ troves: 1, markets: 1 })
        // The found market is still read this run; the scan repeats.
        expect(chain.marketReads[0]).toContain(musdBtc.marketId)
        expect(await cursor("morpho-logs")).toEqual({ value: "13120000" })
        expect(await cursor("morpho-markets-backfill")).toBeNull()
      } finally {
        await env.READ_DB.prepare(
          `CREATE TABLE morpho_known_markets (
             network TEXT NOT NULL, market_id TEXT NOT NULL,
             loan_token TEXT NOT NULL, collateral_token TEXT NOT NULL,
             oracle TEXT NOT NULL, irm TEXT NOT NULL, lltv_raw TEXT NOT NULL,
             loan_decimals INTEGER, collateral_decimals INTEGER,
             created_block INTEGER NOT NULL, discovered_at INTEGER NOT NULL,
             PRIMARY KEY (network, market_id))`,
        ).run()
      }
    })
  })

  it("stores each escrow's supply and rewrites it only when it changes", async () => {
    const supply = {
      vebtc: 804_300_245_524_626_339_279n,
      vemezo: 282_928_843_502_055_892_242_558_692n,
    }
    const run = (head: bigint, values: typeof supply) =>
      runLiveSnapshot({
        db: env.READ_DB,
        chain: fakeChain({ head, morpho, troves, supply: values }),
        logWindowsPerRun: 5,
        nowSeconds: now,
        logger,
      })
    await run(13_096_907n, supply)
    expect(await readEscrowSupply(env.READ_DB)).toEqual(supply)
    await run(13_096_950n, supply)
    const unchanged = await env.READ_DB.prepare(
      "SELECT block FROM escrow_supply WHERE escrow = 'vebtc'",
    ).first()
    expect(unchanged).toEqual({ block: 13_096_907 })
    await run(13_097_000n, { ...supply, vebtc: supply.vebtc + 1n })
    expect((await readEscrowSupply(env.READ_DB)).vebtc).toBe(supply.vebtc + 1n)
  })

  it("stores markets, positions, troves and pool totals at one block", async () => {
    const chain = fakeChain({ head: 13_096_907n, morpho, troves })
    const summary = await runLiveSnapshot({
      db: env.READ_DB,
      chain,
      logWindowsPerRun: 5,
      nowSeconds: now,
      logger,
    })
    expect(summary).toEqual({
      block: 13_096_907,
      markets: 1,
      positions: 1,
      troves: 1,
      accountsDiscovered: 1,
      marketsDiscovered: 0,
      priceStored: true,
    })
    expect(chain.scans).toEqual([0n])
    const market = await env.READ_DB.prepare(
      "SELECT total_borrow_assets_raw, lltv_raw, block FROM morpho_markets",
    ).first()
    expect(market).toEqual({
      total_borrow_assets_raw: "62710840000",
      lltv_raw: "860000000000000000",
      block: 13_096_907,
    })
    const trove = await env.READ_DB.prepare(
      "SELECT owner, status, principal_raw FROM troves",
    ).first()
    expect(trove).toEqual({
      owner: troveOwner.toLowerCase(),
      status: "active",
      principal_raw: "14486900000000000000000",
    })
  })

  it("rewrites nothing unchanged and removes closed troves", async () => {
    await runLiveSnapshot({
      db: env.READ_DB,
      chain: fakeChain({ head: 100n, morpho, troves }),
      logWindowsPerRun: 5,
      nowSeconds: now,
      logger,
    })
    const chain = fakeChain({
      head: 200n,
      morpho,
      troves: { ...troves, troves: [] },
    })
    await runLiveSnapshot({
      db: env.READ_DB,
      chain,
      logWindowsPerRun: 5,
      nowSeconds: now + 300,
      logger,
    })
    // The scan resumes after the stored cursor.
    expect(chain.scans).toEqual([101n])
    const market = await env.READ_DB.prepare(
      "SELECT block, updated_at FROM morpho_markets",
    ).first()
    expect(market).toEqual({ block: 100, updated_at: now })
    const troveCount = await env.READ_DB.prepare(
      "SELECT count(*) AS n FROM troves",
    ).first<{ n: number }>()
    expect(troveCount?.n).toBe(0)
  })
})
