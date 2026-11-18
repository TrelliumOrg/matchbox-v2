import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  scenario: undefined as string | undefined,
  headers: new Map<string, string>(),
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) =>
    name === "x-scan-fixture" ? state.scenario : undefined,
  setResponseHeader: (name: string, value: string) => {
    state.headers.set(name, value)
  },
}))

const {
  poolsPage,
  poolPage,
  poolGauge,
  poolPageCharts,
  sourceText,
  tokenCrossChain,
} = await import("./crosschain.server")
const { searchAll } = await import("./search.server")
const { fixtureNow } = await import("./scan/fixtures/shared")
const { periodOf } = await import("./scan/period")

const thirtyDays = periodOf({ range: "30d" }, fixtureNow)

vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

/**
 * The Pools pages' and the token pages' cross-chain view models from the
 * fixtures (`/crosschain/*`): filters, the $25,000 line, a pool's page by
 * chain and address, the token page's slim pool rows, search, and each
 * read degrading on its own.
 */

function reset(scenario?: string): void {
  state.scenario = scenario
  state.headers.clear()
}

const curve = "0xb5571e76693ba60110b5811dd650ffefce1c955f"
const tigris = "0xcc372b7e15535ab225fe17c1075831d38ef7ac1a"

describe("pools page", () => {
  it("lists pools over the line with totals, as a fresh page", async () => {
    reset()
    const page = await poolsPage({ chain: "all", asset: "all", small: false })
    if (page.pools.status !== "ok") throw new Error("no pools")
    expect(page.pools.data.total.text).toBe("$5.75M")
    expect(page.pools.data.hidden).toBe(3)
    expect(page.pools.data.rows[0]?.title).toBe("MUSD/2pool")
    expect(page.price.status).toBe("ok")
    expect(state.headers.get("x-scan-cache")).toBe("fresh")
  })

  it("narrows by chain and token, and checks what it is sent", async () => {
    reset()
    const page = await poolsPage({
      chain: "ethereum",
      asset: "musd",
      // A request can send anything: unknown filters read as "all".
      small: "yes" as unknown as boolean,
    })
    if (page.pools.status !== "ok") throw new Error("no pools")
    expect(new Set(page.pools.data.rows.map((row) => row.chainName))).toEqual(
      new Set(["Ethereum"]),
    )
    expect(page.pools.data.filters.small).toBe(false)
    const odd = await poolsPage({
      chain: "solana" as unknown as "all",
      asset: "btc" as unknown as "all",
      small: false,
    })
    if (odd.pools.status !== "ok") throw new Error("no pools")
    expect(odd.pools.data.filters).toMatchObject({ chain: "all", asset: "all" })
  })

  it("says not available yet while the database is not bound", async () => {
    reset("disabled")
    const page = await poolsPage({ chain: "all", asset: "all", small: false })
    expect(page.pools.status).toBe("disabled")
    reset("limited")
    const busy = await poolsPage({ chain: "all", asset: "all", small: false })
    expect(busy.pools.status).toBe("rate-limited")
  })
})

