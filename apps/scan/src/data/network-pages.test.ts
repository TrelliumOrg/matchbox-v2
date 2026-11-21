import { render, screen } from "@testing-library/react"
import { createElement } from "react"
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

const { networkOverview, tvlView } = await import("./network.server")
const { tokensPage, tokenPage, priceSourceLabel, musdLater, calendarSum } =
  await import("./token-pages.server")
const { tokenSlugOf } = await import("./scan/token-list")
const { fixtureNow } = await import("./scan/fixtures/shared")
const { SeriesBody } = await import("../explorer/voting/series-panel")

// The fixtures' "now" (Mon 9 Nov 2026), so today is their today.
vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

/**
 * The Network and Tokens pages' view models from the fixtures: each panel
 * from its own series, backfill-only series saying where they end, USD
 * only where a daily price exists, and every section degrading on its own.
 */

function reset(scenario?: string): void {
  state.scenario = scenario
  state.headers.clear()
}

const labels = (stats: readonly { label: string }[]) =>
  stats.map((stat) => stat.label)

describe("network overview", () => {
  it("draws each panel from its series", async () => {
    reset()
    const page = await networkOverview({ range: "30d" })
    expect(page.addresses.status).toBe("ok")
    // Blockscout's total has its own change: the first-seen backfill,
    // which counts something else, is not shown beside it.
    expect(labels(page.addressStats)).toEqual(["Added 7d", "Added 30d"])
    expect(page.active.status === "ok" && page.active.data.endsOn).toBe(
      "31 Oct 2026",
    )
    expect(labels(page.activeStats)).toEqual([
      "7d average",
      "30d average",
      "90d high",
    ])
    expect(labels(page.transactionStats)).toEqual([
      "30d average",
      "30d high",
      "All time",
    ])
    expect(page.musd.status === "ok" && page.musd.data.figure).toMatch(
      /^[0-9,]+ MUSD$/,
    )
    expect(labels(page.musdStats)).toEqual([
      "Holders",
      "Holders 30d",
      "Supply 30d",
    ])
    // TVL and DEX volume are read with the page, for its first paint.
    expect(state.headers.get("x-scan-cache")).toBe("list")
    const later = page.values
    expect(later.tvl?.parts.map((part) => part.label)).toEqual(
      expect.arrayContaining(["veBTC", "Trove collateral", "DEX pools"]),
    )
    expect(later.tvl?.figure).toMatch(/^[$]/)
    expect(later.tvl?.missing).toContain("veMEZO")
    // The savings vault (catalog id mezo-savings-smusd) is never a DEX
    // pool; it is beside the total, never in it.
    expect(later.tvl?.parts.map((part) => part.label)).not.toContain(
      "Savings vault",
    )
    expect(later.tvl?.missing).not.toContain("Savings vault")
    const dex = later.dex.status === "ok" ? later.dex.data : null
    expect(dex?.pools.map((pool) => pool.name)).not.toContain("Savings vault")
    expect(dex?.pools.map((pool) => pool.name)).toContain("mUSDC/MUSD CL10")
    expect(later.dex.status === "ok" && later.dex.data?.figure).toMatch(/^[$]/)
    // From the per-token rollups: the period per day, and the design's
    // figures (`-5H-NByPdL`).
    expect(
      labels(later.dex.status === "ok" ? (later.dex.data?.stats ?? []) : []),
    ).toEqual(["7d", "30d", expect.stringMatching(/^Peak /), "Liquidity"])
    expect(dex?.chart?.points).toHaveLength(30)
    expect(dex?.chart?.kind).toBe("flow")
    // TVL over the period: veBTC, trove collateral and DEX pools. The
    // headline is the chart's last day, the savings vault beside it.
    expect(later.tvl?.figure).toBe(later.tvl?.history?.points.at(-1)?.text)
    expect(later.tvl?.apart).toMatch(/^[$]/)
    expect(later.tvl?.history?.points).toHaveLength(30)
    expect(later.tvl?.change).toMatch(/^[+-]\$.* in 30d$/)
    expect(later.tvl?.unpriced).toEqual([])
    expect(
      page.activity.status === "ok" && page.activity.data.rows.length,
    ).toBe(10)
    // The live-shaped pokes (no lock, no actor) lead, and say only what
    // they know.
    const rows = page.activity.status === "ok" ? page.activity.data.rows : []
    expect(
      rows.filter((row) => row.action === "BOOST_POKE").map((row) => row.text),
    ).toEqual(Array(4).fill("Refreshed votes"))
    expect(rows.some((row) => row.text.endsWith(" on"))).toBe(false)
  })

  it("shows the period's days, counting a backfill back from its end", async () => {
    reset()
    const page = await networkOverview({ range: "30d" })
    if (page.transactions.status !== "ok" || page.active.status !== "ok") {
      throw new Error("no series")
    }
    expect(page.transactions.data.points).toHaveLength(30)
    expect(page.transactions.data.endLabel).toBe("9 Nov")
    expect(page.active.data.points).toHaveLength(30)
    expect(page.active.data.endLabel).toBe("31 Oct")
  })

  it("draws All by the week, its figures still from the days", async () => {
    reset()
    const page = await networkOverview({ range: "All" })
    if (page.transactions.status !== "ok" || page.active.status !== "ok") {
      throw new Error("no series")
    }
    const month = await networkOverview({ range: "30d" })
    const bars = page.transactions.data.points
    // The fixtures' days from 11 Dec 2025: a bar a week, not one a day.
    expect(bars.length).toBeLessThan(60)
    expect(bars[0]?.label).toBe("11 to 14 Dec")
    expect(bars[1]?.label).toBe("Week of 15 Dec")
    expect(bars.at(-1)?.label).toBe("9 Nov so far")
    expect(bars.at(-1)?.partial).toBe(true)
    // The axis starts at the first day there is, never padded.
    expect(page.transactions.data.startLabel).toBe("11 Dec")
    // The figure and the stats are the days', as at 30d.
    if (month.transactions.status !== "ok") throw new Error("no series")
    expect(page.transactions.data.figure).toBe(month.transactions.data.figure)
    expect(page.activeStats).toEqual(month.activeStats)
    expect(labels(page.transactionStats)).toEqual([
      "30d average",
      "Peak",
      "All time",
    ])
    expect(page.period.text).toBe("All")
  })

  it("draws a custom span's days, checked and named", async () => {
    reset()
    const page = await networkOverview({
      range: "90d",
      from: "2026-03-31",
      to: "2026-01-01",
    })
    if (page.transactions.status !== "ok") throw new Error("no series")
    expect(page.period).toMatchObject({
      range: null,
      from: "2026-01-01",
      to: "2026-03-31",
      text: "1 Jan to 31 Mar",
    })
    expect(page.transactions.data.points).toHaveLength(90)
    expect(page.transactions.data.startLabel).toBe("1 Jan")
    expect(page.transactions.data.endLabel).toBe("31 Mar")
    expect(page.values.tvl?.change).toMatch(/ from 1 Jan to 31 Mar$/)
    const dex = page.values.dex
    if (dex.status !== "ok" || dex.data?.chart == null)
      throw new Error("no dex")
    expect(dex.data.chart.points).toHaveLength(90)
    // Its figure is the span's last day, as the other panels' are.
    expect(dex.data.day).toBe("31 Mar")
    expect(page.transactions.data.latestDay).toBe("31 Mar")
    // A day that is no day leaves the range as asked.
    const odd = await networkOverview({
      range: "90d",
      from: "2026-02-31",
      to: "2026-03-31",
    })
    expect(odd.period.range).toBe("90d")
  })

  it("says none in a span outside a series' days, never yet", async () => {
    reset()
    // Daily active addresses are a backfill that ends 31 Oct.
    const page = await networkOverview({
      range: "30d",
      from: "2026-11-09",
      to: "2026-11-09",
    })
    if (page.active.status !== "ok") throw new Error("no series")
    expect(page.active.data).toMatchObject({
      computed: true,
      figure: null,
      outside: true,
    })
    render(
      createElement(SeriesBody, {
        name: "Daily active addresses",
        data: page.active.data,
        empty: "No active addresses yet",
      }),
    )
    expect(screen.getByText("None in this period")).toBeTruthy()
    expect(screen.queryByText("No active addresses yet")).toBeNull()
    // Within its days, as before.
    const inside = await networkOverview({
      range: "30d",
      from: "2026-10-01",
      to: "2026-10-31",
    })
    if (inside.active.status !== "ok") throw new Error("no series")
    expect(inside.active.data).toMatchObject({ outside: false })
    expect(inside.active.data.figure).not.toBeNull()
  })

  it("keeps DEX volume's toggle and says none in a span before its days", async () => {
    reset()
    // The fixture's volume starts 11 Dec 2025: a June 2025 span holds none
    // of it, and must not fall back to the snapshot's latest day.
    const page = await networkOverview({
      range: "30d",
      from: "2025-06-01",
      to: "2025-06-05",
    })
    if (page.values.dex.status !== "ok") throw new Error("no dex")
    expect(page.values.dex.data).toMatchObject({
      outside: true,
      day: null,
      pools: [],
    })
    // A chart keeps the panel's period toggle (DexPanel shows it for one).
    expect(page.values.dex.data?.chart).not.toBeNull()
    // The snapshot's latest day still stands in when no rollups are served.
    const latest = await networkOverview({ range: "30d" })
    if (latest.values.dex.status !== "ok") throw new Error("no dex")
    expect(latest.values.dex.data?.outside).toBeUndefined()
  })

  it("tells a series never computed from one with nothing in it", async () => {
    // As live: the jobs side has never written daily active addresses, so
    // the API answers no points and no first day.
    reset("filling")
    const page = await networkOverview({ range: "30d" })
    if (page.active.status !== "ok" || page.addresses.status !== "ok") {
      throw new Error("no series")
    }
    expect(page.active.data).toMatchObject({
      computed: false,
      figure: null,
      points: [],
    })
    expect(page.activeStats).toEqual([])
    expect(page.addresses.data.computed).toBe(true)
  })

  it("says not available yet while the database is not bound", async () => {
    reset("disabled")
    const page = await networkOverview({ range: "90d" })
    expect(page.period.range).toBe("90d")
    expect(page.addresses.status).toBe("disabled")
    expect(page.activity.status).toBe("disabled")
    expect(page.addressStats).toEqual([])
    expect(state.headers.get("x-scan-degraded")).toBe("1")
  })
})

