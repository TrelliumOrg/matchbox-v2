import type {
  ScanMorphoMarket,
  ScanMorphoPosition,
  ScanTrove,
} from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import {
  byCollateralRatio,
  byHealth,
  debtShareOf,
  foldInterest,
  healthFigure,
  marketsById,
  marketView,
  morphoPositionView,
  morphoRowView,
  stalePriceNote,
  troveView,
  wadPercentCautious,
  wholeUp,
} from "./borrow-views"
import { marketList, morphoPositions, troves } from "./fixtures/borrow"

describe("risk figures round toward danger", () => {
  const trove = troves[0] as ScanTrove
  const position = morphoPositions[0] as ScanMorphoPosition

  it("never shows a liquidatable trove as safe", () => {
    const view = troveView({
      ...trove,
      health: {
        ...trove.health,
        // ICR 109.96% (under the 110% minimum), health factor 0.9951.
        collateral_ratio: "1099600000000000000",
        health_factor: "995100000000000000",
        ltv: "909420000000000000",
        liquidation_price: "74000000000000000000001",
      },
    })
    expect(view.collateralRatio).toBe("109.9%")
    expect(view.health.healthFactor).toBe("0.99")
    // LTV 90.942% and a liquidation price a wei over $74,000 round up.
    expect(view.health.ltv).toBe("91.0%")
    expect(view.health.liquidationPrice).toBe("$74,001")
  })

  it("rounds a Morpho position the same way", () => {
    const view = morphoPositionView(
      {
        ...position,
        health: {
          ...position.health,
          health_factor: "999999999999999999",
          ltv: "860010000000000000",
        },
      },
      null,
    )
    expect(view.health.healthFactor).toBe("0.99")
    expect(view.health.ltv).toBe("86.1%")
  })

  it("keeps exact figures exact", () => {
    expect(wadPercentCautious("625000000000000000", "up")).toBe("62.5%")
    expect(wadPercentCautious("625000000000000000", "down")).toBe("62.5%")
    expect(healthFigure("1370000000000000000")).toBe("1.37")
    expect(wholeUp("53936000000000000000000", 18)).toBe("53,936")
  })
})

describe("unpriced debt ranks first", () => {
  const position = morphoPositions[0] as ScanMorphoPosition
  const trove = troves[0] as ScanTrove
  const health = (
    band: ScanMorphoPosition["health"]["band"],
    factor: string | null,
  ) => ({ ...position.health, band, health_factor: factor })

  it("puts a Morpho position no price can value before the riskiest", () => {
    const rows = [
      {
        ...position,
        account: "0x1",
        health: health("healthy", "2000000000000000000"),
      },
      { ...position, account: "0x2", health: health("no_debt", null) },
      { ...position, account: "0x3", health: health("unknown", null) },
      {
        ...position,
        account: "0x4",
        health: health("liquidatable", "990000000000000000"),
      },
    ]
    // The overview keeps the first five of this order.
    expect([...rows].sort(byHealth).map((row) => row.account)).toEqual([
      "0x3",
      "0x4",
      "0x1",
      "0x2",
    ])
  })

  it("puts a trove no price can value before the lowest ratio", () => {
    const rows: ScanTrove[] = [
      trove,
      {
        ...trove,
        owner: "0x0000000000000000000000000000000000000abc",
        health: { ...trove.health, band: "unknown", collateral_ratio: null },
      },
    ]
    expect([...rows].sort(byCollateralRatio)[0]?.health.band).toBe("unknown")
  })
})

describe("open positions", () => {
  it("counts a supply-only Morpho position as open, not closed", () => {
    const position = morphoPositions[0] as ScanMorphoPosition
    const lender = morphoRowView(
      {
        ...position,
        borrow_assets: "0",
        borrow_shares: "0",
        collateral: "0",
        supply_assets: "500000000",
        supply_shares: "500000000000000",
      },
      null,
    )
    expect(lender.open).toBe(true)
    const empty = morphoRowView(
      { ...position, borrow_assets: "0", collateral: "0", supply_assets: "0" },
      null,
    )
    expect(empty.open).toBe(false)
  })
})

describe("trove health basis", () => {
  const trove = troves[0] as ScanTrove

  it("labels figures from the market BTC price as an estimate", () => {
    expect(troveView(trove).health.estimate).toBe(true)
  })

  it("does not when MUSD's own price feed was used", () => {
    const fed: ScanTrove = {
      ...trove,
      health_basis: { source: "price_feed", btc_usd: "74000", estimate: false },
    }
    expect(troveView(fed).health.estimate).toBe(false)
    const { health_basis: _dropped, ...older } = trove
    expect(troveView(older as ScanTrove).health.estimate).toBe(false)
  })

  it("says why a stale protocol price leaves the band unknown", () => {
    const stale: ScanTrove = {
      ...trove,
      health: { ...trove.health, band: "unknown" },
      health_basis: {
        source: "price_feed",
        btc_usd: "74000",
        estimate: false,
        stale: true,
        lag_blocks: 120,
      },
    }
    expect(troveView(stale).health).toMatchObject({
      band: "unknown",
      bandText: "Price out of date",
      priceNote: "Price 120 blocks old",
    })
    expect(stalePriceNote({ stale: true, lag_blocks: null })).toBe(
      "Price out of date",
    )
    expect(stalePriceNote({ stale: false, lag_blocks: 0 })).toBeNull()
    expect(troveView(trove).health.priceNote).toBeNull()
    expect(troveView(trove).health.bandText).not.toBe("Price out of date")
  })
})

