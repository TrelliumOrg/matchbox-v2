import { decimalToScaledBigInt } from "@matchbox/domain"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  type MarketRow,
  MUSD_MCR,
  morphoHealth,
  morphoPositionView,
  type TrovePrice,
  trovePriceOf,
  troveView,
} from "./borrow-math"
import { CursorCodec, keyPart } from "./cursor"

const WAD = 10n ** 18n

/** A PriceFeed price from a decimal USD string. */
function feed(
  usd: string,
  block: number | null = 7,
  poolBlock: number | null = null,
): TrovePrice {
  return { usd: decimalToScaledBigInt(usd, 18), block, poolBlock }
}

const market: MarketRow = {
  market_id: `0x${"aa".repeat(32)}`,
  loan_token: "0x04671C72Aab5AC02A03c1098314b1BB6B560c197",
  collateral_token: "0x7b7C000000000000000000000000000000000000",
  oracle: `0x${"0e".repeat(20)}`,
  irm: `0x${"1e".repeat(20)}`,
  lltv_raw: ((86n * WAD) / 100n).toString(),
  total_supply_assets_raw: "1000000000000",
  total_supply_shares_raw: "1000000000000000000",
  total_borrow_assets_raw: "500000000000",
  total_borrow_shares_raw: "500000000000000000",
  fee_raw: "0",
  borrow_rate_raw: null,
  // 74,000 mUSDC (6 dp) per BTC (18 dp), Morpho's 1e36 scale.
  oracle_price_raw: (74_000n * 10n ** 24n).toString(),
  block: 1,
  updated_at: 1,
}

describe("Morpho health", () => {
  it("prices a position from shares, collateral and the oracle", () => {
    const view = morphoPositionView(
      {
        market_id: market.market_id,
        account: "0xABC0000000000000000000000000000000000000",
        supply_shares_raw: "0",
        borrow_shares_raw: "30000000000000000",
        collateral_raw: WAD.toString(),
        block: 1,
        updated_at: 1,
      },
      market,
    )
    expect(view.account).toBe("0xabc0000000000000000000000000000000000000")
    // Borrow shares convert to assets rounding up (toAssetsUp).
    expect(view.borrow_assets).toBe("30000000000")
    expect(view.health.band).toBe("healthy")
    expect(view.health.ltv).toBe("405405405405405406")
    // 30,000 / (1 x 0.86) = 34,883.72 mUSDC per BTC, rounded up.
    expect(view.health.liquidation_price).toBe("34883720930232558139534883721")
  })

  it("bands a position near and past liquidation", () => {
    const at = (borrowAssets: bigint) =>
      morphoHealth({
        borrowAssets,
        collateral: WAD,
        lltv: (86n * WAD) / 100n,
        oraclePrice: 74_000n * 10n ** 24n,
      }).band
    // Max borrow is 63,640 mUSDC.
    expect(at(60_000n * 10n ** 6n)).toBe("near_liquidation")
    expect(at(64_000n * 10n ** 6n)).toBe("liquidatable")
    expect(at(0n)).toBe("no_debt")
  })

  it("bands debt without an oracle price unknown, never healthy", () => {
    expect(
      morphoHealth({
        borrowAssets: 1n,
        collateral: WAD,
        lltv: WAD,
        oraclePrice: null,
      }),
    ).toEqual({
      health_factor: null,
      ltv: null,
      liquidation_price: null,
      band: "unknown",
    })
    // No debt stays no_debt, priced or not.
    expect(
      morphoHealth({
        borrowAssets: 0n,
        collateral: WAD,
        lltv: WAD,
        oraclePrice: null,
      }).band,
    ).toBe("no_debt")
  })
})