describe("tokens", () => {
  it("lists every token from one read, with holders back", async () => {
    reset()
    const page = await tokensPage()
    if (page.table.status !== "ok") throw new Error("no table")
    const rows = page.table.data.rows
    // The listed tokens first, in their order, then the rest.
    expect(rows.slice(0, 3).map((row) => row.symbol)).toEqual([
      "BTC",
      "MEZO",
      "MUSD",
    ])
    const bySymbol = new Map(rows.map((row) => [row.symbol, row]))
    const btc = bySymbol.get("BTC")
    expect(btc?.price).toEqual({
      text: "$105,710",
      basis: "own",
      source: null,
    })
    expect(btc?.supplyUsd).toMatch(/^\$/)
    expect(btc?.week).not.toBeNull()
    expect(btc?.holders).toMatch(/^[0-9,]+$/)
    expect(bySymbol.get("MEZO")?.price).toEqual({
      text: "$0.1840",
      basis: "own",
      source: "Aerodrome MEZO/MUSD on Base",
    })
    const musd = bySymbol.get("MUSD")
    // The API's $1 for MUSD is never shown as its price, nor valued at it.
    expect(musd?.price).toBeNull()
    expect(musd?.priceMissing).toBe(true)
    expect(musd?.supplyUsd).toBeNull()
    expect(musd?.chains).toEqual(["Mezo", "Ethereum", "Base"])
    expect(musd?.onMezo).toBe("85.0% on Mezo")
    expect(bySymbol.get("MEZO")?.chains).toEqual([
      "Mezo",
      "Ethereum",
      "Base",
      "BNB Chain",
    ])
    expect(bySymbol.get("BTC")?.onMezo).toBeNull()
    expect(musd?.week).toBeNull()
    expect(musd?.supply).toMatch(/ MUSD$/)
    expect(musd?.slug).toBe("musd")
    expect(bySymbol.get("mcbBTC")?.price?.basis).toBe("btc")
    // No series row: said, never zero; sMUSD is unpriced.
    const smusd = bySymbol.get("sMUSD")
    expect(smusd?.supply).toBe("not-yet")
    expect(smusd?.holders).toBe("not-yet")
    expect(smusd?.price).toBeNull()
    // Not in the API's registry: a supply with no decimals is not guessed.
    expect(bySymbol.get("mbhBTC")?.supply).toBe("unknown")
    expect(bySymbol.get("mbhBTC")?.price).toBeNull()
    expect(page.table.data.incomplete).toBe(false)
    // As live: supply and holders for a few tokens, the registry for the rest.
    expect(page.table.data.tracked).toBe(
      rows.filter((row) => row.holders !== "not-yet").length,
    )
    expect(page.table.data.tracked).toBeLessThan(rows.length)
  })

  it("says a price too new for a 7d change has not enough history", async () => {
    // As live: the daily prices hold today only.
    reset("filling")
    const page = await tokensPage()
    if (page.table.status !== "ok") throw new Error("no table")
    const bySymbol = new Map(
      page.table.data.rows.map((row) => [row.symbol, row]),
    )
    expect(bySymbol.get("BTC")?.week).toBe("short")
    expect(bySymbol.get("MEZO")?.week).toBe("short")
    // Only an own price has a 7d change.
    expect(bySymbol.get("mcbBTC")?.week).toBeNull()
    const mezo = await tokenPage({ slug: "mezo", range: "30d" })
    const price = mezo.panels.find((panel) => panel.id === "price")
    expect(price?.stats?.slice(0, 2)).toEqual([
      { label: "7d", value: "Not enough history yet" },
      { label: "30d", value: "Not enough history yet" },
    ])
  })

  it("agrees with the token pages' latest supply and holders", async () => {
    reset()
    const list = await tokensPage()
    const page = await tokenPage({ slug: "musd", range: "30d" })
    if (list.table.status !== "ok") throw new Error("no table")
    const musd = list.table.data.rows.find((row) => row.symbol === "MUSD")
    const holders = page.facts.find((fact) => fact.label === "Holders on Mezo")
    expect(musd?.holders).toBe(holders?.value)
    const supply = page.facts.find((fact) => fact.label === "Supply")
    // "95,102 MUSD" on the page is "95.1k MUSD" in the list.
    expect(supply?.value.replace(/[^0-9]/g, "").slice(0, 3)).toBe(
      String(musd?.supply).replace(/[^0-9]/g, ""),
    )
  })

  it("degrades the whole table when nothing answers", async () => {
    reset("limited")
    const page = await tokensPage()
    expect(page.table.status).toBe("rate-limited")
  })

  it("draws MUSD from its supply, holders, savings and troves", async () => {
    reset()
    const page = await tokenPage({ slug: "musd", range: "30d" })
    expect(page.token.symbol).toBe("MUSD")
    expect(labels(page.facts)).toEqual([
      "Price",
      "Supply",
      "On Ethereum and Base",
      "Holders on Mezo",
      "Pool liquidity",
      "Collateral in troves",
    ])
    // Our on-chain price heads the page, never CoinGecko's or $1.
    expect(page.facts[0]?.value).toBe("$0.9936")
    expect(page.facts[0]?.note).toMatch(/^On chain, /)
    expect(page.facts[2]).toMatchObject({
      value: "2.83M",
      note: "14.9% of supply",
    })
    expect(page.crossChain.price.status).toBe("ok")
    expect(page.crossChain.history?.status).toBe("ok")
    expect(page.panels.map((panel) => panel.id)).toEqual([
      "supply",
      "holders",
      "collateral",
    ])
    // The savings vault and where MUSD sits follow after first paint.
    expect(page.later).toBe(true)
    const later = await musdLater({ range: "30d" })
    expect(later.panels.map((panel) => panel.id)).toEqual([
      "savings",
      "borrowed",
      "repaid",
      "pools",
    ])
    // Trove debt split per day (batch 2): borrowed and repaid, with the
    // other ways debt is cleared beside the repayments.
    const borrowed = later.panels.find((panel) => panel.id === "borrowed")
    expect(borrowed?.data.status === "ok" && borrowed.data.data.figure).toMatch(
      /MUSD$/,
    )
    expect(labels(borrowed?.stats ?? [])).toEqual([
      "Borrowed 30d",
      "Open troves",
    ])
    const repaid = later.panels.find((panel) => panel.id === "repaid")
    expect(labels(repaid?.stats ?? [])).toEqual([
      "Repaid 30d",
      "Redeemed 30d",
      "Liquidated 30d",
    ])
    const pools = later.panels.find((panel) => panel.id === "pools")
    expect(labels(pools?.stats ?? [])).toEqual(["Change 7d", "Change 30d"])
    const supply = page.panels[0]
    expect(labels(supply?.stats ?? [])).toEqual([
      "Change 30d",
      "Minted 30d to 31 Oct",
      "Burned 30d to 31 Oct",
    ])
    // Backfill-only: they end there by design, and say so.
    expect(supply?.stats.map((stat) => stat.note ?? null)).toEqual([
      null,
      "Not updated daily",
      "Not updated daily",
    ])
    expect(page.emissions).toBeNull()
    expect(state.headers.get("x-scan-cache")).toBe("fresh")
  })

  it("draws MEZO with its price, veMEZO and emissions", async () => {
    reset()
    const page = await tokenPage({ slug: "mezo", range: "All" })
    expect(page.period.range).toBe("All")
    expect(labels(page.facts)).toEqual([
      "Price",
      "Market cap",
      "Holders",
      "Locked as veMEZO",
      "Supply",
      "Bridged out",
    ])
    // The live price named by its source: the fixtures' MEZO price is the
    // Aerodrome fallback.
    expect(page.facts[0]?.note).toMatchObject({
      source: "Aerodrome MEZO/MUSD on Base",
    })
    expect(page.crossChain.history).toBeNull()
    expect(
      page.facts.find((fact) => fact.label === "Market cap")?.value,
    ).toMatch(/^\$/)
    const price = page.panels.find((panel) => panel.id === "price")
    expect(labels(price?.stats ?? [])).toEqual([
      "7d",
      "30d",
      "All time low",
      "All time high",
    ])
    // A custom span's own low and high, capitalised as labels are.
    const span = await tokenPage({
      slug: "mezo",
      range: "30d",
      from: "2026-01-01",
      to: "2026-03-31",
    })
    const spanPrice = span.panels.find((panel) => panel.id === "price")
    expect(labels(spanPrice?.stats ?? [])).toEqual(["7d", "30d", "Low", "High"])
    const locked = page.panels.find((panel) => panel.id === "locked")
    expect(labels(locked?.stats ?? [])).toEqual([
      "In USD",
      "Of supply",
      "Change 30d",
    ])
    expect(page.emissions?.status).toBe("ok")
  })

  it("values the tokens on Mezo and the stablecoins in USD", async () => {
    reset()
    const page = await tokensPage()
    expect(page.value?.figure).toMatch(/^[$]/)
    // MUSD without our venue price is never counted at $1.
    expect(page.value?.uncounted).toContain("MUSD")
    expect(page.stablecoins?.figure).toMatch(/^[$]/)
    expect(page.stablecoins?.data.status).toBe("ok")
    expect(page.stablecoins?.uncounted).toContain("MUSD")
    expect(labels(page.stablecoins?.stats ?? [])).toEqual(
      expect.arrayContaining(["mUSDC", "mUSDT"]),
    )
  })

  it("says where MUSD sits from Mezo's own supply reading", async () => {
    reset()
    const page = await musdLater({ range: "30d" })
    const sits = page.splits.find((split) => split.id === "sits")
    expect(sits?.segments.map((part) => part.label)).toEqual(
      expect.arrayContaining(["Stability Pool", "Bridged to other chains"]),
    )
    // DEX pools as one part; pool by pool is its own panel.
    expect(sits?.segments.map((part) => part.label)).toEqual([
      "DEX pools",
      "Stability Pool",
      "Bridged to other chains",
      "Wallets and other contracts",
    ])
    const byPool = page.splits.find((split) => split.id === "by-pool")
    expect(byPool?.segments.map((part) => part.label)).toEqual([
      expect.stringMatching(/MUSD/),
      expect.stringMatching(/MUSD/),
      expect.stringMatching(/MUSD/),
      expect.stringMatching(/MUSD/),
      "Other pools",
    ])
    expect(byPool?.mismatch).toBeNull()
    expect(labels(sits?.stats ?? [])).toEqual([
      "Supply on Mezo",
      "Open troves",
      "Trove debt",
      "Collateral ratio",
    ])
    // Shares are of the whole as read; a mismatch is said, not hidden.
    const shares = sits?.segments.reduce((sum, part) => sum + part.bps, 0)
    expect(sits?.mismatch === null ? shares : 10_000).toBeLessThanOrEqual(
      10_000,
    )
  })

  it("splits MEZO's supply and its latest emissions", async () => {
    reset()
    const page = await tokenPage({ slug: "mezo", range: "30d" })
    expect(page.splits.map((split) => split.id)).toEqual([
      "supply-split",
      "emissions-split",
    ])
    const emissions = page.splits.find(
      (split) => split.id === "emissions-split",
    )
    expect(emissions?.segments.map((part) => part.label)).toEqual([
      "To gauges",
      "Rebase to veMEZO",
      "Other",
    ])
    expect(emissions?.note).toMatch(/^MEZO, [$]/)
  })

  it("counts new holders from the replayed balances while the count is young", async () => {
    // As live: Blockscout's holder count began days ago.
    reset("filling")
    const page = await tokenPage({ slug: "musd", range: "30d" })
    const holders = page.panels.find((panel) => panel.id === "holders")
    for (const stat of holders?.stats ?? []) {
      expect(stat.value).not.toBe("Not enough history yet")
    }
  })

  it("degrades each panel while the database is not bound", async () => {
    reset("disabled")
    const page = await tokenPage({ slug: "mezo", range: "30d" })
    expect(page.panels.every((panel) => panel.data.status === "disabled")).toBe(
      true,
    )
    expect(page.facts).toEqual([])
    expect(page.emissions?.status).toBe("disabled")
    expect(page.crossChain.supply.status).toBe("disabled")
    expect(page.crossChain.pools.status).toBe("disabled")
  })

  it("labels MEZO's price by its source, as plain text", async () => {
    expect(priceSourceLabel("coingecko")).toBe("CoinGecko")
    expect(priceSourceLabel("aerodrome-cl")).toBe("Aerodrome MEZO/MUSD on Base")
    expect(priceSourceLabel("mezo-oracle")).toBeNull()
    reset()
    const page = await tokensPage()
    if (page.table.status !== "ok") throw new Error("no table")
    const rows = new Map(page.table.data.rows.map((row) => [row.symbol, row]))
    // The fixtures' MEZO price is the Aerodrome fallback.
    expect(rows.get("MEZO")?.price?.source).toBe("Aerodrome MEZO/MUSD on Base")
    // BTC is the Mezo oracle's: no source label, no basis line.
    expect(rows.get("BTC")?.price?.source).toBeNull()
  })

  it("finds a token page by slug, symbol or address", () => {
    expect(tokenSlugOf("musd")).toEqual({ slug: "musd", canonical: true })
    expect(tokenSlugOf("MEZO")).toEqual({ slug: "mezo", canonical: false })
    expect(tokenSlugOf("0xDD468A1DDC392DCDBEF6DB6E34E89AA338F9F186")).toEqual({
      slug: "musd",
      canonical: false,
    })
    expect(tokenSlugOf("btc")).toBeNull()
    expect(tokenSlugOf("nope")).toBeNull()
  })
})

