import { describe, expect, it } from "vitest"
import {
  APY_MIN_VOTES_WEI,
  apyFloorMissed,
  apyIsMeaningful,
  apyMinVotes,
  type FundingToken,
  funding,
  usdTextToMicro,
} from "./funding"

describe("usdTextToMicro", () => {
  it("reads dollar decimals exactly, rounding below a micro-dollar down", () => {
    expect(usdTextToMicro("0.28")).toBe(280_000n)
    expect(usdTextToMicro("10849.19")).toBe(10_849_190_000n)
    expect(usdTextToMicro("0.0000019")).toBe(1n)
    expect(usdTextToMicro("7")).toBe(7_000_000n)
    expect(usdTextToMicro("7.")).toBe(7_000_000n)
  })

  it("reads anything that is not a non-negative decimal as nothing", () => {
    expect(usdTextToMicro("")).toBe(0n)
    expect(usdTextToMicro("-3")).toBe(0n)
    expect(usdTextToMicro("1e3")).toBe(0n)
    expect(usdTextToMicro("abc")).toBe(0n)
  })
})

describe("funding", () => {
  const priced = (usd: string, address = "0xa"): FundingToken => ({
    address,
    registered: true,
    usdMicro: usdTextToMicro(usd),
  })
  const unpricedRegistry: FundingToken = {
    address: "0xB",
    registered: true,
    usdMicro: null,
  }
  const unregistered = (usd: string | null): FundingToken => ({
    address: "0xc",
    registered: false,
    usdMicro: usd === null ? null : usdTextToMicro(usd),
  })

  it("counts a cent and more of priced registry tokens, never dust", () => {
    expect(funding([priced("0.01")]).status).toBe("funded")
    expect(funding([priced("0.006"), priced("0.004", "0xd")]).status).toBe(
      "funded",
    )
    expect(funding([priced("0.009999")]).status).toBe("unfunded")
    expect(funding([priced("0")]).status).toBe("unfunded")
    expect(funding([]).status).toBe("none")
  })

  it("counts a registry token without a USD value as funding of unknown size", () => {
    expect(funding([unpricedRegistry])).toEqual({
      status: "funded",
      pricedMicro: 0n,
      unpriced: 1,
    })
    expect(funding([priced("0.004"), unpricedRegistry])).toEqual({
      status: "funded",
      pricedMicro: 4_000n,
      unpriced: 1,
    })
  })

  it("never counts an unregistered token as funding, priced or not", () => {
    expect(funding([unregistered("500")])).toEqual({
      status: "unfunded",
      pricedMicro: 0n,
      unpriced: 1,
    })
    expect(funding([unregistered(null), priced("1.15")])).toEqual({
      status: "funded",
      pricedMicro: 1_150_000n,
      unpriced: 1,
    })
  })

  it("counts each unpriced token once, by address", () => {
    expect(
      funding([unpricedRegistry, { ...unpricedRegistry, address: "0xb" }])
        .unpriced,
    ).toBe(1)
  })
})

describe("apyMinVotes", () => {
  it("is the unit's floor for a funded gauge with a dollar and more", () => {
    expect(
      apyMinVotes({ funded: true, incentivesUsd: "1.15", unit: "veBTC" }),
    ).toBe(APY_MIN_VOTES_WEI.veBTC)
    expect(
      apyMinVotes({ funded: true, incentivesUsd: "1", unit: "veMEZO" }),
    ).toBe(APY_MIN_VOTES_WEI.veMEZO)
  })

  it("is none when no votes could bring an APY", () => {
    expect(
      apyMinVotes({ funded: true, incentivesUsd: "0.28", unit: "veBTC" }),
    ).toBeNull()
    expect(
      apyMinVotes({ funded: false, incentivesUsd: "500", unit: "veBTC" }),
    ).toBeNull()
  })
})

describe("apyFloorMissed", () => {
  it("names the floor that hides an APY, incentives first", () => {
    const floor = APY_MIN_VOTES_WEI.veBTC
    expect(
      apyFloorMissed({
        incentivesMicro: 280_000n,
        votesWei: 0n,
        unit: "veBTC",
      }),
    ).toBe("incentives")
    expect(
      apyFloorMissed({
        incentivesMicro: 1_000_000n,
        votesWei: floor - 1n,
        unit: "veBTC",
      }),
    ).toBe("votes")
    expect(
      apyFloorMissed({
        incentivesMicro: 1_000_000n,
        votesWei: floor,
        unit: "veBTC",
      }),
    ).toBeNull()
  })
})

describe("apyIsMeaningful", () => {
  const votes = (unit: keyof typeof APY_MIN_VOTES_WEI) =>
    APY_MIN_VOTES_WEI[unit].toString()

  it("needs a dollar of incentives", () => {
    expect(
      apyIsMeaningful({
        incentivesUsd: "0.28",
        votesWei: 10n ** 21n,
        unit: "veBTC",
      }),
    ).toBe(false)
    expect(
      apyIsMeaningful({
        incentivesUsd: "1",
        votesWei: votes("veBTC"),
        unit: "veBTC",
      }),
    ).toBe(true)
    expect(
      apyIsMeaningful({
        incentivesUsd: "0.999999",
        votesWei: votes("veBTC"),
        unit: "veBTC",
      }),
    ).toBe(false)
  })

  it("needs the floor of votes in the gauge's unit", () => {
    expect(
      apyIsMeaningful({
        incentivesUsd: "10000",
        votesWei: (APY_MIN_VOTES_WEI.veBTC - 1n).toString(),
        unit: "veBTC",
      }),
    ).toBe(false)
    expect(
      apyIsMeaningful({
        incentivesUsd: "10000",
        votesWei: votes("veBTC"),
        unit: "veMEZO",
      }),
    ).toBe(false)
    expect(
      apyIsMeaningful({
        incentivesUsd: "10000",
        votesWei: votes("veMEZO"),
        unit: "veMEZO",
      }),
    ).toBe(true)
    expect(
      apyIsMeaningful({ incentivesUsd: "10000", votesWei: "", unit: "veBTC" }),
    ).toBe(false)
  })
})
