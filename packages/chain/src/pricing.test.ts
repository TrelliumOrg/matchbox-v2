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

describe("token price types", () => {
  it("reads the registry by address in any case", () => {
    expect(getTokenPriceType(MEZO)).toBe("mezo")
    expect(getTokenPriceType(BTC)).toBe("btc-pegged")
    expect(getTokenPriceType(MUSD)).toBe("stablecoin")
  })

  it("falls back to the symbol", () => {
    expect(getTokenPriceType(UNLISTED, " musdc ")).toBe("stablecoin")
    expect(getTokenPriceType(UNLISTED, "xSolvBTC")).toBe("btc-pegged")
    expect(getTokenPriceType(UNLISTED, "mezo")).toBe("mezo")
    expect(getTokenPriceType(UNLISTED, "")).toBe("unknown")
    expect(getTokenPriceType(UNLISTED)).toBe("unknown")
    expect(isStablecoin(UNLISTED, "USDT.e")).toBe(true)
    expect(isBtcPegged(UNLISTED, "BTCB")).toBe(true)
  })
})

describe("token USD prices", () => {
  it("uses fixed and reference prices as decimal strings", () => {
    expect(getTokenUsdPrice(MUSD, "MUSD", null, null)).toBe("1")
    expect(getTokenUsdPrice(BTC, "BTC", "101234.56", null)).toBe("101234.56")
    expect(getTokenUsdPrice(MEZO, "MEZO", null, "0.31")).toBe("0.31")
    expect(getTokenUsdPrice(UNLISTED, "FOO", "1", "1")).toBeNull()
  })

  it("has no MEZO price without a live one", () => {
    expect(getTokenUsdPrice(MEZO, "MEZO", "100000", null)).toBeNull()
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
