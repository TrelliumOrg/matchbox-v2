import type { ActivityRow, TokenRef } from "@matchbox/contracts/read-models"
import { describe, expect, it } from "vitest"
import {
  addDays,
  type ClaimPrices,
  coverageStamp,
  dayStart,
  estimateClaim,
  historyCaughtUp,
  historyTokens,
  parseCoverage,
  utcDay,
  valueClaim,
  waitingOn,
  withClaimValue,
} from "./claim-prices"

type ClaimRow = Extract<ActivityRow, { type: "claim" }>

const btc: TokenRef = {
  address: "0x7b7c000000000000000000000000000000000000",
  symbol: "BTC",
  name: "Bitcoin",
  decimals: 18,
}
const mezo: TokenRef = {
  address: "0x7b7c000000000000000000000000000000000001",
  symbol: "MEZO",
  name: "Mezo",
  decimals: 18,
}
const musd: TokenRef = {
  address: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
  symbol: "MUSD",
  name: "Mezo USD",
  decimals: 18,
}
const musdc: TokenRef = {
  address: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
  symbol: "mUSDC",
  name: "Mezo Circle USDC",
  decimals: 6,
}
/** A BTC wrapper the registry prices at BTC's price. */
const mcbBtc: TokenRef = {
  address: "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7",
  symbol: "mcbBTC",
  name: "Mezo Coinbase Wrapped BTC",
  decimals: 8,
}
/** Registered, with no price. */
const susdat: TokenRef = {
  address: "0xde402d7021f3f7f00be5d0ab5c238b2be1d2904f",
  symbol: "sUSDat",
  name: "Staked USDat",
  decimals: 18,
}
/** Calls itself BTC and USDC but is in no registry. */
const fakeBtc: TokenRef = {
  address: "0x1111111111111111111111111111111111111111",
  symbol: "BTC",
  name: "Bitcoin",
  decimals: 18,
}
const fakeUsdc: TokenRef = { ...fakeBtc, symbol: "mUSDC", name: "USDC" }

// 12 Mar 2026, 15:20 UTC.
const claimedAt = dayStart("2026-03-12") + 15 * 3_600 + 20 * 60

function claim(
  tokens: { token: TokenRef; amount: string }[],
  timestamp = claimedAt,
): ClaimRow {
  return {
    type: "claim",
    id: `0x${"a".repeat(64)}-1`,
    txHash: `0x${"a".repeat(64)}`,
    block: 1,
    timestamp,
    status: "confirmed",
    actor: `0x50d4${"0".repeat(32)}c139`,
    epoch: null,
    rewards: {
      usd: "1.00",
      tokens: tokens.map((each) => ({ ...each, usd: "1.00" })),
    },
    locks: [],
    gauges: [],
  }
}

const prices: ClaimPrices = {
  daily: new Map([
    ["btc:2026-03-12", { usd: "70123.456789", source: "coingecko" }],
    ["mezo:2026-03-12", { usd: "0.0123456789", source: "coingecko" }],
    ["btc:2026-03-11", { usd: "1", source: "coingecko" }],
  ]),
  coverage: {
    btc: { from: "2025-12-03", through: "2026-03-14" },
    mezo: { from: "2025-12-03", through: "2026-03-14" },
  },
}

