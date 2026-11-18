import type { ScanCrossChainPool } from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import {
  bpsText,
  bridgeView,
  pegPrice,
  percentYear,
  poolMatches,
  poolRow,
  poolsView,
  pricesByPool,
  priceView,
  shareText,
  supplyView,
} from "./crosschain-views"
import { scanFixture } from "./fixtures"
import type { FixtureScenario } from "./fixtures/shared"
import { scanSchemas } from "./schemas"

// The cross-chain views over the fixtures, which parse with the API's
// contracts: rounding, the $25,000 line, the "est." rule and every empty
// state (`filling` is the API over empty tables, production's first state).

function read<T>(
  path: string,
  schema: { parse: (body: unknown) => T },
  scenario: FixtureScenario = "normal",
  query = new URLSearchParams(),
): T {
  return schema.parse(scanFixture(path, query, scenario).body)
}

const prices = (scenario: FixtureScenario = "normal") =>
  read("crosschain/prices", scanSchemas.crossChainPrices, scenario)
const pools = (scenario: FixtureScenario = "normal") =>
  read("crosschain/pools", scanSchemas.crossChainPools, scenario).data
const supply = (scenario: FixtureScenario = "normal") =>
  read("crosschain/supply", scanSchemas.crossChainSupply, scenario).data

function pool(id: string): ScanCrossChainPool {
  const found = pools().find((each) => each.id === id)
  if (found === undefined) throw new Error(`No fixture pool ${id}`)
  return found
}

describe("cross-chain fixtures", () => {
  it("parse with their contracts in every scenario", () => {
    for (const scenario of ["normal", "filling", "delayed"] as const) {
      expect(() => prices(scenario)).not.toThrow()
      expect(() => pools(scenario)).not.toThrow()
      expect(() => supply(scenario)).not.toThrow()
      for (const asset of ["musd", "mezo"]) {
        expect(() =>
          read(
            "crosschain/bridge-flows",
            scanSchemas.bridgeFlows,
            scenario,
            new URLSearchParams({ asset }),
          ),
        ).not.toThrow()
      }
      expect(() =>
        read(
          "crosschain/prices/history",
          scanSchemas.crossChainPriceHistory,
          scenario,
        ),
      ).not.toThrow()
    }
  })

  it("answers 503 when disabled", () => {
    expect(
      scanFixture("crosschain/pools", new URLSearchParams(), "disabled").status,
    ).toBe(503)
  })
})

describe("number text", () => {
  it("rounds prices half up, four places for the headline, five for venues", () => {
    expect(pegPrice("0.993611")).toBe("$0.9936")
    expect(pegPrice("0.99365")).toBe("$0.9937")
    expect(pegPrice("0.993615", 5)).toBe("$0.99362")
  })

  it("writes yearly rates with two places, whole from 100%", () => {
    expect(percentYear("8.244")).toBe("8.24%")
    expect(percentYear("0.005")).toBe("0.01%")
    expect(percentYear("370.15")).toBe("370%")
    expect(percentYear("-1.5")).toBe("-1.50%")
  })

  it("writes basis points and shares", () => {
    expect(bpsText(6)).toBe("0.06%")
    expect(bpsText(-70)).toBe("-0.70%")
    expect(shareText(1_380, true)).toBe("13.8%")
    expect(shareText(5, true)).toBe("0.05%")
    expect(shareText(0, true)).toBe("<0.01%")
    expect(shareText(0, false)).toBe("0%")
  })
})

