import type { CrossChain } from "@matchbox/chain"
import { WAD, wadToDecimal } from "@matchbox/domain/market-price"
import { createLogger } from "@matchbox/logger"
import { createPublicClient, custom, type PublicClient } from "viem"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import recorded from "../../test/fixtures/crosschain.json"
import { readBridgeFlows, routeTotalRows } from "./bridge"
import {
  headlineOf,
  musdPriceStatements,
  readMusdQuotes,
  runMusdPrice,
  type VenueQuote,
} from "./musd-price"
import { fetchPoolInputs, poolRows } from "./pools"
import { hourKey, planPart } from "./run"
import { SourceError, wormholeRouteTotals } from "./sources"
import { readAllSupply } from "./supply"

// Replays test/fixtures/crosschain.json: real answers from the public RPCs
// and APIs, recorded by scripts/record-crosschain-fixtures.ts (12 Nov
// 2026). No test touches a network.

const logger = createLogger({ level: "error" })

const rpcSchema = z.object({
  chain: z.enum(["mezo", "ethereum", "base", "bsc"]),
  method: z.string(),
  params: z.unknown().optional(),
  result: z.unknown(),
})
const httpSchema = z.object({
  url: z.string(),
  status: z.number(),
  body: z.unknown(),
})
const fixture = z
  .object({ rpc: z.array(rpcSchema), http: z.array(httpSchema) })
  .parse(recorded)

const callSchema = z.tuple([
  z.object({ to: z.string(), data: z.string() }),
  z.unknown(),
])

function sameCall(a: unknown, b: unknown): boolean {
  const left = callSchema.safeParse(a)
  const right = callSchema.safeParse(b)
  if (!left.success || !right.success) return false
  return (
    left.data[0].to.toLowerCase() === right.data[0].to.toLowerCase() &&
    left.data[0].data === right.data[0].data
  )
}

/** A client answering from the recording; anything else reverts. */
function replayClient(chain: CrossChain): PublicClient {
  const client = createPublicClient({
    transport: custom({
      async request({ method, params }) {
        const found = fixture.rpc.find(
          (record) =>
            record.chain === chain &&
            record.method === method &&
            (method !== "eth_call" || sameCall(record.params, params)),
        )
        if (found === undefined) throw new Error(`No recording: ${method}`)
        return found.result
      },
    }),
  })
  return client as PublicClient
}

function downClient(): PublicClient {
  const client = createPublicClient({
    transport: custom({
      async request() {
        throw new Error("RPC down")
      },
    }),
  })
  return client as PublicClient
}

const clients = {
  mezo: replayClient("mezo"),
  ethereum: replayClient("ethereum"),
  base: replayClient("base"),
  bsc: replayClient("bsc"),
}

async function replayFetch(url: string): Promise<Response> {
  const found = fixture.http.find((record) => record.url === url)
  if (found === undefined) return new Response("not found", { status: 404 })
  return new Response(JSON.stringify(found.body), { status: found.status })
}

/** A D1 stand-in that keeps the batches it is given. */
function capturingDb() {
  const batches: { sql: string; params: unknown[] }[][] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return { sql, params }
        },
      }
    },
    async batch(statements: { sql: string; params: unknown[] }[]) {
      batches.push(statements)
      return statements.map(() => ({ meta: { rows_written: 1 } }))
    },
  }
  return { db: db as unknown as D1Database, batches }
}

