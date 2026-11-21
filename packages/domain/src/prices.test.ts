import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import { type PriceSnapshot, referencePrice, tokenMicroUsd } from "./prices"
import {
  type IncentiveToken,
  optimizeCapped,
  optimizerGauges,
  priceTarget,
  type VoteTarget,
} from "./voteMath"

// Incentive tokens are permissionless: anyone can deploy a token named
// "7777USD" or "FAKEBTC" and post it on a gauge. Prices come from the
// token registry by contract address only, never from symbol text.

const E18 = 10n ** 18n
const NOW = "2026-10-21T12:00:00.000Z"
const PRICES: PriceSnapshot = {
  btc: { priceUsd: "59200", source: "skip-oracle", fetchedAt: NOW },
  mezo: { priceUsd: "0.01", source: "aerodrome-cl", fetchedAt: NOW },
}

const MEZO: Address = "0x7B7c000000000000000000000000000000000001"
const BTC: Address = "0x7B7C000000000000000000000000000000000000"
const MUSD: Address = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"
const MUSDC: Address = "0x04671C72Aab5AC02A03c1098314b1BB6B560c197"
const MCBBTC: Address = "0x6a7Cd8E1384d49f502b4A4CE9aC9eb320835c5d7"
const FAKE: Address = "0x7777777777777777777777777777777777777777"

function incentive(
  token: Address,
  symbol: string,
  amount: bigint,
  decimals = 18,
): IncentiveToken {
  return {
    contract: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1",
    token,
    symbol,
    decimals,
    amount,
  }
}

function target(
  index: number,
  weight: bigint,
  incentives: IncentiveToken[],
): VoteTarget {
  const address: Address = `0x${index.toString(16).padStart(40, "a")}`
  return {
    targetAddress: address,
    gaugeAddress: address,
    name: `T${index}`,
    nameSource: "profile",
    tokenId: null,
    isAlive: true,
    weight,
    rewardContracts: [],
    incentives,
  }
}

const FAKE_SYMBOLS = [
  "7777USD",
  "FAKEBTC",
  "CLAIM 7777 MUSD",
  "MUSD",
  "musd",
  " mUSDC ",
  "BTC",
  "WBTC",
  "MEZO",
  "USDT.e",
  "xSolvBTC",
]

describe("reference prices by registry address only", () => {
  it.each(FAKE_SYMBOLS)("leaves an unregistered %j unpriced", (symbol) => {
    const priced = priceTarget(
      target(1, E18, [incentive(FAKE, symbol, 7_777n * E18)]),
      PRICES,
      0n,
    )
    expect(priced.incentiveMicroUsd).toBe(0n)
    expect(priced.pricingStatus).toBe("unpriced")
    expect(priced.unpricedTokens).toEqual([symbol])
    expect(optimizerGauges([priced])).toEqual([])
  })

  it("prices registry tokens whatever their on-chain symbol says", () => {
    // A registered token whose symbol is odd, empty or changed is still
    // priced by its address.
    for (const symbol of ["", "SCAM", "musd", "MUSD (old)", "7777USD"]) {
      expect(
        tokenMicroUsd({
          amount: 5n * E18,
          decimals: 18,
          token: MUSD,
          prices: PRICES,
        }),
      ).toBe(5_000_000n)
      const priced = priceTarget(
        target(2, E18, [incentive(MUSD, symbol, 5n * E18)]),
        PRICES,
        0n,
      )
      expect(priced.incentiveMicroUsd).toBe(5_000_000n)
      expect(priced.pricingStatus).toBe("complete")
    }
  })

  it("reads the registry in any address case", () => {
    expect(referencePrice(MUSD.toLowerCase(), PRICES)).toBe("1")
    expect(referencePrice(MUSD.toUpperCase().replace("0X", "0x"), PRICES)).toBe(
      "1",
    )
    expect(referencePrice(MEZO, PRICES)).toBe("0.01")
    expect(referencePrice(BTC, PRICES)).toBe("59200")
    expect(referencePrice(MUSDC, PRICES)).toBe("1")
    expect(referencePrice(MCBBTC, PRICES)).toBe("59200")
    expect(referencePrice(FAKE, PRICES)).toBeNull()
  })

  it("keeps registry token values exact (golden values)", () => {
    expect(
      tokenMicroUsd({
        amount: 30_000n * E18,
        decimals: 18,
        token: MEZO,
        prices: PRICES,
      }),
    ).toBe(300_000_000n)
    // 0.5 mcbBTC (8 decimals) at $59,200.
    expect(
      tokenMicroUsd({
        amount: 50_000_000n,
        decimals: 8,
        token: MCBBTC,
        prices: PRICES,
      }),
    ).toBe(29_600_000_000n)
    expect(
      tokenMicroUsd({
        amount: 1_234_567n,
        decimals: 6,
        token: MUSDC,
        prices: PRICES,
      }),
    ).toBe(1_234_567n)
  })

  it("has no price for a registered token whose reference price is missing", () => {
    const noMezo: PriceSnapshot = {
      ...PRICES,
      mezo: { priceUsd: null, source: "unavailable", fetchedAt: NOW },
    }
    expect(referencePrice(MEZO, noMezo)).toBeNull()
    expect(referencePrice(MUSD, noMezo)).toBe("1")
  })

  it("counts only the priced part of mixed real and fake incentives", () => {
    const mixed = priceTarget(
      target(3, E18, [
        incentive(MEZO, "MEZO", 30_000n * E18),
        incentive(FAKE, "7777USD", 7_777n * E18),
      ]),
      PRICES,
      0n,
    )
    expect(mixed.incentiveMicroUsd).toBe(300_000_000n)
    expect(mixed.pricingStatus).toBe("partial")
    expect(mixed.unpricedTokens).toEqual(["7777USD"])
  })

  it("never allocates to a gauge on unpriced value", () => {
    const real = priceTarget(
      target(4, 1_000n * E18, [incentive(MEZO, "MEZO", 30_000n * E18)]),
      PRICES,
      0n,
    )
    const scams = ["7777USD", "FAKEBTC", "CLAIM 7777 MUSD"].map((symbol, i) =>
      priceTarget(
        target(10 + i, 1n, [incentive(FAKE, symbol, 7_777_777n * E18)]),
        PRICES,
        0n,
      ),
    )
    const bps = optimizeCapped({
      gauges: optimizerGauges([real, ...scams]),
      votingPowers: [12_400n * E18, 488n * E18],
      maxTargets: 30,
    })
    expect(bps).toEqual(
      new Map([[real.target.targetAddress.toLowerCase(), 10_000n]]),
    )
  })
})
