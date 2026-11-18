import { describe, expect, it } from "vitest"
import {
  decimalFromNumber,
  keylessCoinGecko,
  parseSimplePrice,
  simplePriceRequest,
} from "./coingecko"

/** `simple/price?ids=mezo-usd,mezo`, recorded 12 Nov 2026 (keyless). */
const recordedSimplePrice = {
  "mezo-usd": {
    usd: 0.993002,
    usd_market_cap: 18862534.168751437,
    usd_24h_vol: 112733.85793889913,
    last_updated_at: 1794465277,
  },
  mezo: {
    usd: 0.00457132,
    usd_market_cap: 2263925.3989963485,
    usd_24h_vol: 887894.6107905294,
    last_updated_at: 1794465277,
  },
}

describe("decimalFromNumber", () => {
  it("keeps the text CoinGecko sent", () => {
    expect(decimalFromNumber(0.00457132)).toBe("0.00457132")
    expect(decimalFromNumber(0.993002)).toBe("0.993002")
    expect(decimalFromNumber(105710)).toBe("105710")
    expect(decimalFromNumber(0)).toBe("0")
  })

  it("expands exponent forms without float arithmetic", () => {
    expect(decimalFromNumber(4.5e-7)).toBe("0.00000045")
    expect(decimalFromNumber(1.25e-10)).toBe("0.000000000125")
    expect(decimalFromNumber(1e21)).toBe("1000000000000000000000")
    expect(decimalFromNumber(1.5e22)).toBe("15000000000000000000000")
  })

  it("rejects negatives and non-finite values", () => {
    expect(decimalFromNumber(-1)).toBeNull()
    expect(decimalFromNumber(Number.NaN)).toBeNull()
    expect(decimalFromNumber(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe("parseSimplePrice", () => {
  it("reads a recorded quote", () => {
    expect(parseSimplePrice(recordedSimplePrice, "mezo")).toEqual({
      usd: "0.00457132",
      volume24hUsd: "887894.6107905294",
      marketCapUsd: "2263925.3989963485",
      updatedAt: 1794465277,
    })
    expect(parseSimplePrice(recordedSimplePrice, "mezo-usd")?.usd).toBe(
      "0.993002",
    )
  })

  it("gives null for a missing, zero or malformed quote", () => {
    expect(parseSimplePrice(recordedSimplePrice, "bitcoin")).toBeNull()
    expect(parseSimplePrice({ mezo: { usd: 0 } }, "mezo")).toBeNull()
    expect(parseSimplePrice({ mezo: { usd: "0.1" } }, "mezo")).toBeNull()
    expect(parseSimplePrice(null, "mezo")).toBeNull()
    expect(parseSimplePrice({ mezo: { usd: 0.2 } }, "mezo")).toEqual({
      usd: "0.2",
      volume24hUsd: null,
      marketCapUsd: null,
      updatedAt: null,
    })
  })
})

describe("simplePriceRequest", () => {
  it("calls the keyless API without a key header", () => {
    const request = simplePriceRequest(["mezo"], keylessCoinGecko)
    expect(request.url).toMatch(
      /^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price\?ids=mezo&/,
    )
    expect(Object.keys(request.headers)).toEqual(["accept"])
  })

  it("sends a Demo key as a header on the public host", () => {
    const request = simplePriceRequest(["mezo"], {
      apiKey: "CG-demo",
      plan: "demo",
    })
    expect(request.url.startsWith("https://api.coingecko.com/")).toBe(true)
    expect(request.url).not.toContain("CG-demo")
    expect(request.headers["x-cg-demo-api-key"]).toBe("CG-demo")
  })

  it("sends a paid key to the pro host", () => {
    const request = simplePriceRequest(["mezo", "mezo-usd"], {
      apiKey: "CG-pro",
      plan: "pro",
    })
    expect(request.url).toContain("https://pro-api.coingecko.com/api/v3/")
    expect(request.url).toContain("ids=mezo%2Cmezo-usd")
    expect(request.headers["x-cg-pro-api-key"]).toBe("CG-pro")
  })
})