describe("a market's decimals", () => {
  const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
  const btc = "0x7b7c000000000000000000000000000000000000"
  const base = {
    market_id: `0x${"ab".repeat(32)}`,
    loan_token: musd,
    collateral_token: btc,
    oracle: `0x${"0e".repeat(20)}`,
    irm: `0x${"1e".repeat(20)}`,
    lltv: "860000000000000000",
    total_supply_assets: "5000000000000000000000",
    total_supply_shares: "5000000000000000000000000000",
    total_borrow_assets: "1000000000000000000000",
    total_borrow_shares: "1000000000000000000000000000",
    fee: "0",
    utilization: "200000000000000000",
    borrow_rate_per_second: null,
    oracle_price: (80_000n * 10n ** 36n).toString(),
    block: 13_118_800,
    updated_at: 1_794_000_000,
  }

  it("comes from the market answer, read on chain", () => {
    const view = marketView({
      ...base,
      loan_decimals: 18,
      collateral_decimals: 18,
    })
    expect(view.supplied).toBe("5,000.00 MUSD")
    expect(view.price).toBe("80,000 MUSD")
  })

  it("shows raw units when nobody knows them, never 18", () => {
    const view = marketView({
      ...base,
      loan_decimals: null,
      collateral_decimals: 18,
    })
    expect(view.supplied).toBe(
      "5,000,000,000,000,000,000,000 raw units of MUSD",
    )
    // Without the loan's decimals the oracle price has no scale.
    expect(view.price).toBeNull()
  })

  it("falls back to the token registry for an API that sends none", () => {
    expect(marketView(base).supplied).toBe("5,000.00 MUSD")
  })
})

describe("positions in a market only the list knows", () => {
  const discovered = marketList[2]
  if (discovered === undefined) throw new Error("the third fixture market")
  const position = morphoPositions.find(
    (each) => each.market_id === discovered.market_id,
  )
  if (position === undefined) throw new Error("the discovered position")

  it("finds each market by id", () => {
    expect(marketsById(marketList).get(discovered.market_id)).toBe(discovered)
    expect(marketsById(null).size).toBe(0)
  })

  it("says Morpho market with no amounts without the list", () => {
    const view = morphoPositionView(position, null)
    expect(view.market).toBe("Morpho market")
    expect(view.debt).toBeNull()
  })

  it("names and sizes it from the list", () => {
    const view = morphoPositionView(position, marketView(discovered))
    expect(view.market).toBe("BTC / MUSD (0x4bff…30b8)")
    expect(view.debt).toBe("1,000.00 MUSD")
  })

  it("shows raw units when the list has no decimals, never an assumed 18", () => {
    const unknown = {
      ...discovered,
      loan_decimals: null,
      collateral_decimals: null,
    }
    const view = morphoPositionView(position, marketView(unknown))
    expect(view.debt).toBe("1,000,000,000,000,000,000,000 raw units of MUSD")
    expect(view.collateral).toBe("50,000,000,000,000,000 raw units of BTC")
  })
})

describe("a position's share of its market's debt", () => {
  const market = marketList[0] as ScanMorphoMarket
  const position = morphoPositions[0] as ScanMorphoPosition

  it("reads tiny shares as under a tenth of a percent, never 0.0%", () => {
    expect(debtShareOf(position, market)).toBe("3.4% of debt")
    expect(debtShareOf({ ...position, borrow_assets: "1" }, market)).toBe(
      "<0.1% of debt",
    )
    expect(debtShareOf({ ...position, borrow_assets: "0" }, market)).toBeNull()
    expect(
      debtShareOf(position, { ...market, total_borrow_assets: "0" }),
    ).toBeNull()
  })
})

describe("foldInterest", () => {
  const event = (tx: string, action: string, log: number) => ({
    tx_hash: tx,
    action,
    log_index: log,
  })

  it("folds an accrual into the action of its transaction", () => {
    const events = [
      event("0xb", "BORROWED", 4),
      event("0xb", "INTEREST_ACCRUED", 3),
      event("0xa", "SUPPLIED", 2),
      event("0xa", "INTEREST_ACCRUED", 1),
    ]
    expect(foldInterest(events).map((each) => each.action)).toEqual([
      "BORROWED",
      "SUPPLIED",
    ])
  })

  it("keeps an accrual nobody acted beside", () => {
    const events = [
      event("0xc", "INTEREST_ACCRUED", 9),
      event("0xb", "REPAID", 4),
      event("0xb", "INTEREST_ACCRUED", 3),
    ]
    expect(foldInterest(events)).toEqual([
      event("0xc", "INTEREST_ACCRUED", 9),
      event("0xb", "REPAID", 4),
    ])
  })
})