describe("price", () => {
  it("heads MUSD with our on-chain price and lists each venue under it", () => {
    const body = prices()
    const view = priceView(body.data.musd)
    expect(view.headline?.text).toBe("$0.9936")
    expect(view.headline?.basis).toBe(
      "On chain, liquidity-weighted across 3 venues",
    )
    expect(view.headline?.at).toMatch(/UTC$/)
    expect(view.headline?.stale).toBe(false)
    expect(view.comparison).toBeNull()
    expect(view.spread).toBe("0.06%")
    expect(view.peg).toBe("Under $1.00 by 0.64%")
    const tigris = view.venues.find((venue) => venue.id === "tigris-musdc-musd")
    expect(tigris?.price).toBe("$0.99412")
    expect(tigris?.where).toBe("Tigris on Mezo")
    // (0.99412 - 0.993611) / 0.993611 = 0.0512%: 5 basis points.
    expect(tigris?.vsHeadline).toEqual({ text: "+0.05%", tone: "pos" })
    const curve = view.venues.find((venue) => venue.id === "curve-musd-2pool")
    expect(curve?.vsHeadline).toEqual({ text: "0.00%", tone: "flat" })
    expect(curve?.pool).toEqual({
      chain: "ethereum",
      pool: "0xb5571e76693ba60110b5811dd650ffefce1c955f",
    })
  })

  it("never heads MUSD with CoinGecko: its fallback is a comparison line", () => {
    const musd = {
      ...prices().data.musd,
      basis: "coingecko" as const,
      basis_label: "CoinGecko",
      price_usd: "0.993",
      venues: [],
    }
    const view = priceView(musd)
    expect(view.headline).toBeNull()
    expect(view.comparison?.text).toBe("$0.9930")
    expect(view.peg).toBeNull()
  })

  it("heads MEZO with CoinGecko, named as its source", () => {
    const mezo = {
      ...prices().data.mezo,
      basis: "coingecko" as const,
      basis_label: "CoinGecko",
    }
    const view = priceView(mezo)
    expect(view.headline?.text).toBe("$0.1840")
    expect(view.headline?.basis).toBe("CoinGecko")
    expect(view.basis).toBe("coingecko")
    expect(view.venues).toEqual([])
  })

  it("names MEZO's Aerodrome fallback", () => {
    const view = priceView(prices().data.mezo)
    expect(view.basis).toBe("aerodrome-cl")
    expect(view.headline?.basis).toBe(
      "Aerodrome MEZO/MUSD on Base, a thin pool",
    )
  })

  it("marks a price older than 10 minutes", () => {
    const view = priceView(prices("delayed").data.musd)
    expect(view.headline?.stale).toBe(true)
    expect(view.venues.every((venue) => venue.stale)).toBe(true)
  })

  it("shows no price at all before the first reading, never $1", () => {
    for (const asset of ["musd", "mezo"] as const) {
      const view = priceView(prices("filling").data[asset])
      expect(view.headline).toBeNull()
      expect(view.comparison).toBeNull()
      expect(view.venues).toEqual([])
      expect(view.spread).toBeNull()
      expect(view.peg).toBeNull()
    }
  })
})

describe("supply", () => {
  it("counts MUSD once: Mezo's total, other chains inside the lock", () => {
    const view = supplyView(supply().musd, ["mezo", "ethereum", "base"])
    expect(view.total).toBe("18,986,044.82")
    expect(view.totalCompact).toBe("18.99M")
    expect(view.locked).toBe("2,841,641.13")
    expect(view.rows.map((row) => [row.name, row.amount, row.share])).toEqual([
      ["Mezo", "16,144,403.69", "85.0%"],
      ["Ethereum", "2,619,241.07", "13.8%"],
      ["Base", "214,586.10", "1.1%"],
      // 2,841,641.13 locked - 2,833,827.17 minted elsewhere.
      ["In transit or on other chains", "7,813.96", "0.04%"],
    ])
    expect(view.elsewhere).toEqual({
      amount: "2,833,827.17",
      compact: "2.83M",
      share: "14.9%",
    })
    expect(view.mismatch).toBe(false)
    expect(view.missing).toEqual([])
  })

  it("adds the rows up to Mezo's total, to the unit", () => {
    const view = supplyView(supply().mezo, ["mezo", "ethereum", "base", "bsc"])
    const units = (text: string) => BigInt(text.replace(/[,.]/g, ""))
    const sum = view.rows.reduce((total, row) => total + units(row.amount), 0n)
    expect(sum).toBe(units(view.total ?? "0"))
    expect(view.rows.map((row) => row.name)).toEqual([
      "Mezo",
      "Base",
      "Ethereum",
      "BNB Chain",
      "In transit or on other chains",
    ])
  })

  it("says a chain is missing instead of guessing what is in transit", () => {
    const musd = supply().musd
    const view = supplyView(
      { ...musd, chains: musd.chains.filter((each) => each.chain !== "base") },
      ["mezo", "ethereum", "base"],
    )
    expect(view.missing).toEqual(["Base"])
    expect(view.elsewhere).toBeNull()
    expect(view.rows.map((row) => row.name)).toEqual(["Mezo", "Ethereum"])
  })

  it("flags other chains adding up to more than the lock", () => {
    const musd = supply().musd
    const chains = musd.chains.map((each) =>
      each.chain === "mezo" ? { ...each, locked: "1000" } : each,
    )
    const view = supplyView({ ...musd, chains }, ["mezo", "ethereum", "base"])
    expect(view.mismatch).toBe(true)
    expect(view.rows.some((row) => row.chain === "transit")).toBe(false)
  })

  it("is empty before the first reading", () => {
    const view = supplyView(supply("filling").musd, [
      "mezo",
      "ethereum",
      "base",
    ])
    expect(view.total).toBeNull()
    expect(view.rows).toEqual([])
    expect(view.missing).toEqual(["Mezo", "Ethereum", "Base"])
  })
})

