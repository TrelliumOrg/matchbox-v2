import { describe, expect, it } from "vitest"
import {
  getTokenPriceType,
  getTokenUsdPrice,
  isBtcPegged,
  isMezoToken,
  isStablecoin,
  pythPriceToDecimal,
} from "./pricing"

const MEZO = "0x7b7c000000000000000000000000000000000001"
const BTC = "0x7B7C000000000000000000000000000000000000"
const MUSD = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"
const UNLISTED = "0x1111111111111111111111111111111111111111"
const MSOLVBTC = "0xA10aD2570ea7b93d19fDae6Bd7189fF4929Bc747"
const MXSOLVBTC = "0xdf708431162ba247ddae362d2c919e0fbafcf9de"
const MCBBTC = "0x6a7Cd8E1384d49f502b4A4CE9aC9eb320835c5d7"

describe("token price types", () => {
  it("reads the registry by address in any case", () => {
    expect(getTokenPriceType(MEZO)).toBe("mezo")
    expect(getTokenPriceType(BTC)).toBe("btc-pegged")
    expect(getTokenPriceType(MUSD)).toBe("stablecoin")
  })

  it("lists the bridged BTC wrappers on Mezo by address", () => {
    expect(getTokenPriceType(MSOLVBTC)).toBe("btc-pegged")
    expect(getTokenPriceType(MXSOLVBTC)).toBe("btc-pegged")
    expect(getTokenPriceType(MCBBTC)).toBe("btc-pegged")
    expect(getTokenUsdPrice(MCBBTC, "101234.56", "0.31")).toBe("101234.56")
  })

  it("leaves every unregistered token unknown, whatever its symbol", () => {
    // Incentive tokens are permissionless: a symbol is never a price.
    expect(getTokenPriceType(UNLISTED)).toBe("unknown")
    expect(isStablecoin(UNLISTED)).toBe(false)
    expect(isBtcPegged(UNLISTED)).toBe(false)
    expect(getTokenUsdPrice(UNLISTED, "101234.56", "0.31")).toBeNull()
  })
})

describe("token USD prices", () => {
  it("uses fixed and reference prices as decimal strings", () => {
    expect(getTokenUsdPrice(MUSD, null, null)).toBe("1")
    expect(getTokenUsdPrice(BTC, "101234.56", null)).toBe("101234.56")
    expect(getTokenUsdPrice(MEZO, null, "0.31")).toBe("0.31")
    expect(getTokenUsdPrice(UNLISTED, "1", "1")).toBeNull()
  })

  it("has no MEZO price without a live one", () => {
    expect(getTokenUsdPrice(MEZO, "100000", null)).toBeNull()
  })

  it("recognises the MEZO token", () => {
    expect(isMezoToken("0x7B7C000000000000000000000000000000000001")).toBe(true)
    expect(isMezoToken(BTC)).toBe(false)
  })
})

describe("pythPriceToDecimal", () => {
  function price(value: bigint, expo: number) {
    return { price: value, conf: 0n, expo, publishTime: 0n }
  }

  it("shifts the integer price by its exponent exactly", () => {
    expect(pythPriceToDecimal(price(12345n, -4))).toBe("1.2345")
    expect(pythPriceToDecimal(price(5n, -8))).toBe("0.00000005")
    expect(pythPriceToDecimal(price(10123456000000n, -8))).toBe("101234.56")
    expect(pythPriceToDecimal(price(12n, 2))).toBe("1200")
    expect(pythPriceToDecimal(price(-15n, -1))).toBe("-1.5")
    expect(pythPriceToDecimal(price(0n, -8))).toBe("0")
    expect(pythPriceToDecimal(price(100n, -2))).toBe("1")
  })
})
