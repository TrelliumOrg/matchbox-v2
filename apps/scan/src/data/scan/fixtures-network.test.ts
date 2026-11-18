import { describe, expect, it } from "vitest"
import { scanFixture } from "./fixtures"
import { networkFixtures } from "./fixtures/network"
import { fixtureNow } from "./fixtures/shared"
import { type ScanSchemaName, scanSchemas } from "./schemas"
import { listedTokens, tokenBySlug } from "./token-list"

/**
 * The /internal/scan answers the Network and Tokens pages read, with the
 * queries they send, parse with their route contracts. `/tokens` is
 * these pages' own fixture (network.ts); the series, prices and activity
 * routes are the shared fixtures' (voting.ts, entities.ts).
 */

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)
const today = day(fixtureNow)
const monthAgo = day(fixtureNow - 37 * 86_400)
const twoYears = day(fixtureNow - 729 * 86_400)
const musd = tokenBySlug("musd").address
const mezo = tokenBySlug("mezo").address

function series(metric: string, dimension = "", from = monthAgo) {
  return { metric, dimension, from, to: today }
}

const cases: [string, Record<string, string>, ScanSchemaName][] = [
  ["tokens", {}, "tokenList"],
  ["activity", { limit: "10" }, "activityPage"],
  ["epochs", { limit: "100" }, "epochPage"],
  ["prices/btc", { from: day(fixtureNow - 14 * 86_400), to: today }, "prices"],
  ["prices/mezo", { from: monthAgo, to: today }, "prices"],
  ["series", series("chain.addresses_total"), "series"],
  ["series", series("chain.new_addresses", "", twoYears), "series"],
  ["series", series("chain.active_addresses", "", twoYears), "series"],
  ["series", series("chain.transactions"), "series"],
  ["series", series("chain.transactions_total"), "series"],
  ["series", series("token.minted", musd, twoYears), "series"],
  ["series", series("token.burned", musd, twoYears), "series"],
  ["series", series("musd.trove_coll"), "series"],
  ["series", series("savings.net"), "series"],
  ["series", series("savings.deposited"), "series"],
  ["series", series("savings.withdrawn"), "series"],
  ["series", series("savings.yield_claimed"), "series"],
  ["series", series("escrow.supply", "vemezo"), "series"],
  ["series", series("token.total_supply", mezo), "series"],
  ...listedTokens.flatMap(
    (token): [string, Record<string, string>, ScanSchemaName][] => [
      ["series", series("token.total_supply", token.address), "series"],
      ["series", series("token.holders", token.address), "series"],
    ],
  ),
]

describe("network fixtures", () => {
  it("adds only the token list", () => {
    expect(networkFixtures.map((route) => route.pattern.source)).toEqual([
      "^tokens$",
    ])
    expect(scanFixture("tokens", new URLSearchParams({ q: "x" })).status).toBe(
      400,
    )
  })

  it("lists the same latest closes and prices as the series and prices", () => {
    const list = scanSchemas.tokenList.parse(
      scanFixture("tokens", new URLSearchParams()).body,
    )
    const close = (metric: string, token: string) =>
      scanSchemas.series
        .parse(
          scanFixture("series", new URLSearchParams(series(metric, token)))
            .body,
        )
        .data.points.at(-1)
    const row = (address: string) =>
      list.data.find((item) => item.address === address)
    expect(row(musd)?.holders?.value).toBe(close("token.holders", musd)?.value)
    expect(row(mezo)?.supply?.value).toBe(
      close("token.total_supply", mezo)?.value,
    )
    expect(row(mezo)?.supply?.day).toBe(today)
    const lastPrice = (token: string) =>
      scanSchemas.prices
        .parse(
          scanFixture(`prices/${token}`, new URLSearchParams(series("", "")))
            .body,
        )
        .data.points.at(-1)?.price
    expect(row(mezo)?.price_usd).toBe(lastPrice("mezo"))
    expect(list.prices.btc_usd).toBe(lastPrice("btc"))
    // A registered token with no series row: null figures, never zero.
    const smusd = list.data.find((item) => item.symbol === "sMUSD")
    expect(smusd?.supply).toBeNull()
    expect(smusd?.holders).toBeNull()
  })

  it.each(cases)("%s %o parses with its contract", (path, query, schema) => {
    const answer = scanFixture(path, new URLSearchParams(query))
    expect(answer.status, path).toBe(200)
    const parsed = scanSchemas[schema].safeParse(answer.body)
    expect(parsed.error?.issues.slice(0, 3) ?? [], path).toEqual([])
  })

  it("ends the backfill-only series and keeps the live ones going", () => {
    const backfill = scanFixture(
      "series",
      new URLSearchParams(series("chain.active_addresses", "", twoYears)),
    )
    const live = scanFixture(
      "series",
      new URLSearchParams(series("chain.addresses_total")),
    )
    const endsOn = (body: unknown) => scanSchemas.series.parse(body).data.endsOn
    expect(endsOn(backfill.body)).not.toBeNull()
    expect(endsOn(live.body)).toBeNull()
  })

  it("degrades every read the same way while the database is unbound", () => {
    for (const [path, query] of cases) {
      const answer = scanFixture(path, new URLSearchParams(query), "disabled")
      expect(answer.status, path).toBe(503)
    }
  })
})