describe("pools", () => {
  const none = new Map<string, string>()

  it("hides pools under $25,000 by default, keeping uncounted ones", () => {
    const view = poolsView(pools(), none, {
      chain: "all",
      asset: "all",
      small: false,
    })
    const ids = view.rows.map((row) => row.id)
    expect(ids).not.toContain("mezo-tigris-mezo-btc-cl")
    expect(ids).not.toContain("base-aerodrome-mezo-musd")
    expect(ids).not.toContain("base-aerodrome-mezo-musd-legacy")
    expect(view.hidden).toBe(3)
    // Largest first; pools with no figures yet after the rest.
    expect(view.rows[0]?.title).toBe("MUSD/2pool")
    expect(view.rows.at(-1)?.liquidity).toBeNull()
    const shown = poolsView(pools(), none, {
      chain: "all",
      asset: "all",
      small: true,
    })
    expect(shown.hidden).toBe(0)
    expect(shown.rows.length).toBe(view.rows.length + 3)
  })

  it("draws the line at exactly $25,000", () => {
    const at = { ...pool("mezo-tigris-musd-btc-cl"), tvl_usd: "25000" }
    const under = { ...at, tvl_usd: "24999.99" }
    expect(poolRow(at, none)?.aboveLine).toBe(true)
    expect(poolRow(under, none)?.aboveLine).toBe(false)
    expect(poolRow(at, none)?.rates.fees).toEqual({
      kind: "value",
      text: "28.60%",
      est: true,
      from: false,
    })
    expect(poolRow(under, none)?.rates.fees).toEqual({ kind: "hidden" })
    expect(poolRow(under, none)?.rates.total).toEqual({ kind: "hidden" })
  })

  it("titles Tigris pools with the pool type their gauges show", () => {
    const titles = [
      "mezo-tigris-musd-btc-cl",
      "mezo-tigris-musd-btc-classic",
      "mezo-tigris-musdc-musd-stable",
      "mezo-tigris-mezo-btc-cl",
    ].map((id) => poolRow(pool(id), none)?.title)
    expect(titles).toEqual([
      "BTC/MUSD CL200",
      "BTC/MUSD Volatile",
      "mUSDC/MUSD Stable",
      "MEZO/BTC CL2000",
    ])
    // The fee the title no longer carries moves to the line under it.
    expect(poolRow(pool("mezo-tigris-musd-btc-cl"), none)?.where).toBe(
      "Tigris on Mezo, 0.3% fee",
    )
    expect(poolRow(pool("mezo-tigris-musd-btc-classic"), none)?.where).toBe(
      "Tigris on Mezo",
    )
    // Other venues keep their own names.
    expect(poolRow(pool("ethereum-curve-musd-2pool"), none)?.title).toBe(
      "MUSD/2pool",
    )
  })

  it("never shows the thin pool's 370% estimate", () => {
    const row = poolRow(pool("mezo-tigris-mezo-btc-cl"), none)
    expect(row?.liquidity).toBe("$2,398")
    expect(row?.rates.fees).toEqual({ kind: "hidden" })
    expect(row?.rates.total).toEqual({ kind: "hidden" })
  })

  it("marks our own estimates est., not the sources' figures", () => {
    const curve = poolRow(pool("ethereum-curve-musd-2pool"), none)
    expect(curve?.rates.fees).toMatchObject({ text: "0.27%", est: false })
    expect(curve?.rates.rewards).toMatchObject({ text: "8.16%", est: false })
    expect(curve?.rates.merkl).toEqual({ kind: "none" })
    expect(curve?.rates.gauge).toEqual({ kind: "not-yet" })
    // The gauge's MEZO is not a rate yet: the total is "from" what is known.
    expect(curve?.rates.total).toEqual({
      kind: "value",
      text: "8.43%",
      est: false,
      from: true,
    })
    const tigris = poolRow(pool("mezo-tigris-musdc-musd-cl"), none)
    expect(tigris?.rates.fees).toMatchObject({ est: true })
    expect(tigris?.rates.rewards).toMatchObject({ est: true })
    expect(tigris?.rates.total).toMatchObject({ text: "4.35%", est: true })
    const gauged = poolRow(
      {
        ...pool("ethereum-curve-musd-2pool"),
        apr: {
          fees: "0.27",
          rewards: null,
          merkl: null,
          gauge: "1.02",
          total: "1.29",
        },
      },
      none,
    )
    expect(gauged?.rates.gauge).toMatchObject({ text: "1.02%", est: true })
  })

  it("names the venue, chain, links and MUSD's price there", () => {
    const body = prices()
    const row = poolRow(
      pool("ethereum-curve-musd-2pool"),
      pricesByPool(body.data.musd.venues),
    )
    expect(row?.where).toBe("Curve on Ethereum")
    expect(row?.tickers).toEqual(["MUSD", "mUSDC", "mUSDT"])
    expect(row?.priceHere).toBe("$0.99361")
    expect(row?.explorer?.url).toBe(
      "https://etherscan.io/address/0xb5571e76693ba60110b5811dd650ffefce1c955f",
    )
    const v4 = poolRow(pool("ethereum-uniswap-v4-usdc-musd"), none)
    expect(v4?.explorer).toBeNull()
    expect(v4?.title).toBe("USDC/MUSD 0.01%")
    const vault = poolRow(pool("mezo-savings-smusd"), none)
    expect(vault?.title).toBe("Savings vault")
    expect(vault?.volume).toEqual({ kind: "none" })
    expect(vault?.explorer).toBeNull()
  })

  it("marks the legacy Aerodrome pools", () => {
    const legacy = pools().filter((each) => each.legacy)
    expect(legacy.map((each) => each.id)).toEqual([
      "base-aerodrome-musd-usdc-legacy",
      "base-aerodrome-mezo-musd-legacy",
    ])
    for (const each of legacy) {
      const row = poolRow(each, none)
      expect(row?.legacy).toBe(true)
      expect(row?.title).not.toMatch(/legacy/)
    }
  })

  it("adds liquidity once per pool, per chain, without supply", () => {
    const view = poolsView(pools(), none, {
      chain: "all",
      asset: "all",
      small: false,
    })
    // 3,355,432.18 + 819,244.6 + 214,917.3 + 56,133.7 + 34,664.1 +
    // 70,594.4 + 1,190,220.5 + 4,312.4 + 2,397.6 + 1,880.3 = 5,749,797.08
    expect(view.total).toEqual({ text: "$5.75M", pools: 16, counted: 10 })
    expect(view.chains.map((chain) => [chain.name, chain.text])).toEqual([
      ["Mezo", "$1.51M"],
      ["Ethereum", "$3.41M"],
      ["Base", "$825.4k"],
    ])
  })

  it("filters by chain and token, counting each choice", () => {
    const view = poolsView(pools(), none, {
      chain: "base",
      asset: "mezo",
      small: true,
    })
    expect(view.rows.map((row) => row.id)).toEqual([
      "base-aerodrome-mezo-musd",
      "base-aerodrome-mezo-musd-legacy",
    ])
    expect(view.counts.chain.base).toBe(2)
    // Every Base pool has MUSD on one side.
    expect(view.counts.asset.musd).toBe(4)
  })

  it("lists the catalog with nothing counted before the first snapshot", () => {
    const view = poolsView(pools("filling"), none, {
      chain: "all",
      asset: "all",
      small: false,
    })
    expect(view.rows.length).toBe(16)
    expect(view.hidden).toBe(0)
    expect(view.total.text).toBeNull()
    for (const row of view.rows) {
      expect(row.liquidity).toBeNull()
      expect(row.aboveLine).toBeNull()
      // A savings vault has no swap volume, counted or not.
      expect(row.volume).toEqual(
        row.id === "mezo-savings-smusd" ? { kind: "none" } : null,
      )
      expect(row.rates.total.kind).not.toBe("value")
    }
  })
})