describe("pool page", () => {
  it("finds a pool by chain and address, with its sources", async () => {
    reset()
    const page = await poolPage({ chain: "ethereum", pool: curve })
    if (page.pool.status !== "ok") throw new Error("no pool")
    const detail = page.pool.data
    expect(detail.row.title).toBe("MUSD/2pool")
    expect(detail.row.priceHere).toBe("$0.99361")
    expect(detail.headline).toBe("$0.9936")
    // 10 of the 16 pools have figures in the fixtures.
    expect(detail.share).toBe("58.4% of the liquidity counted so far")
    expect(detail.sources).toContainEqual({
      figure: "Volume 24h",
      source: "Curve",
    })
  })

  it("is missing on the wrong chain or for an unknown address", async () => {
    reset()
    expect((await poolPage({ chain: "base", pool: curve })).pool.status).toBe(
      "missing",
    )
    expect(
      (
        await poolPage({
          chain: "mezo",
          pool: "0x0000000000000000000000000000000000000001",
        })
      ).pool.status,
    ).toBe("missing")
  })

  it("shows a Mezo pool's own 7 day figures and names its estimates", async () => {
    reset()
    const page = await poolPage({ chain: "mezo", pool: tigris })
    if (page.pool.status !== "ok") throw new Error("no pool")
    // The pool's swaps, not the snapshot's: one source per figure.
    expect(page.pool.data.volume7d).toMatch(/^[$][\d,]+$/)
    expect(page.pool.data.rate7d).toBeNull()
    expect(page.pool.data.sources).toContainEqual({
      figure: "Fees",
      source: "Our estimate: 7 days of the pool's fees, a year, ÷ its reserves",
    })
  })

  it("adds a Mezo pool's volume, fees, gauge votes and reserves", async () => {
    reset()
    const page = await poolPage({
      chain: "mezo",
      pool: "0x9cbc1537d255768b431488305b1c7efc2ac95022",
    })
    if (page.pool.status !== "ok") throw new Error("no pool")
    const mezo = page.pool.data.mezo
    expect(mezo?.volume?.figure).toMatch(/^[$]/)
    // The days are drawn after first paint, one request for both charts.
    const charts = await poolPageCharts({
      pool: "0x9cbc1537d255768b431488305b1c7efc2ac95022",
    })
    expect(charts.volume?.points.length).toBeGreaterThan(20)
    expect(charts.volume?.figure).toBe(mezo?.volume?.figure)
    expect(mezo?.volume?.fees).toMatch(/^[$]/)
    expect(mezo?.gauge).toMatch(/^0x[0-9a-f]{40}$/)
    // The gauge's votes and voter APY load after first paint.
    const gauge = await poolGauge({ gauge: mezo?.gauge ?? "" })
    expect(gauge.votes?.figure).toMatch(/^[\d,]+[.]\d{2} veBTC$/)
    expect(gauge.votes?.apy).toMatch(/%$/)
    expect(mezo?.reserves?.figure).toMatch(/^[$]/)
    // One source per figure: liquidity, volume and the fee rate are the
    // pool's own, the total is the sum of the parts shown.
    const { row } = page.pool.data
    expect(page.pool.data.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          figure: "Liquidity",
          source: "Mezo: the pool's balances at the close",
        }),
        expect.objectContaining({
          figure: "Volume 24h",
          source: "Mezo: the pool's swaps",
        }),
        expect.objectContaining({
          figure: "Fees",
          source: expect.stringMatching(/7 days/),
        }),
      ]),
    )
    expect(row.rates.fees.kind).toBe("value")
    expect(page.pool.data.rate7d).toBeNull()
  })

  it("adds nothing for a pool off Mezo", async () => {
    reset()
    const page = await poolPage({ chain: "ethereum", pool: curve })
    expect(page.pool.status === "ok" && page.pool.data.mezo).toBeNull()
  })

  it("words each source", () => {
    expect(sourceText("merkl (veMEZO)")).toBe("Merkl, paid in veMEZO")
    expect(sourceText("defillama (savings rate)")).toBe(
      "DefiLlama, savings rate",
    )
    expect(sourceText("coingecko")).toBe("CoinGecko")
    expect(sourceText("someone new")).toBe("someone new")
  })
})

