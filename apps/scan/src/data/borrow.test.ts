import { MORPHO_MARKETS } from "@matchbox/chain"
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

const {
  borrowCharts,
  borrowLiquidations,
  borrowOverview,
  borrowPositions,
  borrowTab,
  borrowTroves,
  enclavePage,
  marketPage,
  morphoPositionPage,
  trovePage,
} = await import("./borrow.server")
const { enclavePositionId, wallet } = await import("./scan/fixtures/world")
const { lockPage } = await import("./locks.server")
const {
  closedEnclavePositionId,
  morphoDiscoveredLiquidated,
  morphoLiquidated,
  morphoSupplier,
} = await import("./scan/fixtures/borrow")

const musdc = MORPHO_MARKETS.mainnet.btcMusdc
const nobody = `0x${"0".repeat(40)}`

describe("borrow reads", () => {
  it("builds the overview from markets, positions, troves and the pool", async () => {
    const overview = await borrowOverview({ range: "30d" })
    expect(overview.markets.status).toBe("ok")
    if (overview.markets.status !== "ok") return
    // The third market, discovered on chain, shares its tokens with a
    // configured one: its short id tells them apart.
    expect(overview.markets.data.map((market) => market.name)).toEqual([
      "BTC / mUSDC",
      "BTC / MUSD",
      "BTC / MUSD (0x4bff…30b8)",
    ])
    expect(overview.markets.data[2]).toMatchObject({
      supplied: "5,000.00 MUSD",
      borrowed: "1,000.00 MUSD",
      lltv: "86%",
    })
    expect(overview.markets.data[0]?.lltv).toBe("86%")
    // The oracle's price in the loan token: mUSDC is never taken as $1.
    expect(overview.markets.data[0]?.price).toBe("74,000 mUSDC")
    expect(overview.counts).toEqual({
      morpho: 4,
      morphoMusd: 2,
      troves: 3,
      enclaves: 1,
      complete: true,
    })
    // Troves 57,360.75, the open Enclave's 25,000 and the MUSD markets'
    // 641,000, in MUSD: the mUSDC market is never added or priced.
    expect(overview.borrowed).toEqual({
      status: "ok",
      data: {
        total: "723,361 MUSD",
        enclavesShare: "3.5% in Enclaves",
        enclaves: { open: 1, positions: 2 },
        troveDebt: "57,360.75 MUSD",
      },
    })
    expect(overview.charts).toHaveLength(3)
    // The charts' series load after first paint, one request for all.
    const charts = await borrowCharts({
      range: overview.period.range ?? "30d",
      markets: overview.charts,
    })
    // Each market's borrowed, and the troves' collateral ratio per day.
    expect(Object.values(charts).map((chart) => chart.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ])
    const troves = charts.troves
    if (troves?.status !== "ok") throw new Error("troves ratio")
    expect(troves.data.kind).toBe("level")
    expect(troves.data.latest?.text).toMatch(/^[0-9,]+[.][0-9]%$/)
    if (overview.closest.status !== "ok") throw new Error("closest")
    const factors = overview.closest.data.rows.map((row) =>
      Number(row.health.healthFactor),
    )
    expect(factors).toEqual([...factors].sort((a, b) => a - b))
    // Troves rank beside Morpho positions, by the same health factor.
    expect(new Set(overview.closest.data.rows.map((row) => row.kind))).toEqual(
      new Set(["morpho", "trove"]),
    )
    expect(overview.closest.data.troves).toBe(true)
    if (overview.troves.status !== "ok") throw new Error("troves")
    expect(overview.troves.data.lowest).toHaveLength(3)
    // Every open trove's debt from the totals; the collateral they hold.
    expect(overview.troves.data.debt).toBe("57,360.75 MUSD")
    expect(overview.troves.data.collateral).toBe("1.0141 BTC")
    expect(overview.stabilityPool).toEqual({
      status: "ok",
      data: { deposits: "1,840,221.40 MUSD", collateral: "2.1180 BTC" },
    })
  })

  it("gives no Borrowed total when a venue could not be read", async () => {
    // The fixtures' `filling` scenario: the Enclave read stopped short.
    state.scenario = "filling"
    try {
      const overview = await borrowOverview({ range: "30d" })
      expect(overview.borrowed).toEqual({
        status: "ok",
        data: {
          total: null,
          enclavesShare: null,
          enclaves: null,
          troveDebt: "57,360.75 MUSD",
        },
      })
      // Without the Enclave count the open positions are not complete.
      expect(overview.counts).toMatchObject({ enclaves: null, complete: false })
    } finally {
      state.scenario = undefined
    }
  })

  it("lists positions and pages troves and liquidations", async () => {
    const { positions } = await borrowPositions()
    expect(positions.status === "ok" && positions.data.rows).toHaveLength(4)
    // The mUSDC market's lender has no debt and no collateral: not listed.
    expect(
      positions.status === "ok" &&
        positions.data.rows.some((row) => row.account === morphoSupplier),
    ).toBe(false)
    const tab = await borrowTroves({ cursor: null })
    expect(tab.troves.status === "ok" && tab.troves.data.items).toHaveLength(3)
    expect(tab.redemptions).toEqual({ status: "ok", data: [] })
    const liquidations = await borrowLiquidations({ cursor: "bad cursor!" })
    expect(
      liquidations.status === "ok" && liquidations.data.items[0]?.detail,
    ).toBe("-2,192.30 MUSD, -0.0310 BTC")
  })

  it("names and sizes a liquidation in a market the list discovered", async () => {
    const liquidations = await borrowLiquidations({ cursor: null })
    if (liquidations.status !== "ok") throw new Error("liquidations")
    const row = liquidations.data.items.find(
      (item) => item.borrower === morphoDiscoveredLiquidated,
    )
    expect(row?.loan).toEqual({
      kind: "morpho",
      market:
        "0x4bff245ddc101cd43e365aa1faff97351ab36a225e43d9a76aab82ff763030b8",
      name: "BTC / MUSD (0x4bff…30b8)",
    })
    expect(row?.detail).toBe("Seized 0.00800 BTC, repaid 500.00 MUSD")
    // The overview's recent liquidations read the same list.
    const overview = await borrowOverview({ range: "30d" })
    if (overview.liquidations.status !== "ok") throw new Error("overview")
    expect(
      overview.liquidations.data.recent.find(
        (item) => item.borrower === morphoDiscoveredLiquidated,
      )?.loan,
    ).toMatchObject({ name: "BTC / MUSD (0x4bff…30b8)" })
  })

  it("lists Morpho liquidations beside trove liquidations", async () => {
    const liquidations = await borrowLiquidations({ cursor: null })
    if (liquidations.status !== "ok") throw new Error("liquidations")
    const [trove, morpho] = liquidations.data.items
    expect(trove?.loan).toEqual({ kind: "trove" })
    expect(morpho?.loan).toEqual({
      kind: "morpho",
      market: MORPHO_MARKETS.mainnet.btcMusd,
      name: "BTC / MUSD",
    })
    expect(morpho?.borrower).toBe(morphoLiquidated)
    expect(morpho?.detail).toBe("Seized 0.0310 BTC, repaid 2,000.00 MUSD")
    const overview = await borrowOverview({ range: "30d" })
    expect(
      overview.liquidations.status === "ok" && overview.liquidations.data,
    ).toMatchObject({ count: 3, complete: true })
  })

  it("reads a market with its series, positions and activity", async () => {
    const page = await marketPage({ market: musdc, range: "90d", cursor: null })
    expect(page.market.status).toBe("ok")
    expect(page.supplied.status).toBe("ok")
    // The fixture series end on the fixtures' day; the read ends on today.
    const points =
      page.supplied.status === "ok" ? page.supplied.data.points : []
    expect(points.length).toBeGreaterThan(80)
    expect(points.length).toBeLessThanOrEqual(90)
    // Collateral in BTC to four places, and collateral over borrowed per
    // day (batch 2).
    expect(
      page.collateral.status === "ok" && page.collateral.data.latest?.text,
    ).toMatch(/^[0-9,]+[.][0-9]{4}$/)
    if (page.ratio.status !== "ok") throw new Error("ratio")
    expect(page.ratio.data.points.length).toBeGreaterThan(80)
    expect(page.ratio.data.latest?.text).toMatch(/^[0-9,]+[.][0-9]%$/)
    if (page.activity.status !== "ok") throw new Error("activity")
    expect(page.activity.data.items[0]?.title).toBe("Added 0.2416 BTC")
    expect(page.activity.data.items[1]?.title).toBe("Borrowed 60,486.22 mUSDC")
    // Computed figures: 5.2% compounded (5.34%) times 72% utilization, no
    // fee; supplied less borrowed; Morpho's incentive at 86% LLTV.
    expect(page.market).toMatchObject({
      status: "ok",
      data: {
        supplyApy: "3.8%",
        available: "700,000.00 mUSDC",
        liquidationIncentive: "4.38%",
      },
    })
    // Each position's share of the market's 1,800,000 mUSDC borrowed.
    if (page.positions.status !== "ok") throw new Error("positions")
    expect(page.positions.data.rows.map((row) => row.debtShare)).toEqual([
      "11.0% of debt",
      "3.4% of debt",
    ])
    const unknown = await marketPage({
      market: `0x${"ab".repeat(32)}`,
      range: "30d",
      cursor: null,
    })
    expect(unknown.market.status).toBe("missing")
  })

  it("reads a Morpho position with the API's health figures", async () => {
    const page = await morphoPositionPage({ market: musdc, account: wallet })
    expect(page.missing).toBe(false)
    if (page.position.status !== "ok" || page.position.data === null) {
      throw new Error("position")
    }
    const position = page.position.data
    expect(position.collateral).toBe("1.3040 BTC")
    expect(position.debt).toBe("60,486.22 mUSDC")
    expect(position.health.band).toBe("healthy")
    // In the loan token, rounded up: never dollars by assumption.
    expect(position.health.liquidationPrice).toBe("53,937 mUSDC")
    expect(position.drop).toMatch(/% below BTC$/)
    const none = await morphoPositionPage({ market: musdc, account: nobody })
    expect(none.missing).toBe(true)
  })

  it("reads a trove and 404s an owner with none", async () => {
    const page = await trovePage({ owner: wallet })
    expect(page.missing).toBe(false)
    if (page.trove.status !== "ok") throw new Error("trove")
    expect(page.trove.data.debt).toBe("10,012.50 MUSD")
    expect(page.trove.data.rate).toBe("1.00% APR")
    expect(page.trove.data.status).toBe("Active")
    expect((await trovePage({ owner: nobody })).missing).toBe(true)
  })

  it("reads an Enclave position with its pledged lock", async () => {
    const page = await enclavePage({ position: enclavePositionId })
    if (page.position.status !== "ok") throw new Error("position")
    expect(page.position.data.principal).toBe("25,000.00 MUSD")
    expect(page.position.data.minimumRatio).toBe("110%")
    expect(page.locks.status === "ok" && page.locks.data[0]?.id).toBe("604")
    expect((await enclavePage({ position: "12" })).position.status).toBe(
      "missing",
    )
  })

  it("lists Enclave positions, open first, with MUSD minted and repaid", async () => {
    const tab = await borrowTab({ tab: "enclaves", cursor: null })
    if (tab.tab !== "enclaves" || tab.enclaves.status !== "ok") {
      throw new Error("enclaves")
    }
    const list = tab.enclaves.data
    expect(list).toMatchObject({
      open: 1,
      positions: 2,
      minted: "33,000.00 MUSD",
      repaid: "8,000.00 MUSD",
      complete: true,
      next: null,
    })
    expect(list.rows.map((row) => [row.positionId, row.status])).toEqual([
      [enclavePositionId, "Active"],
      [closedEnclavePositionId, "Closed"],
    ])
    expect(list.rows[0]).toMatchObject({
      principal: "25,000.00 MUSD",
      minted: "25,000.00 MUSD",
      repaid: "0.00 MUSD",
      pledged: ["604"],
      borrower: wallet,
    })
    // Closed: nothing pledged now, the veBTC it used kept for the row.
    expect(list.rows[1]).toMatchObject({
      principal: "0.00 MUSD",
      pledged: [],
      tokens: ["605"],
      latestAction: "Closed",
    })
    const overview = await borrowOverview({ range: "30d" })
    expect(
      overview.enclaves.status === "ok" && overview.enclaves.data.rows,
    ).toHaveLength(2)
    // The position page says whether it is still open.
    const open = await enclavePage({ position: enclavePositionId })
    expect(open.position.status === "ok" && open.position.data.open).toBe(true)
    const closed = await enclavePage({ position: closedEnclavePositionId })
    expect(closed.position.status === "ok" && closed.position.data.open).toBe(
      false,
    )
  })

  it("finds the Enclave position a veBTC lock backs", async () => {
    const backing = await lockPage({ escrow: "vebtc", id: "604" })
    expect(backing.enclave).toMatchObject({
      status: "ok",
      data: {
        positionId: enclavePositionId,
        backing: true,
        principal: "25,000.00 MUSD",
        minted: "25,000.00 MUSD",
      },
    })
    // Pledged to a position since closed: shown, but it backs nothing.
    const released = await lockPage({ escrow: "vebtc", id: "605" })
    expect(released.enclave).toMatchObject({
      status: "ok",
      data: { backing: false, status: "Closed", repaid: "8,000.00 MUSD" },
    })
    const never = await lockPage({ escrow: "vebtc", id: "999999" })
    expect(never.enclave).toEqual({ status: "ok", data: null })
    // Enclaves take veBTC only: a veMEZO lock reads nothing.
    const vemezo = await lockPage({ escrow: "vemezo", id: "2207" })
    expect(vemezo.enclave).toBeNull()
  })

  it("degrades every section on a 503 without 404ing", async () => {
    state.scenario = "disabled"
    try {
      const page = await trovePage({ owner: wallet })
      expect(page.missing).toBe(false)
      expect(page.trove.status).toBe("disabled")
      const position = await morphoPositionPage({
        market: musdc,
        account: wallet,
      })
      expect(position.missing).toBe(false)
      const enclave = await enclavePage({ position: enclavePositionId })
      expect(enclave.position.status).toBe("disabled")
      const overview = await borrowOverview({ range: "30d" })
      expect(overview.markets.status).toBe("disabled")
      expect(overview.counts).toBeNull()
    } finally {
      state.scenario = undefined
    }
  })

  it("counts the rows a Borrow list left out", async () => {
    // The markets fixture says one stored row failed its schema.
    const overview = await borrowOverview({ range: "30d" })
    expect(overview.markets.status === "ok" && overview.markets.skipped).toBe(1)
    const tab = await borrowTab({ tab: "markets", cursor: null })
    expect(
      tab.tab === "markets" &&
        tab.markets.status === "ok" &&
        tab.markets.skipped,
    ).toBe(1)
  })

  it("says Borrow data is delayed when a live read's snapshot is stale", async () => {
    const pages = async () => [
      (await borrowOverview({ range: "30d" })).delayed,
      (await borrowTab({ tab: "markets", cursor: null })).delayed,
      (await borrowTab({ tab: "positions", cursor: null })).delayed,
      (await borrowTab({ tab: "troves", cursor: null })).delayed,
      (await marketPage({ market: musdc, range: "30d", cursor: null })).delayed,
      (await morphoPositionPage({ market: musdc, account: wallet })).delayed,
      (await trovePage({ owner: wallet })).delayed,
    ]
    expect(await pages()).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    state.scenario = "delayed"
    try {
      expect(await pages()).toEqual([true, true, true, true, true, true, true])
      // History only (trove and Morpho liquidations): no live read.
      expect(
        (await borrowTab({ tab: "liquidations", cursor: null })).delayed,
      ).toBe(false)
    } finally {
      state.scenario = undefined
    }
  })
})
