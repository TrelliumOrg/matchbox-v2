import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))

const { tokenTab } = await import("./token-tabs.server")
const { tokensPage } = await import("./token-pages.server")
const { tokenTabOf } = await import("./scan/token-list")
const { forgetNames } = await import("./scan/names.server")
const { fixtureNow } = await import("./scan/fixtures/shared")

vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

/**
 * The MUSD and MEZO tabs from the recorded proxy answers (MUSD's holders,
 * transfers and a verified contract), and the Tokens list's sorts.
 */

describe("token tabs", () => {
  it("reads only the tabs it knows", () => {
    expect(tokenTabOf("holders")).toBe("holders")
    expect(tokenTabOf("loans")).toBeNull()
  })

  it("lists MUSD's top holders with their share of the supply", async () => {
    forgetNames()
    const tab = await tokenTab({ slug: "musd", tab: "holders", cursor: {} })
    expect(tab.tab).toBe("holders")
    if (tab.tab !== "holders" || tab.data.status !== "ok") {
      throw new Error("holders did not read")
    }
    const { rows, holders, more } = tab.data.data
    expect(holders).toBe("29,242")
    expect(more).toBe(true)
    expect(rows[0]?.rank).toBe(1)
    // 14,172,031.98 of 19,009,212.61 MUSD.
    expect(rows[0]?.share).toBe("74.6%")
    expect(rows[0]?.balance).toBe("14,172,031.98")
  })

  it("pages MUSD's transfers by the proxy's cursor", async () => {
    const tab = await tokenTab({ slug: "musd", tab: "transfers", cursor: {} })
    if (tab.tab !== "transfers" || tab.data.status !== "ok") {
      throw new Error("transfers did not read")
    }
    expect(tab.data.data.items.length).toBe(2)
    expect(tab.data.data.next).toEqual({
      block_number: "13114961",
      index: "4",
    })
  })

  it("describes the contract", async () => {
    const tab = await tokenTab({ slug: "musd", tab: "contract", cursor: {} })
    if (tab.tab !== "contract" || tab.data.status !== "ok") {
      throw new Error("contract did not read")
    }
    expect(tab.data.data.verified).toBe(true)
    expect(tab.data.data.compiler).toBe("v0.8.20+commit.a1b79de6")
    expect(tab.data.data.optimization).toBe("Yes, 200 runs")
    expect(tab.data.data.implementations[0]?.name).toBe("BoostVoter")
  })

  it("says a tab the proxy cannot answer is not available", async () => {
    const tab = await tokenTab({ slug: "mezo", tab: "holders", cursor: {} })
    expect(tab.data.status).toBe("unavailable")
  })
})

describe("tokens list sorts", () => {
  it("sorts by holders, largest first, tokens without a count last", async () => {
    const page = await tokensPage({ sort: "holders" })
    expect(page.sort).toBe("holders")
    if (page.table.status !== "ok") throw new Error("list did not read")
    const counts = page.table.data.rows.map((row) =>
      row.holders === "not-yet" || row.holders === "unknown"
        ? null
        : BigInt(row.holders.replaceAll(",", "")),
    )
    const known = counts.filter((count) => count !== null)
    expect(known).toEqual(
      [...known].sort((a, b) => (a === b ? 0 : a > b ? -1 : 1)),
    )
    expect(counts.slice(known.length).every((count) => count === null)).toBe(
      true,
    )
  })

  it("keeps the registry's order by default", async () => {
    const page = await tokensPage()
    expect(page.sort).toBe("listed")
    if (page.table.status !== "ok") throw new Error("list did not read")
    expect(page.table.data.rows[0]?.symbol).toBe("BTC")
  })
})
