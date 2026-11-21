import { describe, expect, it } from "vitest"
import { paidToVoters } from "../../data/scan/rewards"
import { openEpochWords } from "./paid-panel"

const usd = (value: bigint) => ({ usd: value, tokens: [] })

describe("the open epoch's figures on Gauges", () => {
  it("say incentives and with fees, not posted and so far", () => {
    const view = paidToVoters(
      [
        {
          epoch: 49,
          start: 0,
          closed: false,
          complete: true,
          incentives: usd(227n),
          fees: usd(10_817n),
          total: usd(11_044n),
          votes: 1,
        },
      ],
      49,
      true,
      null,
    )
    const labels = openEpochWords(view?.stats ?? []).map((stat) => stat.label)
    expect(labels).toContain("Epoch 49 incentives so far")
    expect(labels).toContain("Epoch 49 with fees so far")
    expect(labels.some((label) => / posted$/.test(label))).toBe(false)
  })
})