describe("MUSD venue quotes", () => {
  it("reads each venue from recorded chain state", async () => {
    const { quotes, failed } = await readMusdQuotes(clients)
    expect(failed).toEqual([])
    const byVenue = new Map(quotes.map((quote) => [quote.venue, quote]))
    // Recorded 12 Nov 2026: MUSD a little under its peg everywhere.
    for (const quote of quotes) {
      expect(quote.price > (WAD * 99n) / 100n, quote.venue).toBe(true)
      expect(quote.price < WAD, quote.venue).toBe(true)
    }
    const curve = byVenue.get("curve-musd-2pool")
    expect(wadToDecimal(curve?.price ?? 0n).slice(0, 6)).toBe("0.9937")
    expect(curve?.method).toBe("get_dy x 2pool virtual price")
    // Depths: Curve about $3.36M, Aerodrome about $820k, Tigris about $215k.
    expect((curve?.depth ?? 0n) / WAD > 3_000_000n).toBe(true)
    expect((byVenue.get("aero-musd-usdc")?.depth ?? 0n) / WAD > 700_000n).toBe(
      true,
    )
    expect(
      (byVenue.get("tigris-musdc-musd")?.depth ?? 0n) / WAD > 150_000n,
    ).toBe(true)
    expect(byVenue.get("tigris-musdc-musd")?.method).toBe("30-minute TWAP")
  })

  it("takes the deepest venue's side of the median and flags no divergence", async () => {
    const { quotes } = await readMusdQuotes(clients)
    const headline = headlineOf(quotes)
    expect(headline?.source).toBe("venues")
    expect(headline?.price).toBe(
      quotes.find((quote) => quote.venue === "curve-musd-2pool")?.price,
    )
    expect(headline?.diverged).toBe(false)
    expect(headline?.venuesUsed).toHaveLength(3)
  })

  it("flags venues more than 50 bps apart", () => {
    const quote = (venue: VenueQuote["venue"], price: bigint): VenueQuote => ({
      venue,
      chain: "ethereum",
      price,
      depth: WAD,
      method: "test",
      block: null,
    })
    const headline = headlineOf([
      quote("curve-musd-2pool", WAD),
      quote("aero-musd-usdc", (WAD * 9_940n) / 10_000n),
    ])
    expect(headline?.spreadBps).toBe(60n)
    expect(headline?.diverged).toBe(true)
  })

  it("reports a failed venue and prices from the rest", async () => {
    const { quotes, failed } = await readMusdQuotes({
      ...clients,
      base: downClient(),
    })
    expect(quotes.map((quote) => quote.venue).sort()).toEqual([
      "curve-musd-2pool",
      "tigris-musdc-musd",
    ])
    expect(failed.map((item) => item.venue)).toEqual(["aero-musd-usdc"])
  })

  it("falls back to CoinGecko's mezo-usd when no venue answers", async () => {
    const { db, batches } = capturingDb()
    const result = await runMusdPrice({
      db,
      clients: {
        mezo: downClient(),
        ethereum: downClient(),
        base: downClient(),
      },
      coingecko: { apiKey: null, plan: "demo" },
      fetchCoinGecko: async () =>
        new Map([
          [
            "mezo-usd",
            {
              usd: "0.993002",
              volume24hUsd: null,
              marketCapUsd: null,
              updatedAt: 1_794_465_277,
            },
          ],
        ]),
      nowSeconds: 1_794_465_300,
      logger,
    })
    expect(result.headline?.source).toBe("coingecko")
    expect(wadToDecimal(result.headline?.price ?? 0n)).toBe("0.993002")
    const sql = batches.flat().map((statement) => statement.sql)
    expect(sql.every((text) => text.includes("market_quotes"))).toBe(true)
  })

  it("writes daily closes only at the close minutes", async () => {
    const { quotes } = await readMusdQuotes(clients)
    const headline = headlineOf(quotes)
    const midHour = Date.UTC(2026, 10, 12, 7, 30) / 1000
    const close = Date.UTC(2026, 10, 12, 7, 59) / 1000
    const tables = (seconds: number) =>
      musdPriceStatements(quotes, headline, seconds).map((statement) =>
        statement.sql.includes("market_price_daily") ? "daily" : "quotes",
      )
    expect(tables(midHour)).toEqual(["quotes"])
    expect(tables(close)).toEqual(["quotes", "daily"])
    const [daily] = musdPriceStatements(quotes, headline, close).slice(1)
    const rows = z
      .array(z.object({ venue: z.string(), day: z.string() }))
      .parse(JSON.parse(String(daily?.params[0])))
    expect(rows.map((row) => row.venue).sort()).toEqual([
      "aero-musd-usdc",
      "curve-musd-2pool",
      "headline",
      "tigris-musdc-musd",
    ])
    expect(rows[0]?.day).toBe("2026-11-12")
  })
})

describe("supply by chain", () => {
  it("takes Mezo's locked balance out and matches the spokes", async () => {
    const { readings, failed } = await readAllSupply(clients)
    expect(failed).toEqual([])
    expect(readings).toHaveLength(7)
    const of = (asset: string, chain: string) =>
      readings.find((item) => item.asset === asset && item.chain === chain)
    const mezoMusd = of("musd", "mezo")
    expect(mezoMusd?.locked).not.toBeNull()
    expect(mezoMusd?.circulating).toBe(
      (mezoMusd?.totalSupply ?? 0n) - (mezoMusd?.locked ?? 0n),
    )
    expect(of("musd", "ethereum")?.locked).toBeNull()
    // The hub's locked MUSD backs Ethereum's and Base's supply (within 1%,
    // transfers in flight).
    const spokes =
      (of("musd", "ethereum")?.totalSupply ?? 0n) +
      (of("musd", "base")?.totalSupply ?? 0n)
    const locked = mezoMusd?.locked ?? 0n
    const gap = locked > spokes ? locked - spokes : spokes - locked
    expect(gap * 100n < locked).toBe(true)
    expect(of("mezo", "bsc")?.totalSupply).toBeGreaterThan(0n)
  })

  it("reports a chain that fails without losing the others", async () => {
    const { readings, failed } = await readAllSupply({
      ...clients,
      bsc: downClient(),
    })
    expect(readings).toHaveLength(6)
    expect(failed).toEqual([
      expect.objectContaining({ asset: "mezo", chain: "bsc" }),
    ])
  })
})

