import { describe, expect, it } from "vitest"
import {
  circulatingSupply,
  curveMetapoolUsd,
  feeAprPercent,
  meanDecimals,
  meanTick,
  signedDecimalToWad,
  spreadBps,
  sqrtRatioAtTick,
  sumDecimals,
  token0PerToken1,
  token1PerToken0,
  usdOfRaw,
  WAD,
  wadToDecimal,
  wadToSignedDecimal,
  weightedMedian,
} from "./market-price"

describe("sqrtRatioAtTick", () => {
  it("matches Uniswap's TickMath at the bounds and at zero", () => {
    expect(sqrtRatioAtTick(0)).toBe(2n ** 96n)
    expect(sqrtRatioAtTick(-887_272)).toBe(4_295_128_739n)
    expect(sqrtRatioAtTick(887_272)).toBe(
      1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n,
    )
  })

  it("brackets a recorded slot0 (Aerodrome MUSD/USDC, tick 276389)", () => {
    const sqrtPrice = 79_487_461_300_055_951_692_109_445_644_074_896n
    expect(sqrtRatioAtTick(276_389) <= sqrtPrice).toBe(true)
    expect(sqrtRatioAtTick(276_390) > sqrtPrice).toBe(true)
  })

  it("rejects ticks out of range", () => {
    expect(() => sqrtRatioAtTick(887_273)).toThrow(RangeError)
    expect(() => sqrtRatioAtTick(1.5)).toThrow(RangeError)
  })
})

describe("meanTick", () => {
  it("rounds toward negative infinity", () => {
    expect(meanTick([0n, 1800n * 276_389n], 1800)).toBe(276_389)
    expect(meanTick([0n, -1801n], 1800)).toBe(-2)
    expect(meanTick([100n, 100n], 1800)).toBe(0)
  })
})

describe("pool prices", () => {
  // USDC (6) is token0 and MUSD (18) token1 in both CL venues.
  const sqrtPrice = 79_487_461_300_055_951_692_109_445_644_074_896n

  it("reads MUSD in USDC from a recorded sqrt price", () => {
    const musdPerUsdc = token1PerToken0(sqrtPrice, 6, 18)
    expect(wadToDecimal(musdPerUsdc).startsWith("1.00655")).toBe(true)
    const usdcPerMusd = token0PerToken1(sqrtPrice, 6, 18)
    expect(wadToDecimal(usdcPerMusd).startsWith("0.99348")).toBe(true)
  })

  it("prices Curve's metapool coin through the base pool's virtual price", () => {
    // Recorded 12 Nov 2026: get_dy(0, 1, 1e18) and the 2pool's virtual price.
    const usd = curveMetapoolUsd(
      974_656_638_504_584_224n,
      1_019_588_228_126_142_768n,
    )
    expect(wadToDecimal(usd).startsWith("0.993748")).toBe(true)
  })
})

describe("weightedMedian", () => {
  const q = (price: string, weight: bigint) => ({
    price: BigInt(price),
    weight,
  })

  it("follows the deepest venue", () => {
    expect(
      weightedMedian([q("993", 3_370n), q("994", 216n), q("993", 821n)]),
    ).toBe(993n)
    expect(weightedMedian([q("990", 1n), q("995", 10n), q("999", 1n)])).toBe(
      995n,
    )
  })

  it("is null without weight", () => {
    expect(weightedMedian([])).toBeNull()
    expect(weightedMedian([q("1", 0n)])).toBeNull()
  })
})

describe("spreadBps", () => {
  it("measures the widest gap against the lowest price", () => {
    expect(spreadBps([WAD, (WAD * 10_050n) / 10_000n])).toBe(50n)
    expect(spreadBps([WAD])).toBe(0n)
  })
})

describe("supply", () => {
  it("takes the hub manager's balance out of Mezo's supply", () => {
    expect(circulatingSupply(100n, 30n, "locking")).toBe(70n)
    expect(circulatingSupply(100n, 30n, "burning")).toBe(100n)
    expect(circulatingSupply(10n, 30n, "locking")).toBe(0n)
  })

  it("values raw amounts", () => {
    expect(usdOfRaw(2_000_000n, 6, WAD / 2n)).toBe(WAD)
  })
})

describe("decimal sums", () => {
  it("adds and averages signed decimals exactly", () => {
    expect(sumDecimals(["0.09", "8.16417", null])).toBe("8.2541")
    expect(sumDecimals([null])).toBeNull()
    expect(sumDecimals(["-1.5", "0.25"])).toBe("-1.25")
    expect(meanDecimals(["1", "2", "4"])).toBe("2.3333")
    expect(meanDecimals([])).toBeNull()
  })

  it("estimates a fee APR from a day's volume", () => {
    // $38,073.78 a day at 5 bps on $214,673.15: about 3.24% a year.
    expect(feeAprPercent("38073.78", 5, "214673.15")).toBe("3.2367")
    expect(feeAprPercent("1", 5, "0")).toBeNull()
  })

  it("round-trips signed WAD strings", () => {
    expect(signedDecimalToWad("abc")).toBeNull()
    expect(wadToSignedDecimal(signedDecimalToWad("-0.00001") ?? 0n, 4)).toBe(
      "0",
    )
  })
})