describe("total value locked", () => {
  const e18 = 10n ** 18n
  const day = (text: string, dollars: bigint) => ({
    day: text,
    usd: dollars * e18,
    partial: false,
  })

  it("keeps the savings vault beside the figure with no history too", () => {
    const tvl = tvlView([
      { label: "veBTC", usd: 300n * e18 },
      { label: "Savings vault", usd: 50n * e18 },
    ])
    // Same meaning as with the chart drawn: a failed history read must not
    // make the figure jump by the vault.
    expect(tvl?.figure).toBe("$300")
    expect(tvl?.parts.map((part) => part.label)).toEqual(["veBTC"])
    expect(tvl?.apart).toBe("$50")
    expect(tvl?.history).toBeNull()
  })

  it("leads with the chart's last day, the vault beside it", () => {
    const tvl = tvlView(
      [
        { label: "veBTC", usd: 310n * e18 },
        { label: "DEX pools", usd: 90n * e18 },
        { label: "Savings vault", usd: 50n * e18 },
      ],
      {
        days: [day("2026-11-10", 100n), day("2026-11-11", 380n)],
        latest: [
          { label: "veBTC", usd: 300n * e18 },
          { label: "DEX pools", usd: 80n * e18 },
        ],
        unpriced: [],
        name: "30d",
        from: "2026-10-13",
      },
    )
    // The hovered last day and the headline agree.
    expect(tvl?.figure).toBe("$380")
    expect(tvl?.history?.points.at(-1)?.text).toBe("$380")
    expect(tvl?.parts.map((part) => [part.label, part.value])).toEqual([
      ["veBTC", "$300"],
      ["DEX pools", "$80"],
    ])
    expect(tvl?.apart).toBe("$50")
    // The history starts after the range: its change says since when.
    expect(tvl?.change).toBe("+$280 since 10 Nov")
  })

  it("names the range when the history covers it", () => {
    const tvl = tvlView([{ label: "veBTC", usd: 1n }], {
      days: [day("2026-10-13", 500n), day("2026-11-11", 380n)],
      latest: [{ label: "veBTC", usd: 380n * e18 }],
      unpriced: [],
      name: "30d",
      from: "2026-10-13",
    })
    expect(tvl?.change).toBe("-$120 in 30d")
  })
})

