import { describe, expect, it, vi } from "vitest"

vi.mock("cloudflare:workers", () => ({ env: { SCAN_DATA: "fixtures" } }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))

const { borrowInput, chartsInput } = await import("./borrow-input")
const { borrowCharts, borrowOverview, borrowTab, marketPage } = await import(
  "./borrow.server"
)

/**
 * The Borrow server functions take whatever a request sends: a value a
 * read does not expect becomes a well-formed input, never a 500.
 */

const musdc =
  "0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db"

describe("borrow inputs", () => {
  it("turns a prototype key or junk into the defaults", () => {
    expect(borrowInput.overview({ range: "constructor" })).toEqual({
      range: "30d",
    })
    expect(borrowInput.overview(null)).toEqual({ range: "30d" })
    expect(borrowInput.tab({ tab: "__proto__", cursor: 7 })).toEqual({
      tab: "markets",
      cursor: null,
    })
    expect(
      borrowInput.market({ market: ["x"], range: "All", cursor: "abcd" }),
    ).toEqual({ market: "", range: "All", cursor: "abcd" })
    expect(borrowInput.position({ market: musdc })).toEqual({
      market: musdc,
      account: "",
    })
    expect(borrowInput.trove({ owner: "x".repeat(10_000) })).toEqual({
      owner: "",
    })
    expect(borrowInput.enclave("12")).toEqual({ position: "" })
  })

  it("keeps a custom span only when both days have a day's shape", () => {
    expect(
      borrowInput.overview({
        range: "90d",
        from: "2026-01-01",
        to: "2026-03-31",
      }),
    ).toEqual({ range: "90d", from: "2026-01-01", to: "2026-03-31" })
    expect(borrowInput.overview({ from: "2026-01-01" })).toEqual({
      range: "30d",
    })
    expect(
      borrowInput.overview({ from: { toString: 1 }, to: "2026-03-31" }),
    ).toEqual({ range: "30d" })
    expect(
      chartsInput({ range: "All", from: "2026-01-01", to: "x", markets: [] }),
    ).toEqual({ range: "All", markets: [] })
  })

  it("draws a market over a custom span", async () => {
    const page = await marketPage({
      market: musdc,
      range: "30d",
      from: "2026-03-31",
      to: "2026-01-01",
      cursor: null,
    })
    expect(page.period).toMatchObject({
      range: null,
      from: "2026-01-01",
      to: "2026-03-31",
    })
    if (page.supplied.status !== "ok") throw new Error("no series")
    const days = page.supplied.data.points.map((point) => point.day)
    expect(
      days.every((day) => day >= "2026-01-01" && day <= "2026-03-31"),
    ).toBe(true)
  })

  it("answers a page for a period no route offers", async () => {
    const range = "constructor" as "30d"
    const overview = await borrowOverview({ range })
    expect(overview.period.range).toBe("30d")
    const charts = await borrowCharts({ range, markets: overview.charts })
    expect(charts[overview.charts[0]?.id ?? ""]?.status).toBe("ok")
    // A request's markets are checked: ids by shape, decimals as integers.
    expect(
      chartsInput({
        range: "x",
        markets: [{ id: "nope" }, { id: musdc, decimals: 6.5 }],
      }),
    ).toEqual({ range: "30d", markets: [{ id: musdc, decimals: null }] })
    const market = await marketPage({ market: musdc, range, cursor: null })
    expect(market.period.range).toBe("30d")
    expect(market.supplied.status).toBe("ok")
    const tab = await borrowTab({ tab: "toString" as "markets", cursor: null })
    expect(tab.tab).toBe("markets")
  })
})