describe("bridge", () => {
  it("totals every route and the recent days", () => {
    const flows = read(
      "crosschain/bridge-flows",
      scanSchemas.bridgeFlows,
      "normal",
      new URLSearchParams({ asset: "musd" }),
    )
    const view = bridgeView(flows)
    expect(view.routes[0]).toEqual({
      from: "Mezo",
      to: "Ethereum",
      transfers: "6,676",
      usd: "$934,420",
    })
    expect(view.total).toBe("$1,531,685")
    expect(view.transfers).toBe("11,475")
    expect(view.recent).toEqual({ usd: "$50,328", transfers: "37", days: 2 })
    expect(view.missing).toBeNull()
  })

  it("says why there is nothing: not read yet, or MEZO unsupported", () => {
    const musd = bridgeView(
      read(
        "crosschain/bridge-flows",
        scanSchemas.bridgeFlows,
        "filling",
        new URLSearchParams({ asset: "musd" }),
      ),
    )
    expect(musd).toMatchObject({ total: null, missing: "not-yet" })
    const mezo = bridgeView(
      read(
        "crosschain/bridge-flows",
        scanSchemas.bridgeFlows,
        "normal",
        new URLSearchParams({ asset: "mezo" }),
      ),
    )
    expect(mezo.missing).toBe("unsupported")
  })
})

