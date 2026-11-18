import { MORPHO_MARKETS } from "@matchbox/chain"
import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  reads: [] as string[],
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))
// Every request a loader sends the API, as `path?query`.
vi.mock("./scan/fixtures", async (original) => {
  const fixtures = await original<typeof import("./scan/fixtures")>()
  return {
    ...fixtures,
    scanFixture: (...args: Parameters<typeof fixtures.scanFixture>) => {
      const [path, query] = args
      state.reads.push(`${path}?${query.toString()}`)
      return fixtures.scanFixture(...args)
    },
  }
})

const { networkOverview } = await import("./network.server")
const { tokenPage, musdLater } = await import("./token-pages.server")
const { locksPage } = await import("./locks.server")
const { gaugePage } = await import("./gauges.server")
const { borrowOverview, borrowCharts, marketPage } = await import(
  "./borrow.server"
)
const { demoKindCards } = await import(
  "@matchbox/contracts/read-models/fixtures"
)
const { fixtureNow } = await import("./scan/fixtures/shared")
const { firstDataDay } = await import("./scan/period")

// The fixtures' "now" (Mon 9 Nov 2026), so today is their today.
vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

type Asked = { range: "30d" | "90d" | "All"; from?: string; to?: string }

/** The API reads of every page with a period toggle, for one period. */
async function readsOf(asked: Asked): Promise<string[]> {
  state.reads.length = 0
  await networkOverview(asked)
  await tokenPage({ slug: "mezo", ...asked })
  await tokenPage({ slug: "musd", ...asked })
  await musdLater(asked)
  await locksPage({ escrow: "vemezo", order: "amount", cursor: null, ...asked })
  await gaugePage({
    gauge: demoKindCards.btcMusdCl.gauge.address.toLowerCase(),
    ...asked,
  })
  const overview = await borrowOverview(asked)
  await borrowCharts({ ...asked, markets: overview.charts })
  await marketPage({
    market: MORPHO_MARKETS.mainnet.btcMusdc,
    cursor: null,
    ...asked,
  })
  return [...new Set(state.reads)].sort()
}

const dayOf = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

/**
 * A custom span reads the API by fixed buckets of days back from today,
 * never by its own first day, so a span shares every cache entry with
 * the spans in its bucket and, for the shortest and longest, the ranges.
 */
describe("a custom span's upstream reads", () => {
  it("are the same for spans in one bucket", async () => {
    // 118 and 162 days back from 9 Nov: both read 180.
    const one = await readsOf({
      range: "30d",
      from: "2026-07-15",
      to: "2026-08-31",
    })
    const other = await readsOf({
      range: "30d",
      from: "2026-06-01",
      to: "2026-09-30",
    })
    expect(one.length).toBeGreaterThan(10)
    expect(other).toEqual(one)
  })

  it("are the 30d and All ranges' own at either end", async () => {
    expect(
      await readsOf({ range: "All", from: "2026-10-20", to: "2026-10-25" }),
    ).toEqual(await readsOf({ range: "30d" }))
    expect(
      await readsOf({ range: "30d", from: "2025-06-01", to: "2025-09-30" }),
    ).toEqual(await readsOf({ range: "All" }))
  })

  it("make at most five sets, whatever day a span starts on", async () => {
    const sets = new Set<string>()
    const first = Date.parse(`${firstDataDay}T00:00:00Z`) / 1000
    for (let start = first; start <= fixtureNow; start += 23 * 86_400) {
      const from = dayOf(start)
      const reads = await readsOf({ range: "30d", from, to: from })
      sets.add(reads.join("\n"))
    }
    expect(sets.size).toBeLessThanOrEqual(5)
  }, 30_000)
})
