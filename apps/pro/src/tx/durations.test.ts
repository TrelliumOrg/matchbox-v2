import { describe, expect, it } from "vitest"
import { durations, unlockAt, votingPowerAt } from "./durations"

const flip = Date.UTC(2026, 10, 5) / 1000

describe("lock durations", () => {
  it("rounds unlocks down to a Thursday", () => {
    const sunday = flip + 3 * 86_400 + 11 * 3_600
    const end = unlockAt(sunday, 28 * 86_400)
    expect(new Date(end * 1000).getUTCDay()).toBe(4)
    expect(end).toBe(flip + 28 * 86_400)
  })

  it("caps veBTC at four weeks and veMEZO at 208 weeks", () => {
    expect(durations.vebtc.at(-1)?.seconds).toBe(28 * 86_400)
    expect(durations.vemezo.at(-1)?.seconds).toBe(208 * 7 * 86_400)
  })

  it("decays voting power to the unlock, full for auto max", () => {
    const amount = 5000n * 10n ** 18n
    expect(
      votingPowerAt({ kind: "vemezo", amount, now: flip, end: null }),
    ).toBe(amount)
    expect(
      votingPowerAt({
        kind: "vemezo",
        amount,
        now: flip,
        end: flip + 104 * 7 * 86_400,
      }),
    ).toBe(amount / 2n)
    expect(
      votingPowerAt({ kind: "vebtc", amount, now: flip, end: flip - 1 }),
    ).toBe(0n)
  })
})
