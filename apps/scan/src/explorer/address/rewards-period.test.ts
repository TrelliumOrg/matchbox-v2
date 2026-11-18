import { describe, expect, it } from "vitest"
import type { RewardBar } from "../../data/wallet-views"
import { rewardsPeriod } from "./rewards-chart"

const bar = (epoch: number): RewardBar => ({
  epoch,
  text: "$1.00",
  cents: 100,
  parts: [],
  projected: epoch === 48,
})

// Epochs 30 to 48; epoch 48 (the current one) starts Thu 12 Nov 2026.
const bars = Array.from({ length: 19 }, (_, index) => bar(30 + index))

describe("the rewards chart's period", () => {
  it("shows a range's last epochs, with the days they cover", () => {
    const { bars: shown, view } = rewardsPeriod(bars, 48, "30d", undefined)
    expect(shown.map((each) => each.epoch)).toEqual([44, 45, 46, 47, 48])
    expect(view).toMatchObject({
      range: "30d",
      from: "2026-10-15",
      to: "2026-11-18",
      min: "2026-07-09",
      max: "2026-11-18",
      text: "30d",
    })
  })

  it("shows the epochs a custom span touches, in order and clamped", () => {
    const { bars: shown, view } = rewardsPeriod(bars, 48, "All", {
      from: "2026-10-31",
      to: "2026-10-20",
    })
    // 15 to 21 Oct, 22 to 28 Oct, 29 Oct to 4 Nov.
    expect(shown.map((each) => each.epoch)).toEqual([44, 45, 46])
    expect(view).toMatchObject({
      range: null,
      from: "2026-10-20",
      to: "2026-10-31",
      text: "20 Oct to 31 Oct",
    })
    const wide = rewardsPeriod(bars, 48, "All", {
      from: "2020-01-01",
      to: "2030-01-01",
    })
    expect(wide.bars).toHaveLength(19)
    expect(wide.view.from).toBe("2026-07-09")
    expect(wide.view.to).toBe("2026-11-18")
  })

  it("keeps the range when a span's day is no day", () => {
    for (const span of [
      { from: "2026-02-31", to: "2026-03-31" },
      { from: "2026-10-01", to: "2026-04-31" },
    ]) {
      const { view } = rewardsPeriod(bars, 48, "30d", span)
      expect(view).toMatchObject({ range: "30d", text: "30d" })
    }
  })
})
