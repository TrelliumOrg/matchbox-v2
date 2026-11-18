import { describe, expect, it } from "vitest"
import {
  feeApr,
  pricedDays,
  pricedLevels,
  reserveSides,
  reservesView,
  saneFees,
  volumeView,
} from "./pool-views"
import { btcToken, type DailyPrices, mezoToken } from "./pricing"
import type { SeriesView } from "./series.server"

const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const wad = 10n ** 18n

function view(points: [string, string, boolean?][]): SeriesView {
  return {
    metric: "test",
    kind: "flow",
    unit: "amount",
    points: points.map(([day, decimal, partial = false]) => ({
      day,
      decimal,
      value: Number(decimal),
      text: decimal,
      partial,
    })),
    latest: null,
    firstDay: points[0]?.[0] ?? null,
    endsOn: null,
  }
}

const prices: DailyPrices = {
  btc: [{ day: "2026-11-01", price: "100000" }],
  mezo: [{ day: "2026-11-02", price: "0.2" }],
}

describe("a pool's priced days", () => {
  it("add both tokens at each day's close, leaving out unpriced days", () => {
    const days = pricedDays(
      [
        {
          token: btcToken,
          view: view([
            ["2026-11-01", "0.5"],
            ["2026-11-02", "1"],
          ]),
        },
        {
          token: musd,
          view: view([
            ["2026-11-01", "1000"],
            ["2026-11-02", "500"],
          ]),
        },
      ],
      prices,
    )
    expect(days.map((day) => [day.day, day.usd])).toEqual([
      ["2026-11-01", 51_000n * wad],
      ["2026-11-02", 100_500n * wad],
    ])
    const mezo = pricedDays(
      [
        {
          token: mezoToken,
          view: view([
            ["2026-11-01", "10"],
            ["2026-11-02", "10"],
          ]),
        },
      ],
      prices,
    )
    expect(mezo.map((day) => day.day)).toEqual(["2026-11-02"])
  })
})

describe("a pool's liquidity per day", () => {
  it("leaves out a day missing one side's balance, never drawn smaller", () => {
    const days = pricedLevels(
      [
        {
          token: btcToken,
          view: view([
            ["2026-11-01", "0.5"],
            ["2026-11-02", "1"],
          ]),
        },
        // MUSD's balance did not read on the 2nd.
        { token: musd, view: view([["2026-11-01", "1000"]]) },
      ],
      {
        ...prices,
        btc: [...prices.btc, { day: "2026-11-02", price: "100000" }],
      },
    )
    expect(days.map((day) => [day.day, day.usd])).toEqual([
      ["2026-11-01", 51_000n * wad],
    ])
  })
})

describe("volume and fees", () => {
  const volume = [
    { day: "2026-11-01", usd: 1_000n * wad, partial: false },
    { day: "2026-11-02", usd: 2_000n * wad, partial: false },
    { day: "2026-11-03", usd: 100n * wad, partial: true },
  ]

  it("read the last whole day, the period and volume to reserves", () => {
    const fees = volume.map((day) => ({ ...day, usd: day.usd / 1_000n }))
    const view = volumeView(volume, fees, 10_000n * wad)
    expect(view?.last).toMatchObject({
      day: "2026-11-02",
      volume: 2_000n * wad,
      fees: 2n * wad,
      // Fewer than 7 whole days: no week.
      volume7d: null,
    })
    expect(view?.stats.map((stat) => [stat.label, stat.value])).toEqual([
      ["Volume 2 Nov", "$2,000"],
      ["Fees 2 Nov", "$2"],
      ["2d volume", "$3,000"],
      ["Volume to reserves", "0.20×"],
    ])
    expect(view?.chart.partial).toBe(true)
  })

  it("drop fees above the highest fee tier as bad data", () => {
    const fees = volume.map((day) => ({ ...day, usd: day.usd / 50n }))
    expect(saneFees(volume, fees)).toBeNull()
    const fine = volume.map((day) => ({ ...day, usd: day.usd / 200n }))
    expect(saneFees(volume, fine)).toEqual(fine)
  })

  it("make a yearly fee rate against the reserves, capped", () => {
    // $70 of fees a week on $10,000 is 36.5% a year.
    expect(feeApr(70n * wad, 10_000n * wad)).toBe("36.50")
    expect(feeApr(70n * wad, 0n)).toBeNull()
    // Past 1,000% is not a rate to show.
    expect(feeApr(70_000n * wad, 10_000n * wad)).toBeNull()
  })
})

describe("reserves", () => {
  it("price each side at its close and headline their total", () => {
    const sides = reserveSides(
      [
        { token: btcToken, symbol: "BTC", view: view([["2026-11-01", "2"]]) },
        {
          token: musd,
          symbol: "MUSD",
          view: view([["2026-11-01", "200000"]]),
        },
      ],
      prices,
    )
    expect(sides?.total).toBe(400_000n * wad)
    const reserves = reservesView(sides?.sides ?? [], [])
    // Their dollar total, never a ratio of balances read as a price.
    expect(reserves?.figure).toBe("$400k")
    expect(reserves?.segments.map((part) => part.bps)).toEqual([5_000, 5_000])
  })
})
