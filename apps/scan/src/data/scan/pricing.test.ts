import { describe, expect, it } from "vitest"
import {
  amountUsd,
  btcToken,
  type DailyPrices,
  epochPriceDay,
  mezoToken,
  pricedText,
  priceMap,
  priceOn,
  usdCompact,
  usdShort,
} from "./pricing"

const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const musdc = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"
const unknown = `0x${"ab".repeat(20)}`
const wad = 10n ** 18n

const prices: DailyPrices = {
  btc: [
    { day: "2026-11-01", price: "100000" },
    { day: "2026-11-03", price: "102000.5" },
  ],
  mezo: [{ day: "2026-11-02", price: "0.184" }],
}

describe("daily prices", () => {
  it("take the day's close, else the latest before it, never a later one", () => {
    expect(priceOn(prices.btc, "2026-11-01")).toBe("100000")
    expect(priceOn(prices.btc, "2026-11-02")).toBe("100000")
    expect(priceOn(prices.btc, "2026-11-09")).toBe("102000.5")
    expect(priceOn(prices.btc, "2026-10-31")).toBeNull()
    expect(priceOn(prices.mezo, "2026-11-01")).toBeNull()
  })

  it("price an epoch at its last day, or now while it runs", () => {
    const start = Date.parse("2026-11-05T00:00:00Z") / 1000
    expect(epochPriceDay(start, start + 30 * 86_400)).toBe("2026-11-11")
    expect(epochPriceDay(start, start + 2 * 86_400 + 5)).toBe("2026-11-07")
  })
})

describe("amounts in USD", () => {
  it("are exact, by the token's decimals and pricing", () => {
    // 0.1 BTC at 102,000.5
    expect(amountUsd(btcToken, wad / 10n, "2026-11-04", prices)).toBe(
      10_200_050_000_000_000_000_000n,
    )
    // 5,000 MEZO at 0.184
    expect(amountUsd(mezoToken, 5_000n * wad, "2026-11-04", prices)).toBe(
      920n * wad,
    )
    // 25 mUSDC (6 decimals) taken as $1
    expect(amountUsd(musdc, 25_000_000n, "2026-11-04", prices)).toBe(25n * wad)
    expect(amountUsd(unknown, 7n, "2026-11-04", prices)).toBeNull()
    expect(amountUsd(mezoToken, wad, "2026-11-01", prices)).toBeNull()
  })

  it("sum a token map and say when a token is left out", () => {
    const whole = priceMap(
      {
        [mezoToken]: (5_000n * wad).toString(),
        [musd]: (10n * wad).toString(),
      },
      "2026-11-04",
      prices,
    )
    expect(whole.usd).toBe(930n * wad)
    expect(pricedText(whole)).toBe("$930")
    const floor = priceMap(
      { [musd]: (10n * wad).toString(), [unknown]: "7" },
      "2026-11-04",
      prices,
    )
    expect(pricedText(floor)).toBe("$10 + unpriced")
    expect(pricedText(priceMap({ [unknown]: "7" }, "2026-11-04", prices))).toBe(
      "Unpriced",
    )
    expect(pricedText(priceMap({ [musd]: "0" }, "2026-11-04", prices))).toBe(
      null,
    )
  })

  it("format whole and compact", () => {
    expect(usdShort(20_200n * wad)).toBe("$20,200")
    expect(usdShort(1_240_000n * wad)).toBe("$1.24M")
    expect(usdCompact(350_200n * wad)).toBe("$350.2k")
    expect(usdCompact(12n * wad)).toBe("$12.00")
  })
})