describe("pool search", () => {
  it("matches every word against pair, fee, venue and chain", () => {
    expect(poolMatches("curve 2pool", "name")).toEqual([
      {
        title: "MUSD/2pool",
        where: "Curve on Ethereum",
        path: "/pools/ethereum/0xb5571e76693ba60110b5811dd650ffefce1c955f",
      },
    ])
    const base = poolMatches("mezo musd base", "name", 10)
    expect(base.map((pool) => pool.where)).toEqual([
      "Aerodrome on Base",
      "Aerodrome on Base, legacy pool",
    ])
    expect(poolMatches("savings", "name")[0]?.path).toBe(
      "/pools/0xb4d498029af77680cd1ef828b967f010d06c51cc",
    )
  })

  it("matches an address or its start, and caps the list", () => {
    expect(poolMatches("0xb5571e", "address-prefix")).toHaveLength(1)
    expect(poolMatches("musd", "name")).toHaveLength(5)
    expect(poolMatches("m", "name")).toEqual([])
    expect(poolMatches("nothing here", "name")).toEqual([])
    expect(poolMatches("btc cl200", "name").map((hit) => hit.title)).toEqual([
      "BTC/MUSD CL200",
    ])
    expect(poolMatches("btc volatile", "name").map((hit) => hit.title)).toEqual(
      ["BTC/MUSD Volatile"],
    )
    expect(poolMatches("musd 0.3%", "name")[0]?.title).toBe("BTC/MUSD CL200")
  })
})

describe("pools with Mezo's daily rows missing (GeckoTerminal 429)", () => {
  const none = new Map<string, string>()
  const partial = () => pools("partial")

  it("still lists every pool, none hidden for lack of a figure", () => {
    const view = poolsView(partial(), none, {
      chain: "mezo",
      asset: "all",
      small: false,
    })
    // Seven Tigris pools and the savings vault: the vault keeps its
    // DefiLlama liquidity, the rest have none and stay listed.
    expect(view.rows).toHaveLength(8)
    expect(view.hidden).toBe(0)
    expect(view.chains.find((chain) => chain.chain === "mezo")).toMatchObject({
      text: "$1.19M",
      pools: 8,
      counted: 1,
    })
    for (const row of view.rows.filter((each) => each.venue === "Tigris")) {
      expect(row.liquidity).toBeNull()
      expect(row.volume).toBeNull()
      expect(row.aboveLine).toBeNull()
    }
  })

  it("shows no rate for a pool whose liquidity is not available", () => {
    // No row, but the API adds Pro's emission rate and the gauge.
    const pool = partial().find(
      (each) => each.id === "mezo-tigris-musdc-musd-cl",
    )
    if (pool === undefined) throw new Error("no pool")
    expect(pool.day).toBeNull()
    expect(pool.apr.rewards).toBe("1.12")
    const row = poolRow(pool, none)
    expect(row?.rates.rewards).toEqual({ kind: "not-yet" })
    expect(row?.rates.total).toEqual({ kind: "not-yet" })
    expect(row?.rates.gauge).toEqual({ kind: "not-yet" })
    expect(row?.gauge?.name).toBe("mUSDC/MUSD 0.05%")
  })

  it("says not available for a row whose source failed, never zero", () => {
    const pool = partial().find((each) => each.id === "mezo-tigris-musd-btc-cl")
    if (pool === undefined) throw new Error("no pool")
    expect(pool.day).not.toBeNull()
    const row = poolRow(pool, none)
    expect(row?.liquidity).toBeNull()
    expect(row?.volume).toBeNull()
    expect(row?.rates.fees).toEqual({ kind: "not-yet" })
    expect(row?.rates.total).toEqual({ kind: "not-yet" })
  })
})
