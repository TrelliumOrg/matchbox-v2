import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  scanDimensionMatches,
  scanMetricDefinition,
  scanMetricNotes,
  scanMetrics,
} from "@matchbox/contracts/scan"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { resetStorage } from "../../test/reset"
import { dailyRows as dailyRowsOf, dailySpec } from "./aggregates"
import {
  balanceKey,
  type ClosingChainReader,
  isClosingRun,
  isPriceCloseMinute,
  priceDailySpec,
  runClosingValues,
  runPriceClose,
  supplyTokens,
} from "./closing"
import { runScanCopy } from "./copy"
import type { FetchLike } from "./earn-pools"
import type { ApiBinding } from "./env"
import { counterTokens, runOnceDaily } from "./once-daily"
import { runBatch, upsertStatements } from "./statements"
import { btc, fixtureReader, musd, poolP } from "./testing/fixture"

// The ongoing `daily` and `price_daily` writers that ride the existing
// live (5 minute) and price (1 minute) triggers, against Miniflare D1.

const logger = createLogger({ level: "error" })
/** Mon 9 Nov 2026 12:00 UTC. */
const noon = Date.UTC(2026, 10, 9, 12, 0) / 1000
const early = Date.UTC(2026, 10, 9, 0, 5) / 1000
const validatorA = "0x00000000000000000000000000000000000000a1"
const validatorB = "0x00000000000000000000000000000000000000b2"

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await resetStorage()
  await env.SCAN_DB.batch(
    [
      "daily",
      "price_daily",
      "scan_cursors",
      "activity",
      "scan_runs",
      "pools",
    ].map((table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`)),
  )
})

async function dailyRows(day: string) {
  const result = await env.SCAN_DB.prepare(
    `SELECT metric, dimension, value, source FROM daily WHERE day = ?1
     ORDER BY metric, dimension`,
  )
    .bind(day)
    .all()
  return result.results
}

async function cursor(name: string) {
  const row = await env.SCAN_DB.prepare(
    "SELECT value FROM scan_cursors WHERE name = ?1",
  )
    .bind(name)
    .first<{ value: string }>()
  return row?.value ?? null
}

function chainReader(failing = false): ClosingChainReader {
  return {
    async balances(reads) {
      return new Map(
        reads
          .filter(() => !failing)
          .map((read) => [
            balanceKey(read.token, read.holder),
            read.token === btc ? 7n : 900n,
          ]),
      )
    },
    async totalSupply() {
      return 123_000_000_000_000_000_000_000n
    },
  }
}

async function seedPoolsAndReadModels() {
  // Pools come from copied PoolCreated rows.
  await runScanCopy({
    db: env.SCAN_DB,
    warehouse: fixtureReader(),
    trigger: "chained",
    summary: null,
    nowSeconds: noon,
    logger,
  })
  await env.READ_DB.batch([
    env.READ_DB.prepare(
      `INSERT OR REPLACE INTO troves (network, owner, status, coll_raw, principal_raw,
         interest_raw, interest_rate, block, updated_at)
       VALUES ('mezo', '0x${"a".repeat(40)}', 1, '5', '1000', '20', 100, 1, 1)`,
    ),
    env.READ_DB.prepare(
      `INSERT OR REPLACE INTO escrow_supply (network, escrow, supply_raw, block, updated_at)
       VALUES ('mezo', 'vebtc', '799922996221192464636', 1, 1)`,
    ),
  ])
  await env.SCAN_DB.prepare("DELETE FROM daily").run()
}

describe("closing values", () => {
  it("records on :00, :30 and the day's last run only", () => {
    expect(isClosingRun(noon)).toBe(true)
    expect(isClosingRun(noon + 30 * 60)).toBe(true)
    expect(isClosingRun(noon + 5 * 60)).toBe(false)
    expect(isClosingRun(noon + 11 * 3_600 + 55 * 60)).toBe(true)
    expect(isPriceCloseMinute(noon + 59 * 60)).toBe(true)
    expect(isPriceCloseMinute(noon + 58 * 60)).toBe(false)
  })

  it("writes one partial closing value per metric, rewriting only changes", async () => {
    await seedPoolsAndReadModels()
    const deps = {
      readDb: env.READ_DB,
      scanDb: env.SCAN_DB,
      chain: chainReader(),
      nowSeconds: noon,
      logger,
      liveBlock: 100,
    }
    expect(await runClosingValues({ ...deps, nowSeconds: noon + 300 })).toBe(
      null,
    )
    const first = await runClosingValues(deps)
    expect(first).toMatchObject({
      status: "written",
      // Two pool balances, three read-model closes, the supplies, and the
      // pool balances summed per token (pool.token_balance, one per token).
      points: 7 + supplyTokens.length,
    })
    const rows = await dailyRows("2026-11-09")
    expect(rows).toContainEqual({
      metric: "pool.balance",
      dimension: `${poolP}:${btc}`,
      value: "7",
      source: "live",
    })
    expect(rows).toContainEqual({
      metric: "pool.token_balance",
      dimension: btc,
      value: "7",
      source: "live",
    })
    expect(rows).toContainEqual({
      metric: "token.total_supply",
      dimension: musd,
      value: "123000000000000000000000",
      source: "live",
    })
    expect(rows).toContainEqual({
      metric: "musd.trove_debt",
      dimension: "",
      value: "1020",
      source: "live",
    })
    const partial = await env.SCAN_DB.prepare(
      "SELECT DISTINCT partial FROM daily",
    ).all()
    expect(partial.results).toEqual([{ partial: 1 }])
    // Unchanged values change no served row: data_version stays put.
    const version = await env.SCAN_DB.prepare(
      "SELECT data_version FROM scan_status WHERE id = 1",
    ).first()
    const again = await runClosingValues({ ...deps, nowSeconds: noon + 1_800 })
    expect(again).toMatchObject({ status: "written" })
    expect(
      await env.SCAN_DB.prepare(
        "SELECT data_version FROM scan_status WHERE id = 1",
      ).first(),
    ).toEqual(version)
    // The second run supplied the close.
    expect(await cursor("close:2026-11-09")).toBe("12:30 block 100")
  })

  it("records nothing when the live snapshot failed or a read is missing", async () => {
    await seedPoolsAndReadModels()
    const base = {
      readDb: env.READ_DB,
      scanDb: env.SCAN_DB,
      nowSeconds: noon,
      logger,
    }
    expect(
      await runClosingValues({
        ...base,
        chain: chainReader(),
        liveBlock: null,
      }),
    ).toEqual({ status: "skipped", reason: "Live snapshot failed" })
    expect(
      await runClosingValues({
        ...base,
        chain: chainReader(true),
        liveBlock: 100,
      }),
    ).toMatchObject({ status: "skipped" })
    expect(await dailyRows("2026-11-09")).toEqual([])
  })

  it("keeps one closing price per token per day", async () => {
    const prices = {
      btc: {
        usd: "105710.25",
        change24h: null,
        source: "mezo-oracle" as const,
        updatedAt: noon,
      },
      mezo: null,
    }
    expect(
      await runPriceClose({ scanDb: env.SCAN_DB, prices, nowSeconds: noon }),
    ).toBe(0)
    await runPriceClose({
      scanDb: env.SCAN_DB,
      prices,
      nowSeconds: noon + 59 * 60,
    })
    await runPriceClose({
      scanDb: env.SCAN_DB,
      prices: { ...prices, btc: { ...prices.btc, usd: "106000" } },
      nowSeconds: noon + 3_600 + 59 * 60,
    })
    const rows = await env.SCAN_DB.prepare(
      "SELECT token, day, price, source FROM price_daily",
    ).all()
    expect(rows.results).toEqual([
      {
        token: "btc",
        day: "2026-11-09",
        price: "106000",
        source: "mezo-oracle",
      },
    ])
  })
})

function point(day: string, value: bigint, source: string) {
  return upsertStatements(
    dailySpec,
    dailyRowsOf(
      [{ metric: "chain.transactions", dimension: "", value }],
      day,
      source,
      noon,
    ),
  )
}

describe("backfill guard", () => {
  it("never lets a backfilled row replace a live one, on daily and price_daily", async () => {
    await runBatch(env.SCAN_DB, point("2026-11-08", 967n, "blockscout"))
    await runBatch(
      env.SCAN_DB,
      point("2026-11-08", 900n, "backfill:blockscout"),
    )
    expect(await dailyRows("2026-11-08")).toEqual([
      {
        metric: "chain.transactions",
        dimension: "",
        value: "967",
        source: "blockscout",
      },
    ])
    // A live value does replace a backfilled one.
    await runBatch(env.SCAN_DB, point("2026-11-07", 10n, "backfill:blockscout"))
    await runBatch(env.SCAN_DB, point("2026-11-07", 12n, "blockscout"))
    expect(await dailyRows("2026-11-07")).toEqual([
      {
        metric: "chain.transactions",
        dimension: "",
        value: "12",
        source: "blockscout",
      },
    ])
    const price = (value: string, source: string) =>
      upsertStatements(priceDailySpec, [
        {
          token: "btc",
          day: "2026-11-08",
          price: value,
          source,
          updated_at: noon,
        },
      ])
    await runBatch(env.SCAN_DB, price("75000", "mezo-oracle"))
    await runBatch(env.SCAN_DB, price("70000", "backfill:skip-oracle"))
    const stored = await env.SCAN_DB.prepare(
      "SELECT price, source FROM price_daily",
    ).all()
    expect(stored.results).toEqual([{ price: "75000", source: "mezo-oracle" }])
  })
})

function api(
  options: {
    chartDays?: string[]
    /** Recent block miners. */
    miners?: string[]
    /** Height of the newest of the recent blocks. */
    head?: number
    /** Unix time of the newest block; none sends no timestamps. */
    headTime?: number
    /**
     * validations_count per validator; "fail" answers 503, "flaky" 503 on
     * the first read and 7 after, "404" and "429" those statuses.
     */
    validations?: Record<string, string | null>
  } = {},
): ApiBinding & { paths: string[]; maxInFlight: () => number } {
  const paths: string[] = []
  const flaked = new Set<string>()
  let inFlight = 0
  let maxInFlight = 0
  const miners = options.miners ?? [validatorA]
  const validations = options.validations ?? { [validatorA]: "1000" }
  const chartDays = options.chartDays ?? [
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]
  return {
    paths,
    maxInFlight: () => maxInFlight,
    async fetch(request) {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path.endsWith("/stats/charts/transactions")) {
        return Response.json({
          chart_data: chartDays.map((date, index) => ({
            date,
            transactions_count: 900 + index,
          })),
        })
      }
      if (path.endsWith("/blocks")) {
        return Response.json({
          items: miners.map((hash, index) => ({
            height: (options.head ?? 13_119_792) - index,
            miner: { hash },
            ...(options.headTime === undefined
              ? {}
              : {
                  timestamp: new Date(
                    (options.headTime - index * 4) * 1000,
                  ).toISOString(),
                }),
          })),
          next_page_params: null,
        })
      }
      const validator = /addresses\/(0x[0-9a-fA-F]{40})\/counters$/.exec(path)
      if (validator !== null) {
        const address = validator[1]?.toLowerCase() ?? ""
        const count = validations[address]
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        inFlight -= 1
        if (count === "flaky" && !flaked.has(address)) {
          flaked.add(address)
          return new Response("upstream", { status: 503 })
        }
        if (count === "404" || count === "429") {
          return new Response("no", { status: Number(count) })
        }
        if (count === "fail" || count === undefined) {
          return new Response("upstream", { status: 503 })
        }
        return Response.json({
          transactions_count: "0",
          token_transfers_count: "0",
          gas_usage_count: "0",
          validations_count: count === "flaky" ? "7" : count,
        })
      }
      if (path.endsWith("/stats")) {
        return Response.json({
          average_block_time: 3800,
          total_blocks: "13119792",
          total_transactions: "1140500",
          total_addresses: "64010",
          transactions_today: "980",
          gas_used_today: null,
          gas_prices: null,
          coin_price: null,
          market_cap: null,
          network_utilization_percentage: null,
        })
      }
      return Response.json({
        transfers_count: "5000",
        token_holders_count: "1200",
      })
    },
  }
}

/** Subgraph answers indexed through `indexedAt` (unix seconds). */
function subgraphs(indexedAt: number): FetchLike {
  const meta = { block: { timestamp: indexedAt } }
  const day = `${Date.UTC(2026, 10, 8) / 1000}000000`
  const pool = { id: poolP, token0: { id: btc }, token1: { id: musd } }
  return async function answer(url) {
    if (url.includes("earn-pools")) {
      return Response.json({
        data: {
          _meta: meta,
          pools: [pool],
          clpools: [],
          poolVolumes: [
            { timestamp: day, pool, totalVolume0: "10", totalVolume1: "20" },
          ],
          feesStats_collection: [
            { timestamp: day, pool, totalFees0: "1", totalFees1: "2" },
          ],
          clpoolVolumes: [],
          clfeeStats_collection: [],
        },
      })
    }
    if (url.includes("earn-locks")) {
      return Response.json({
        data: { _meta: meta, distributedRewards_collection: [] },
      })
    }
    if (url.includes("mezo-bridge-out")) {
      return Response.json({
        data: {
          _meta: meta,
          rows: [
            {
              amount: "5",
              token: btc,
              timestamp_: String(Date.UTC(2026, 10, 8, 6) / 1000),
              chain: "1",
            },
          ],
        },
      })
    }
    return Response.json({ data: { _meta: meta, rows: [] } })
  }
}

describe("once-a-day series", () => {
  it("records counters, exact chart days and finished subgraph days", async () => {
    const binding = api()
    const result = await runOnceDaily({
      db: env.SCAN_DB,
      api: binding,
      fetcher: subgraphs(early),
      nowSeconds: early,
      logger,
    })
    expect(
      result.sources.map((source) => [source.source, source.status]),
    ).toEqual([
      ["counters", "done"],
      ["validators", "done"],
      ["chart", "done"],
      ["dex", "done"],
      ["fees", "done"],
      ["bridge-in", "done"],
      ["bridge-out", "done"],
    ])
    expect(binding.paths).toContain("/internal/blockscout/api/v2/stats")
    expect(binding.paths).toContain(
      `/internal/blockscout/api/v2/tokens/${counterTokens[2]}/counters`,
    )
    const rows = await dailyRows("2026-11-08")
    expect(rows).toContainEqual({
      metric: "chain.transactions",
      dimension: "",
      value: "902",
      source: "blockscout",
    })
    expect(rows).toContainEqual({
      metric: "dex.fees",
      dimension: `${poolP}:${musd}`,
      value: "2",
      source: "earn-pools",
    })
    expect(rows).toContainEqual({
      metric: "token.holders",
      dimension: musd,
      value: "1200",
      source: "blockscout",
    })
    // No counter differences: Blockscout's totals are levels only.
    expect(rows.some((row) => row.metric === "chain.new_addresses")).toBe(false)
    // Chart days before yesterday are filled too.
    expect(await dailyRows("2026-11-06")).toContainEqual({
      metric: "chain.transactions",
      dimension: "",
      value: "900",
      source: "blockscout",
    })
    expect(await cursor("daily:dex")).toBe("2026-11-08")
    // When the "closing" counters were actually read.
    expect(await cursor("counters:2026-11-08")).toBe(
      new Date(early * 1000).toISOString(),
    )
    const pools = await env.SCAN_DB.prepare(
      "SELECT pool, kind FROM pools",
    ).all()
    expect(pools.results).toEqual([{ pool: poolP, kind: "basic" }])

    const again = await runOnceDaily({
      db: env.SCAN_DB,
      api: binding,
      fetcher: subgraphs(early),
      nowSeconds: early + 300,
      logger,
    })
    expect(again.sources).toEqual([])
  })

  it("never accepts a day a full page may have cut short", async () => {
    // 1,000 bridge-out rows (the page limit), the last at 06:00 on the 8th:
    // the rest of the 8th may be on a page that was never read.
    const base = subgraphs(early)
    const rows = Array.from({ length: 1_000 }, () => ({
      amount: "5",
      token: btc,
      timestamp_: String(Date.UTC(2026, 10, 8, 6) / 1000),
      chain: "1",
    }))
    const fetcher: FetchLike = async (url, init) =>
      url.includes("mezo-bridge-out")
        ? Response.json({
            data: { _meta: { block: { timestamp: early } }, rows },
          })
        : base(url, init)
    const result = await runOnceDaily({
      db: env.SCAN_DB,
      api: null,
      fetcher,
      nowSeconds: early,
      logger,
    })
    expect(
      result.sources.find((source) => source.source === "bridge-out"),
    ).toMatchObject({ status: "waiting" })
    expect(await cursor("daily:bridge-out")).toBeNull()
    expect(
      (await dailyRows("2026-11-08")).some((row) =>
        String(row.metric).startsWith("bridge.out"),
      ),
    ).toBe(false)
    // The other sources are unaffected.
    expect(await cursor("daily:bridge-in")).toBe("2026-11-08")
  })

  it("waits for a lagging subgraph instead of marking the day done", async () => {
    // The subgraph has only indexed to 23:00 on the 8th.
    const result = await runOnceDaily({
      db: env.SCAN_DB,
      api: api(),
      fetcher: subgraphs(Date.UTC(2026, 10, 8, 23, 0) / 1000),
      nowSeconds: early,
      logger,
    })
    expect(
      result.sources.find((source) => source.source === "dex"),
    ).toMatchObject({ status: "waiting" })
    expect(await cursor("daily:dex")).toBeNull()
    expect(
      (await dailyRows("2026-11-08")).some((row) => row.metric === "dex.fees"),
    ).toBe(false)
    // Once it has caught up, the day is written.
    await runOnceDaily({
      db: env.SCAN_DB,
      api: api(),
      fetcher: subgraphs(early + 3_600),
      nowSeconds: early + 3_600,
      logger,
    })
    expect(await cursor("daily:dex")).toBe("2026-11-08")
  })

  it("leaves the chart marker unset until the chart has yesterday", async () => {
    await runOnceDaily({
      db: env.SCAN_DB,
      api: api({ chartDays: ["2026-11-06", "2026-11-07"] }),
      fetcher: subgraphs(early),
      nowSeconds: early,
      logger,
    })
    expect(await cursor("daily:chart")).toBeNull()
    expect(await dailyRows("2026-11-07")).toContainEqual({
      metric: "chain.transactions",
      dimension: "",
      value: "901",
      source: "blockscout",
    })
  })

  it("writes no marker for a source whose read failed, and backs off", async () => {
    const broken: ApiBinding = {
      async fetch() {
        return new Response("down", { status: 502 })
      },
    }
    const result = await runOnceDaily({
      db: env.SCAN_DB,
      api: broken,
      fetcher: subgraphs(early),
      nowSeconds: early,
      logger,
    })
    expect(
      result.sources.find((source) => source.source === "counters"),
    ).toMatchObject({ status: "failed" })
    expect(await cursor("daily:counters")).toBeNull()
    expect(await cursor("daily:chart")).toBeNull()
    // Within 30 minutes it is not retried; after, it is.
    const soon = await runOnceDaily({
      db: env.SCAN_DB,
      api: api(),
      fetcher: subgraphs(early),
      nowSeconds: early + 600,
      logger,
    })
    expect(soon.sources.some((source) => source.source === "counters")).toBe(
      false,
    )
    await runOnceDaily({
      db: env.SCAN_DB,
      api: api(),
      fetcher: subgraphs(early),
      nowSeconds: early + 1_900,
      logger,
    })
    expect(await cursor("daily:counters")).toBe("2026-11-08")
  })

  it("does not read counters outside the first hours of the day", async () => {
    const binding = api()
    const result = await runOnceDaily({
      db: env.SCAN_DB,
      api: binding,
      fetcher: subgraphs(noon),
      nowSeconds: noon,
      logger,
    })
    expect(
      result.sources.find((source) => source.source === "counters"),
    ).toMatchObject({ status: "skipped" })
    expect(binding.paths).not.toContain("/internal/blockscout/api/v2/stats")
  })
})

describe("validators: blocks proposed per day", () => {
  const day = 86_400
  async function run(
    days: number,
    options: Parameters<typeof api>[0],
    offset = 0,
  ) {
    const binding = api(options)
    const result = await runOnceDaily({
      db: env.SCAN_DB,
      api: binding,
      fetcher: subgraphs(early + days * day),
      nowSeconds: early + days * day + offset,
      logger,
      counterRetryDelayMs: 0,
    })
    return { binding, result }
  }
  async function series(metric: string) {
    const result = await env.SCAN_DB.prepare(
      `SELECT dimension, day, value FROM daily WHERE metric = ?1
       ORDER BY day, dimension`,
    )
      .bind(metric)
      .all()
    return result.results
  }
  const counterReads = (paths: string[]) =>
    paths.filter((path) => path.includes("/addresses/")).length

  it("writes the difference of two daily reads, and nothing on the first", async () => {
    const first = await run(0, {
      miners: [validatorA, validatorB],
      validations: { [validatorA]: "1000", [validatorB]: "500" },
    })
    // One read of recent blocks and one counter read per validator.
    expect(
      first.binding.paths.filter((path) => path.endsWith("/blocks")),
    ).toHaveLength(1)
    expect(counterReads(first.binding.paths)).toBe(2)
    expect(await series("chain.blocks_proposed")).toEqual([])
    expect(await series("chain.blocks_proposed_total")).toEqual([
      { dimension: validatorA, day: "2026-11-08", value: "1000" },
      { dimension: validatorB, day: "2026-11-08", value: "500" },
    ])
    await run(1, {
      miners: [],
      validations: { [validatorA]: "1100", [validatorB]: "520" },
    })
    expect(await series("chain.blocks_proposed")).toEqual([
      { dimension: validatorA, day: "2026-11-09", value: "100" },
      { dimension: validatorB, day: "2026-11-09", value: "20" },
    ])
    // Read once a day: a later run that day reads nothing more.
    const again = await run(1, { miners: [], validations: {} }, 3_600)
    expect(counterReads(again.binding.paths)).toBe(0)
  })

  it("counts the day's blocks from the heads of two daily reads", async () => {
    const reads = {
      miners: [validatorA],
      validations: { [validatorA]: "1000" },
    }
    await run(0, { ...reads, head: 13_000_000 })
    // First read: the height only, no count.
    expect(await series("chain.blocks")).toEqual([])
    expect(await series("chain.block_height")).toEqual([
      { dimension: "", day: "2026-11-08", value: "13000000" },
    ])
    await run(1, { ...reads, head: 13_023_000 })
    // A missed day (no read for the 10th) leaves a gap, not a two-day sum.
    await run(3, { ...reads, head: 13_070_000 })
    await run(4, { ...reads, head: 13_093_100 })
    expect(await series("chain.blocks")).toEqual([
      { dimension: "", day: "2026-11-09", value: "23000" },
      { dimension: "", day: "2026-11-12", value: "23100" },
    ])
    // An answer without block times writes no head time.
    expect(await series("chain.block_height_time")).toEqual([])
  })

  it("keeps the head block's time beside its height", async () => {
    const reads = {
      miners: [validatorA, validatorB],
      validations: { [validatorA]: "1000", [validatorB]: "500" },
    }
    const at = early + 1_234
    await run(0, { ...reads, head: 13_000_000, headTime: at })
    expect(await series("chain.block_height_time")).toEqual([
      { dimension: "", day: "2026-11-08", value: String(at) },
    ])
  })

  it("leaves a gap for a missed day and for a counter that went down", async () => {
    await run(0, { validations: { [validatorA]: "1000" } })
    // No read on the 10th (for the 9th); the 11th's read spans two days.
    await run(2, { validations: { [validatorA]: "1300" } })
    await run(3, { validations: { [validatorA]: "1250" } })
    await run(4, { validations: { [validatorA]: "1260" } })
    expect(await series("chain.blocks_proposed")).toEqual([
      { dimension: validatorA, day: "2026-11-12", value: "10" },
    ])
    expect(
      (await series("chain.blocks_proposed_total")).map((row) => row.day),
    ).toEqual(["2026-11-08", "2026-11-10", "2026-11-11", "2026-11-12"])
  })

  it("retries only the validators whose read failed", async () => {
    const first = await run(0, {
      miners: [validatorA, validatorB],
      validations: { [validatorA]: "1000", [validatorB]: "fail" },
    })
    expect(first.result.sources).toContainEqual(
      expect.objectContaining({ source: "validators", status: "failed" }),
    )
    expect(await cursor("daily:validators")).toBeNull()
    // Thirty minutes later: only B is read, and the recent blocks are not.
    const retry = await run(
      0,
      {
        miners: [validatorA, validatorB],
        validations: { [validatorA]: "1000", [validatorB]: "500" },
      },
      1_800,
    )
    expect(
      retry.binding.paths.filter((path) => path.includes("/addresses/")),
    ).toEqual([`/internal/blockscout/api/v2/addresses/${validatorB}/counters`])
    expect(
      retry.binding.paths.filter((path) => path.endsWith("/blocks")),
    ).toEqual([])
    expect(await cursor("daily:validators")).toBe("2026-11-08")
  })

  const many = (count: number) =>
    Array.from(
      { length: count },
      (_, n) => `0x${(0xd0 + n).toString(16).padStart(40, "0")}`,
    )
  const failedReason = (result: { sources: unknown[] }) =>
    z
      .array(
        z.looseObject({
          source: z.string(),
          status: z.string(),
          reason: z.string().optional(),
        }),
      )
      .parse(result.sources)
      .find((each) => each.source === "validators" && each.status === "failed")
      ?.reason

  it("reads the counters a few at a time, never more than one read each", async () => {
    const validators = many(9)
    const { binding } = await run(0, {
      miners: validators,
      validations: Object.fromEntries(validators.map((v) => [v, "10"])),
    })
    // Four at a time, a literal: a larger batch size fails here.
    expect(binding.maxInFlight()).toBeLessThanOrEqual(4)
    expect(counterReads(binding.paths)).toBe(9)
    expect(await cursor("daily:validators")).toBe("2026-11-08")
  })

  it("retries a failed read once, leaving the last in line for the next run", async () => {
    const validators = many(6)
    const [flaky = "", ...rest] = validators
    const { binding, result } = await run(0, {
      miners: validators,
      validations: {
        [flaky]: "flaky",
        ...Object.fromEntries(rest.map((v) => [v, "10"])),
      },
    })
    // Six validators, six reads: the retry took the last one's read.
    expect(counterReads(binding.paths)).toBe(6)
    expect(
      (await series("chain.blocks_proposed_total")).map((row) => row.dimension),
    ).toContain(flaky)
    expect(failedReason(result)).toBe(
      `No counter for 1 validators: ${validators.at(-1)} (not read)`,
    )
    expect(await cursor("daily:validators")).toBeNull()
  })

  it("names each failed read's status, and stops reading at a 429", async () => {
    const validators = many(6)
    const [gone = "", limited = "", ...rest] = validators
    const { binding, result } = await run(0, {
      miners: validators,
      validations: {
        [gone]: "404",
        [limited]: "429",
        ...Object.fromEntries(rest.map((v) => [v, "10"])),
      },
    })
    // The first batch of four only: nothing more once the proxy says 429.
    expect(counterReads(binding.paths)).toBe(4)
    const reason = failedReason(result)
    expect(reason).toContain(`${gone} (404)`)
    expect(reason).toContain(`${limited} (429)`)
    expect(reason).toContain(`${validators.at(-1)} (not read)`)
  })

  it("reads validators labelled in labels too", async () => {
    const labelled = "0x00000000000000000000000000000000000000c3"
    await env.SCAN_DB.prepare(
      `INSERT INTO labels (address, name, name_lower, kind, source, updated_at)
       VALUES (?1, 'Validator C', 'validator c', 'validator', 'curated', 0)`,
    )
      .bind(labelled)
      .run()
    const { binding } = await run(0, {
      miners: [],
      validations: { [labelled]: "7" },
    })
    expect(binding.paths).toContain(
      `/internal/blockscout/api/v2/addresses/${labelled}/counters`,
    )
    expect(await series("chain.blocks_proposed_total")).toEqual([
      { dimension: labelled, day: "2026-11-08", value: "7" },
    ])
  })

  it("lists one day across validators by an index range, not a sort", async () => {
    const plan = await env.SCAN_DB.prepare(
      `EXPLAIN QUERY PLAN SELECT dimension, value FROM daily INDEXED BY daily_by_day
       WHERE metric = 'chain.blocks_proposed' AND day = '2026-11-09'
       ORDER BY dimension`,
    ).all()
    const detail = plan.results.map((row) => String(row.detail)).join(" | ")
    expect(detail).toContain("daily_by_day")
    expect(detail).not.toContain("TEMP B-TREE")
  })
})

describe("the series registry", () => {
  it("registers every metric the writers produce, with accepted dimensions", async () => {
    await seedPoolsAndReadModels()
    // The copy step's day rows were cleared by the seed: copy again.
    await env.SCAN_DB.prepare("DELETE FROM scan_cursors").run()
    await runScanCopy({
      db: env.SCAN_DB,
      warehouse: fixtureReader(),
      trigger: "chained",
      summary: null,
      nowSeconds: noon,
      logger,
    })
    await runClosingValues({
      readDb: env.READ_DB,
      scanDb: env.SCAN_DB,
      chain: chainReader(),
      nowSeconds: noon,
      logger,
      liveBlock: 100,
    })
    await runOnceDaily({
      db: env.SCAN_DB,
      api: api(),
      fetcher: subgraphs(early),
      nowSeconds: early,
      logger,
    })
    // A second day's read, for the series that are differences of two.
    await runOnceDaily({
      db: env.SCAN_DB,
      api: api({ validations: { [validatorA]: "1010" } }),
      fetcher: subgraphs(early + 86_400),
      nowSeconds: early + 86_400,
      logger,
    })
    const written = await env.SCAN_DB.prepare(
      "SELECT DISTINCT metric, dimension FROM daily",
    ).all<{ metric: string; dimension: string }>()
    expect(written.results.map((row) => row.metric)).toContain(
      "chain.blocks_proposed",
    )
    expect(written.results.length).toBeGreaterThan(30)
    for (const row of written.results) {
      const definition = scanMetricDefinition(row.metric)
      expect(definition, row.metric).not.toBeNull()
      if (definition === null) continue
      expect(
        scanDimensionMatches(definition.dimension, row.dimension),
        `${row.metric} ${row.dimension}`,
      ).toBe(true)
    }
  })

  it("takes a validator's lower-case address, or '' for the total", () => {
    expect(scanDimensionMatches("validator", validatorA)).toBe(true)
    expect(scanDimensionMatches("validator", "")).toBe(true)
    expect(scanDimensionMatches("validator", validatorA.toUpperCase())).toBe(
      false,
    )
    expect(scanDimensionMatches("validator", "vebtc")).toBe(false)
  })

  it("has a definition for every registered metric", () => {
    expect(Object.keys(scanMetricNotes).sort()).toEqual(
      Object.keys(scanMetrics).sort(),
    )
  })
})