describe("sums over calendar days", () => {
  const at = Date.parse("2026-11-15T12:00:00Z") / 1000
  const flow = (days: string[], firstDay: string | null) => ({
    metric: "musd.borrowed",
    kind: "flow" as const,
    unit: "amount" as const,
    points: days.map((day) => ({
      day,
      value: 1,
      text: "1",
      decimal: "1",
      partial: false,
    })),
    latest: null,
    firstDay,
    endsOn: null,
  })

  it("sums the 30 whole days before today, a day with no row as zero", () => {
    const view = flow(["2026-10-16", "2026-11-01", "2026-11-15"], "2025-05-19")
    expect(calendarSum(view, 30, at)).toEqual({
      sum: 2n * 10n ** 18n,
      since: null,
    })
  })

  it("says since when, while the series starts inside the window", () => {
    // Before the trove history is re-aggregated, only the days since the
    // jobs deploy have rows: two days are not 30.
    const view = flow(["2026-11-13", "2026-11-14"], "2026-11-13")
    expect(calendarSum(view, 30, at)).toEqual({
      sum: 2n * 10n ** 18n,
      since: "2026-11-13",
    })
    // A sparse flow takes the coverage of its densest sibling.
    const sparse = flow(["2026-11-14"], "2026-11-14")
    expect(calendarSum(sparse, 30, at, "2026-11-13")).toEqual({
      sum: 10n ** 18n,
      since: "2026-11-13",
    })
  })

  it("has no sum while the series starts today", () => {
    // Today is never summed: "since 15 Nov: 0" would read as no borrowing.
    const view = flow(["2026-11-15"], "2026-11-15")
    expect(calendarSum(view, 30, at)).toBeNull()
  })

  it("knows nothing of a series never computed", () => {
    expect(calendarSum(flow([], null), 30, at)).toBeNull()
  })
})
