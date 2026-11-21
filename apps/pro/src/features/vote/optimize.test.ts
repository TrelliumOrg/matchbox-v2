import { describe, expect, it } from "vitest"
import type { BallotGauge } from "./ballot"
import { optimize } from "./optimize"

const wad = 10n ** 18n

describe("Optimize", () => {
  it("never votes on a gauge whose tile says No incentives", () => {
    const gauges: BallotGauge[] = [
      // Dust with no votes on it: by dollars per vote, the best there is.
      { id: "0xdust", competing: 0n, incentivesMicro: 4_000n, funded: false },
      {
        id: "0xfunded",
        competing: 1_000_000n * wad,
        incentivesMicro: 500_000_000n,
        funded: true,
      },
    ]
    const ballot = optimize(gauges, 10_000n * wad)
    expect(ballot?.has("0xdust")).toBe(false)
    expect(ballot?.get("0xfunded")).toBe(10_000)
  })
})