describe("trove health", () => {
  const trove = {
    owner: "0xCAFE000000000000000000000000000000000000",
    status: "active",
    coll_raw: WAD.toString(),
    principal_raw: (49_000n * WAD).toString(),
    interest_raw: (1_000n * WAD).toString(),
    interest_rate: 100,
    block: 1,
    updated_at: 1,
  }

  it("computes ICR, LTV and the liquidation price with domain math", () => {
    const view = troveView(trove, feed("74000.5"))
    expect(view.health.collateral_ratio).toBe("1480010000000000000")
    expect(view.health.band).toBe("near_liquidation")
    expect(view.health.liquidation_price).toBe((55_000n * WAD).toString())
    expect(view.health.health_factor).toBe(
      ((1_480_010_000_000_000_000n * WAD) / MUSD_MCR).toString(),
    )
  })

  it("keeps exact decimals from the price string", () => {
    // No float rounding: 0.1 + 0.2 style inputs stay exact.
    const view = troveView(trove, feed("50000.000000000000000001"))
    expect(view.health.collateral_ratio).toBe("1000000000000000000")
  })

  it("handles no debt, and bands a trove with no PriceFeed price unknown", () => {
    expect(
      troveView({ ...trove, principal_raw: "0", interest_raw: "0" }, feed("1"))
        .health.band,
    ).toBe("no_debt")
    const unpriced = troveView(trove, null)
    expect(unpriced.health).toMatchObject({
      band: "unknown",
      collateral_ratio: null,
      health_factor: null,
      liquidation_price: (55_000n * WAD).toString(),
    })
    expect(unpriced.health_basis).toEqual({
      source: "price_feed",
      btc_usd: null,
      estimate: false,
      block: null,
      stale: null,
      lag_blocks: null,
    })
  })

  it("says it used the PriceFeed price, exactly, and its block", () => {
    expect(troveView(trove, feed("74000.5", 13_000_000)).health_basis).toEqual({
      source: "price_feed",
      btc_usd: "74000.5",
      estimate: false,
      block: 13_000_000,
      // Read after the trove's last change: current.
      stale: false,
      lag_blocks: 0,
    })
  })

  it("reads the PriceFeed columns, any of them possibly NULL", () => {
    const columns = {
      musd_btc_price_raw: (74_000n * WAD).toString(),
      musd_btc_price_scale: 18,
      musd_btc_price_block: 12,
    }
    expect(trovePriceOf(columns)).toEqual({
      usd: 74_000n * WAD,
      block: 12,
      poolBlock: null,
    })
    // The pool row's own block comes along.
    expect(trovePriceOf({ ...columns, block: 40 })?.poolBlock).toBe(40)
    // Another scale is brought to 1e18.
    expect(
      trovePriceOf({
        ...columns,
        musd_btc_price_raw: "7400000000",
        musd_btc_price_scale: 5,
      }),
    ).toEqual({ usd: 74_000n * WAD, block: 12, poolBlock: null })
    // The block alone missing still prices.
    expect(trovePriceOf({ ...columns, musd_btc_price_block: null })).toEqual({
      usd: 74_000n * WAD,
      block: null,
      poolBlock: null,
    })
    // No price, no scale, a row from before the migration, junk, zero.
    for (const row of [
      { ...columns, musd_btc_price_raw: null },
      { ...columns, musd_btc_price_scale: null },
      { network: "mezo", total_musd_deposits_raw: "1" },
      { ...columns, musd_btc_price_raw: "1.5" },
      { ...columns, musd_btc_price_raw: "0" },
      null,
    ]) {
      expect(trovePriceOf(row)).toBeNull()
    }
  })
})

describe("PriceFeed price staleness", () => {
  const trove = {
    owner: "0xCAFE000000000000000000000000000000000000",
    status: "active",
    coll_raw: WAD.toString(),
    principal_raw: (49_000n * WAD).toString(),
    interest_raw: (1_000n * WAD).toString(),
    interest_rate: 100,
    block: 13_000_000,
    updated_at: 1,
  }

  it("bands a trove unknown when the price is older than the trove's last write", () => {
    // One block is enough: a later run rewrote the trove, then failed to
    // write the price.
    const view = troveView(trove, feed("80000", trove.block - 1))
    expect(view.health.band).toBe("unknown")
    expect(view.health.collateral_ratio).toBeNull()
    // The stale price is still shown, with its lag.
    expect(view.health_basis).toMatchObject({
      btc_usd: "80000",
      block: trove.block - 1,
      stale: true,
      lag_blocks: 1,
    })
  })

  it("keeps a price read at or after the trove's and the pool's last write", () => {
    for (const [block, pool] of [
      [trove.block, trove.block],
      [trove.block + 79, trove.block + 79],
      [trove.block + 79, null],
    ] as const) {
      const view = troveView(trove, feed("80000", block, pool))
      expect(view.health.band).toBe("healthy")
      expect(view.health_basis).toMatchObject({ stale: false, lag_blocks: 0 })
    }
  })

  it("is stale when the pool was written after the price, though the trove was not", () => {
    // The trove last changed long ago; a later run rewrote the pool and
    // failed to write the price.
    const view = troveView(
      { ...trove, block: 12_000_000 },
      feed("80000", 12_999_921, 13_000_000),
    )
    expect(view.health_basis).toMatchObject({ stale: true, lag_blocks: 79 })
    expect(view.health.band).toBe("unknown")
  })

  it("judges nothing without a price block", () => {
    const view = troveView(trove, feed("80000", null, trove.block))
    expect(view.health.band).toBe("healthy")
    expect(view.health_basis).toMatchObject({ stale: null, lag_blocks: null })
  })
})

describe("cursors", () => {
  const codec = new CursorCodec(
    "test",
    z.tuple([keyPart.block, keyPart.tokenId]),
  )

  it("round-trips a key", () => {
    const cursor = codec.encode([13_000_000, "42"])
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(codec.decode(cursor)).toEqual([13_000_000, "42"])
    expect(codec.decode(undefined)).toBeNull()
  })

  it("rejects other lists, wrong shapes and junk", () => {
    const other = new CursorCodec("other", z.tuple([keyPart.block]))
    for (const bad of [
      other.encode([1]),
      codec.encode([13_000_000, "42"]).slice(0, -2),
      "not a cursor",
      Buffer.from(JSON.stringify(["test", -1, "42"])).toString("base64url"),
      Buffer.from(JSON.stringify(["test", 1])).toString("base64url"),
      Buffer.from('["test", 1, "4x"]').toString("base64url"),
    ]) {
      expect(() => codec.decode(bad), bad).toThrow()
    }
  })
})
