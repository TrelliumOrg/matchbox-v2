import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  scenario: undefined as string | undefined,
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) =>
    name === "x-scan-fixture" ? state.scenario : undefined,
  setResponseHeader: () => undefined,
}))

const { homePage } = await import("./home.server")
const { collateralTile, positionsTile, sparkline, validatorsTile } =
  await import("./scan/home-views")
const { fixtureNow } = await import("./scan/fixtures/shared")

vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

/**
 * Home's tiles and Epoch gauges from the fixtures: each tile from its own
 * read, left out (never zero) when that read fails, and the gauges with
 * the most incentives first.
 */

describe("sparkline", () => {
  it("scales a window from its lowest to its highest value", () => {
    expect(sparkline([10n, 15n, null, 20n])).toEqual([0, 0.5, null, 1])
  })

  it("draws a flat window in the middle, and nothing for one point", () => {
    expect(sparkline([3n, 3n])).toEqual([0.5, 0.5])
    expect(sparkline([3n, null])).toBeNull()
  })
})

describe("validators tile", () => {
  const row = (status: "active" | "left" | null) => ({
    address: "0x0000000000000000000000000000000000000001",
    name: null,
    label: null,
    operator: null,
    gauge: null,
    pool_status: status,
    blocks: null,
    share_bps: null,
    blocks_total: null,
  })

  it("counts the set without the pools that left", () => {
    const tile = validatorsTile([row("active"), row(null), row("left")], {
      day: "2026-11-08",
      total: "22737",
    })
    expect(tile?.value).toBe("2")
    expect(tile?.detail).toBe("22,737 blocks 8 Nov")
  })

  it("is left out with no validator", () => {
    expect(validatorsTile([row("left")], null)).toBeNull()
  })
})

describe("borrowing tiles", () => {
  const btc = (whole: bigint) => whole * 10n ** 18n

  it("adds every venue's BTC collateral, with the Enclaves' share", () => {
    const tile = collateralTile(
      { troves: btc(10n), enclaves: btc(250n), markets: btc(8n) },
      "100000.00",
    )
    expect(tile).toMatchObject({
      id: "collateral",
      value: "268.0000 BTC",
      detail: "$26.80M",
      aside: { label: "Enclaves", value: "93.2%" },
    })
  })

  it("never shows a partial sum", () => {
    expect(
      collateralTile({ troves: btc(1n), enclaves: null, markets: 0n }, null),
    ).toBeNull()
    expect(positionsTile({ troves: 3, enclaves: 1, markets: null })).toBeNull()
  })

  it("counts open positions by venue", () => {
    expect(positionsTile({ troves: 3, enclaves: 1, markets: 7 })).toMatchObject(
      {
        value: "11",
        detail: "1 Enclave, 7 Morpho",
        aside: { label: "Troves", value: "3" },
      },
    )
  })
})

describe("home page", () => {
  it("shows every tile the fixtures have data for", async () => {
    state.scenario = undefined
    const page = await homePage()
    expect(page.tiles.map((tile) => tile.id)).toEqual([
      "borrowed",
      "collateral",
      "positions",
      "vebtc",
      "validators",
      "incentives",
    ])
    const borrowed = page.tiles[0]
    expect(borrowed?.value).toBe("723,361 MUSD")
    expect(borrowed?.detail).toBe("3.5% Enclaves")
    expect(borrowed?.spark?.length).toBe(30)
    const incentives = page.tiles.find((tile) => tile.id === "incentives")
    expect(incentives?.label).toBe("Epoch 47 incentives")
    expect(incentives?.value).toMatch(/^\$/)
    expect(incentives?.detail).toMatch(/^Closes in /)
  })

  it("lists every venue's latest borrowing, newest first", async () => {
    state.scenario = undefined
    const page = await homePage()
    expect(page.borrowing.status).toBe("ok")
    if (page.borrowing.status !== "ok") return
    const rows = page.borrowing.data
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((row) => row.kind)).size).toBeGreaterThan(1)
    const times = rows.map((row) => row.timestamp)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    const trove = rows.find((row) => row.kind === "trove")
    expect(trove).toMatchObject({ venue: "MUSD trove", status: "Active" })
    // A Morpho event carries no position state: not shown as zero.
    for (const row of rows.filter((each) => each.kind === "morpho")) {
      expect(row.debt).toBeNull()
      expect(row.status).toBeNull()
    }
  })

  it("lists the gauges with the most incentives first", async () => {
    state.scenario = undefined
    const page = await homePage()
    expect(page.gauges.status).toBe("ok")
    if (page.gauges.status !== "ok") return
    expect(page.gauges.data.epoch).toBe(47)
    expect(page.gauges.data.rows.length).toBeGreaterThan(0)
    expect(page.gauges.data.rows.length).toBeLessThanOrEqual(4)
    const amounts = page.gauges.data.rows.map((row) =>
      Number(row.incentives.replace(/[^0-9.]/g, "")),
    )
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts)
  })

  it("leaves Borrowed out when the total is missing", async () => {
    state.scenario = "filling"
    const page = await homePage()
    expect(page.tiles.map((tile) => tile.id)).not.toContain("borrowed")
  })

  it("leaves every tile out when the read routes are disabled", async () => {
    state.scenario = "disabled"
    const page = await homePage()
    expect(page.tiles).toEqual([])
    expect(page.gauges.status).toBe("disabled")
  })
})