describe("token cross-chain sections", () => {
  it("sends the token page its five largest pools, slim", async () => {
    reset()
    const musd = await tokenCrossChain("musd", thirtyDays)
    if (musd.pools.status !== "ok") throw new Error("no pools")
    expect(musd.pools.data.rows).toHaveLength(5)
    expect(Object.keys(musd.pools.data.rows[0] ?? {}).sort()).toEqual([
      "chain",
      "id",
      "legacy",
      "link",
      "liquidity",
      "priceHere",
      "rate",
      "tickers",
      "title",
      "volume",
      "where",
    ])
    expect(musd.pools.data.more).toBe(10)
    expect(musd.pools.data.liquidity).toEqual({
      // MEZO/BTC is not a MUSD pool.
      text: "$5.75M",
      pools: 9,
      // Of the 15 MUSD pools, 6 have no figures in the fixtures.
      of: 15,
      chains: 3,
    })
    expect(musd.history?.status).toBe("ok")
  })

  it("has no rows and no liquidity before the first snapshot", async () => {
    reset("filling")
    const mezo = await tokenCrossChain("mezo", thirtyDays)
    if (mezo.pools.status !== "ok") throw new Error("no pools")
    expect(mezo.pools.data.rows).toEqual([])
    expect(mezo.pools.data.liquidity).toBeNull()
    expect(mezo.history).toBeNull()
    expect(mezo.bridge.status).toBe("ok")
  })
})

describe("with Mezo's daily rows missing", () => {
  it("lists a Mezo pool with no row and opens its page", async () => {
    reset("partial")
    const list = await poolsPage({ chain: "mezo", asset: "all", small: false })
    if (list.pools.status !== "ok") throw new Error("no pools")
    expect(list.pools.data.rows.map((row) => row.title)).toContain(
      "mUSDC/MUSD CL10",
    )
    const page = await poolPage({ chain: "mezo", pool: tigris })
    if (page.pool.status !== "ok") throw new Error("no pool")
    // Without the snapshot's row, the pool's own reserves and swaps stand.
    expect(page.pool.data.row.liquidity).toMatch(/^[$]/)
    // Its share of DEX is of every Mezo pool's own balances (the per-token
    // rollup), never against the snapshot's figures.
    expect(page.pool.data.share).toMatch(/^[0-9]+[.][0-9]% of DEX$/)
    // Liquidity over 90 days: the figures with the page, the days after
    // first paint (poolPageCharts), the same reads.
    const liquidity = page.pool.data.mezo?.liquidity
    expect(liquidity?.figure).toMatch(/^[$]/)
    expect(liquidity?.note).toMatch(/^[+-]\$.* in 90d$/)
    expect(liquidity?.stats.map((stat) => stat.label)).toEqual([
      "90d high",
      "Share of DEX",
    ])
    const chart = (await poolPageCharts({ pool: tigris })).liquidity
    expect(chart?.points).toHaveLength(90)
    expect(chart?.figure).toBe(liquidity?.figure)
    expect(liquidity?.reserve.value).toMatch(/^[$]/)
    expect(liquidity?.startLabel).toBe(chart?.startLabel)
    // Only a listed Mezo pool, by address.
    expect(await poolPageCharts({ pool: "nope" })).toEqual({
      liquidity: null,
      volume: null,
    })
    expect(page.pool.data.rate7d).toBeNull()
    expect(page.pool.data.row.rates.fees.kind).toBe("value")
  })

  it("says how many pools the token page liquidity counts", async () => {
    reset("partial")
    const musd = await tokenCrossChain("musd", thirtyDays)
    if (musd.pools.status !== "ok") throw new Error("no pools")
    expect(musd.pools.data.liquidity).toMatchObject({ pools: 6, of: 15 })
    expect(
      musd.pools.data.rows.every((row) => row.liquidity.startsWith("$")),
    ).toBe(true)
  })
})

describe("search", () => {
  it("adds matching pools as jump rows after the API's hits", async () => {
    reset()
    const result = await searchAll({ q: "curve 2pool", kind: "name" })
    const pool = result.hits.find((hit) => hit.icon === "pool")
    expect(pool).toEqual({
      group: "jump",
      icon: "pool",
      title: "MUSD/2pool",
      tag: null,
      detail: "Curve on Ethereum",
      path: `/pools/ethereum/${curve}`,
      untrusted: false,
    })
  })
})