describe("claim-time prices", () => {
  it("names UTC days", () => {
    expect(utcDay(claimedAt)).toBe("2026-03-12")
    expect(utcDay(dayStart("2026-03-12"))).toBe("2026-03-12")
    expect(utcDay(dayStart("2026-03-12") - 1)).toBe("2026-03-11")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01")
  })

  it("prices each token by address at its claim's UTC day", () => {
    const value = valueClaim(
      claim([
        { token: btc, amount: "0.000412" },
        { token: mezo, amount: "1234.5" },
      ]),
      prices,
    )
    expect(value).toEqual({
      usd: "44.13",
      tokens: [
        {
          token: btc.address,
          price: "70123.456789",
          usd: "28.89",
          day: "2026-03-12",
          source: "coingecko",
          pricedAs: "btc",
        },
        {
          token: mezo.address,
          price: "0.0123456789",
          usd: "15.24",
          day: "2026-03-12",
          source: "coingecko",
          pricedAs: "mezo",
        },
      ],
    })
  })

  it("uses the claim's own day, not the one before", () => {
    const early = valueClaim(
      claim([{ token: btc, amount: "1" }], dayStart("2026-03-12") + 1),
      prices,
    )
    expect(early?.tokens[0]?.price).toBe("70123.456789")
    const before = valueClaim(
      claim([{ token: btc, amount: "1" }], dayStart("2026-03-12") - 1),
      prices,
    )
    expect(before?.tokens[0]?.price).toBe("1")
  })

  it("values exact 18-decimal amounts", () => {
    const value = valueClaim(
      claim([{ token: btc, amount: "0.000000000000000001" }]),
      prices,
    )
    expect(value?.tokens[0]?.usd).toBe("0.00")
    const large = valueClaim(
      claim([{ token: mezo, amount: "123456789.123456789123456789" }]),
      prices,
    )
    // 123456789.123456789123456789 × 0.0123456789 = 1524157.8765..., to cents.
    expect(large?.usd).toBe("1524157.88")
  })

  it("says No price for a checked day without one, never $0", () => {
    const value = valueClaim(
      claim(
        [
          { token: btc, amount: "1" },
          { token: mezo, amount: "5" },
        ],
        dayStart("2026-03-13") + 60,
      ),
      prices,
    )
    expect(value).toEqual({
      usd: "0.00",
      tokens: [
        {
          token: btc.address,
          price: null,
          usd: null,
          day: "2026-03-13",
          source: null,
          pricedAs: null,
        },
        {
          token: mezo.address,
          price: null,
          usd: null,
          day: "2026-03-13",
          source: null,
          pricedAs: null,
        },
      ],
    })
  })

  it("waits for a day the history has not checked", () => {
    expect(
      valueClaim(
        claim([{ token: btc, amount: "1" }], dayStart("2026-03-15")),
        prices,
      ),
    ).toBeNull()
    // Before migration 0008 or the first fill: every BTC and MEZO day.
    const none: ClaimPrices = {
      daily: new Map(),
      coverage: { btc: null, mezo: null },
    }
    expect(valueClaim(claim([{ token: mezo, amount: "1" }]), none)).toBeNull()
    expect(coverageStamp(none)).toBe("-.-")
    expect(coverageStamp(prices)).toBe("2026-03-14.2026-03-14")
  })

  it("pegs registry stablecoins to $1 and BTC wrappers to BTC, by address", () => {
    const none: ClaimPrices = {
      daily: new Map(),
      coverage: { btc: null, mezo: null },
    }
    // Stablecoins need no history.
    expect(
      valueClaim(
        claim([
          { token: musd, amount: "12.345" },
          { token: musdc, amount: "0.005" },
        ]),
        none,
      ),
    ).toEqual({
      usd: "12.36",
      tokens: [
        {
          token: musd.address,
          price: "1",
          usd: "12.35",
          day: "2026-03-12",
          source: "usd-peg",
          pricedAs: "usd",
        },
        {
          token: musdc.address,
          price: "1",
          usd: "0.01",
          day: "2026-03-12",
          source: "usd-peg",
          pricedAs: "usd",
        },
      ],
    })
    const wrapped = valueClaim(
      claim([{ token: mcbBtc, amount: "0.00000001" }]),
      prices,
    )
    expect(wrapped?.tokens[0]).toMatchObject({
      price: "70123.456789",
      pricedAs: "btc",
      source: "coingecko",
    })
  })

  it("never prices by symbol: unregistered and unpriced tokens get no price", () => {
    const value = valueClaim(
      claim([
        { token: fakeBtc, amount: "1" },
        { token: fakeUsdc, amount: "100" },
        { token: susdat, amount: "100" },
      ]),
      prices,
    )
    expect(value?.usd).toBe("0.00")
    for (const token of value?.tokens ?? []) {
      expect(token).toMatchObject({ price: null, usd: null, source: null })
    }
  })

  it("keeps a recorded value", () => {
    const recorded = withClaimValue(
      claim([{ token: btc, amount: "1" }]),
      prices,
    )
    expect(recorded.type === "claim" && recorded.atClaim?.usd).toBe("70123.46")
    const later: ClaimPrices = {
      ...prices,
      daily: new Map([["btc:2026-03-12", { usd: "2", source: "coingecko" }]]),
    }
    expect(
      recorded.type === "claim" ? valueClaim(recorded, later)?.usd : null,
    ).toBe("70123.46")
  })

  it("values a recorded No price again once its day has a price", () => {
    // 13 Mar was checked with no price, then a later answer priced it.
    const at = dayStart("2026-03-13") + 60
    const recorded = withClaimValue(
      claim(
        [
          { token: btc, amount: "1" },
          { token: musd, amount: "2" },
          { token: fakeBtc, amount: "3" },
        ],
        at,
      ),
      prices,
    )
    expect(recorded.type === "claim" && recorded.atClaim?.usd).toBe("2.00")
    if (recorded.type !== "claim") throw new Error("Expected a claim")
    // Unchanged prices: the same object back, so nothing is rewritten.
    expect(valueClaim(recorded, prices)).toBe(recorded.atClaim)
    expect(withClaimValue(recorded, prices)).toBe(recorded)
    const repaired: ClaimPrices = {
      ...prices,
      daily: new Map([
        ...prices.daily,
        ["btc:2026-03-13", { usd: "70000", source: "coingecko" }],
      ]),
    }
    const again = valueClaim(recorded, repaired)
    expect(again?.usd).toBe("70002.00")
    expect(again?.tokens.map((token) => token.source)).toEqual([
      "coingecko",
      "usd-peg",
      // Not in the registry: never priced, whatever it is called.
      null,
    ])
    // A token in no registry never makes a row repairable.
    const fake = withClaimValue(
      claim([{ token: fakeBtc, amount: "1" }], at),
      prices,
    )
    if (fake.type !== "claim") throw new Error("Expected a claim")
    expect(valueClaim(fake, repaired)).toBe(fake.atClaim)
  })

  it("estimates a settling claim by address, and nothing once it can settle", () => {
    const row = claim([
      { token: btc, amount: "0.5" },
      { token: mcbBtc, amount: "0.25" },
      { token: musd, amount: "3" },
      { token: fakeUsdc, amount: "4" },
      { token: mezo, amount: "100" },
    ])
    const asked: string[] = []
    const priceAt = (token: "btc" | "mezo", at: number) => {
      asked.push(`${token}@${at}`)
      return token === "btc" ? "60000" : null
    }
    // 13 Mar, the day after the claim: its day settles on 15 Mar.
    const estimate = estimateClaim(row, priceAt, dayStart("2026-03-13"))
    expect(estimate).toEqual({
      usd: "45003.00",
      tokens: [
        { token: btc.address, price: "60000", usd: "30000.00" },
        { token: mcbBtc.address, price: "60000", usd: "15000.00" },
        { token: musd.address, price: "1", usd: "3.00" },
        // Named mUSDC, in no registry: no price, whatever its name.
        { token: fakeUsdc.address, price: null, usd: null },
        { token: mezo.address, price: null, usd: null },
      ],
      finalOn: "2026-03-15",
    })
    // At the claim's own time.
    expect(asked).toContain(`btc@${claimedAt}`)
    // Once its day can settle, and with a value, no estimate.
    expect(estimateClaim(row, priceAt, dayStart("2026-03-15"))).toBeUndefined()
    const valued = withClaimValue({ ...row, estimate }, prices)
    expect(valued.type === "claim" && valued.estimate).toBeUndefined()
    expect(valued.type === "claim" && valued.atClaim?.usd).toBe("52596.82")
  })

  it("says when a token's history is behind", () => {
    // 20 Mar: the latest settled day is 17 Mar, a day behind is 16 Mar.
    const at = dayStart("2026-03-20") + 60
    const through = (btc: string, mezo: string): ClaimPrices => ({
      daily: new Map(),
      coverage: {
        btc: { from: "2025-12-03", through: btc },
        mezo: { from: "2025-12-03", through: mezo },
      },
    })
    const caughtUp = (prices: ClaimPrices) =>
      historyTokens.filter((token) => historyCaughtUp(prices, at, token))
    expect(caughtUp(through("2026-03-17", "2026-03-16"))).toEqual([
      "btc",
      "mezo",
    ])
    // Each token on its own: MEZO two days behind does not hold BTC back.
    expect(caughtUp(through("2026-03-17", "2026-03-15"))).toEqual(["btc"])
    // A first call that failed: nothing checked yet.
    expect(caughtUp(through("2025-12-02", "2026-03-17"))).toEqual(["mezo"])
    // Before migration 0008, or before the first fill.
    expect(
      caughtUp({ daily: new Map(), coverage: { btc: null, mezo: null } }),
    ).toEqual([])
  })

  it("names the histories a claim with no value waits on", () => {
    const prices: ClaimPrices = {
      daily: new Map([
        ["btc:2026-03-12", { usd: "70000", source: "coingecko" }],
      ]),
      coverage: {
        btc: { from: "2025-12-03", through: "2026-03-12" },
        mezo: { from: "2025-12-03", through: "2026-03-11" },
      },
    }
    const of = (...tokens: TokenRef[]) =>
      claim(tokens.map((token) => ({ token, amount: "1" })))
    expect(waitingOn(of(btc), prices)).toEqual([])
    expect(waitingOn(of(btc, mezo, musd), prices)).toEqual(["mezo"])
    // A token the registry does not price never waits.
    expect(waitingOn(of(fakeBtc), prices)).toEqual([])
    expect(
      waitingOn(of(mcbBtc), {
        daily: new Map(),
        coverage: { btc: null, mezo: null },
      }),
    ).toEqual(["btc"])
  })

  it("reads coverage cursors defensively", () => {
    expect(parseCoverage(null)).toBeNull()
    expect(parseCoverage("not json")).toBeNull()
    expect(parseCoverage('{"from":"2025-12-03"}')).toBeNull()
    expect(
      parseCoverage('{"from":"2025-12-03","through":"2026-03-14","retryAt":5}'),
    ).toEqual({ from: "2025-12-03", through: "2026-03-14", retryAt: 5 })
  })
})