describe("pool snapshot", () => {
  it("splits APR by source and says why a figure is missing", async () => {
    const inputs = await fetchPoolInputs(replayFetch, logger)
    expect([...inputs.failed]).toEqual([])
    const rows = poolRows(inputs, "2026-11-12", 1_794_467_505)
    const byId = new Map(rows.map((row) => [row.pool_id, row]))
    const curve = byId.get("ethereum-curve-musd-2pool")
    expect(curve?.apr_fees).not.toBeNull()
    expect(curve?.apr_rewards).not.toBeNull()
    expect(curve?.apr_merkl).not.toBeNull()
    expect(JSON.parse(String(curve?.sources))).toMatchObject({
      tvl_usd: "geckoterminal",
      volume_24h_usd: "curve",
      apr_fees: "defillama",
      apr_rewards: "defillama",
      apr_merkl: "merkl (veMEZO)",
    })
    const aero = byId.get("base-aerodrome-musd-usdc")
    expect(aero?.tvl_usd).not.toBeNull()
    expect(aero?.apr_fees).toBeNull()
    expect(JSON.parse(String(aero?.unavailable)).apr_fees).toContain(
      "Aerodrome",
    )
    const savings = byId.get("mezo-savings-smusd")
    expect(JSON.parse(String(savings?.sources)).apr_fees).toBe(
      "defillama (savings rate)",
    )
    const tigris = byId.get("mezo-tigris-musdc-musd-cl")
    expect(JSON.parse(String(tigris?.sources)).apr_fees).toBe(
      "estimate: 24h volume x fee / TVL",
    )
    for (const row of rows) {
      expect(row.apr_gauge).toBeNull()
      expect(JSON.parse(String(row.unavailable)).apr_gauge).toBeTruthy()
    }
  })

  it("leaves a chain's pools out when its source failed", async () => {
    const inputs = await fetchPoolInputs(async (url) => {
      if (url.includes("/networks/base/")) {
        return new Response("rate limited", { status: 429 })
      }
      return replayFetch(url)
    }, logger)
    expect(inputs.failed.has("depth:base")).toBe(true)
    const rows = poolRows(inputs, "2026-11-12", 1)
    expect(rows.some((row) => String(row.pool_id).startsWith("base-"))).toBe(
      false,
    )
    expect(rows.some((row) => String(row.pool_id).startsWith("mezo-"))).toBe(
      true,
    )
  })
})

describe("bridge flows", () => {
  it("names routes by chain and keeps Wormholescan's daily series", async () => {
    const reading = await readBridgeFlows(
      replayFetch,
      "musd",
      "2026-11-05",
      "2026-11-12",
    )
    const rows = routeTotalRows("musd", reading.totals, "2026-11-12", 1)
    const routes = rows.map((row) => `${row.from_chain}>${row.to_chain}`)
    expect(routes).toContain("mezo>ethereum")
    expect(routes).toContain("ethereum>mezo")
    expect(routes).toContain("base>mezo")
    expect(reading.days.length).toBeGreaterThanOrEqual(7)
    expect(reading.days[0]?.day).toBe("2026-11-05")
  })

  it("raises a SourceError on an unsupported token", async () => {
    await expect(
      wormholeRouteTotals(
        async () =>
          new Response(
            JSON.stringify({
              error: "Unsupported token",
              message: "The specified token is not supported by NTT.",
            }),
            { status: 200 },
          ),
        "MEZO",
      ),
    ).rejects.toBeInstanceOf(SourceError)
  })
})

describe("hourly parts", () => {
  it("marks a part done for the hour only when it completed", async () => {
    const nowSeconds = Date.UTC(2026, 10, 12, 7, 20) / 1000
    expect(hourKey(nowSeconds)).toBe("2026-11-12T07")
    const supply = await planPart("supply", {
      clients,
      fetcher: replayFetch,
      nowSeconds,
      logger,
    })
    expect(supply.complete).toBe(true)
    expect(supply.statements.at(-1)?.params).toEqual([
      "crosschain:supply",
      "2026-11-12T07",
      nowSeconds,
    ])
    const partial = await planPart("supply", {
      clients: { ...clients, bsc: downClient() },
      fetcher: replayFetch,
      nowSeconds,
      logger,
    })
    expect(partial.complete).toBe(false)
    expect(
      partial.statements.some((statement) =>
        statement.sql.includes("scan_cursors"),
      ),
    ).toBe(false)
  })
})
