import type { ScanEpochItem } from "@matchbox/contracts/scan"
import { epochStartForIndex } from "@matchbox/domain/epoch"
import { describe, expect, it } from "vitest"
import { type DailyPrices, dayOf, mezoToken } from "./pricing"
import { paidByEpoch, paidToVoters, rewardsToVoters } from "./rewards"

const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const unknown = `0x${"ab".repeat(20)}`
const wad = 10n ** 18n

function item(
  epoch: number,
  incentives: Record<string, bigint>,
  fees: Record<string, bigint>,
  sealed: boolean,
): ScanEpochItem {
  const text = (map: Record<string, bigint>) =>
    Object.fromEntries(
      Object.entries(map).map(([token, value]) => [token, value.toString()]),
    )
  return {
    epoch_start: epochStartForIndex(epoch),
    emission: null,
    rebase: null,
    gauge_rewards: null,
    total_supply: null,
    vote_transactions: 10,
    voters: 5,
    vote_weight: {},
    gauges: 2,
    incentives: text(incentives),
    fees: text(fees),
    top_gauge: {},
    killed_weight: {},
    updated_at: 0,
    sealed,
    complete: true,
  }
}

const now = epochStartForIndex(3) + 86_400
// MEZO at $0.20 from Epoch 0 on, $0.40 from Epoch 2's last day.
const prices: DailyPrices = {
  btc: [],
  mezo: [
    { day: dayOf(epochStartForIndex(0)), price: "0.2" },
    { day: dayOf(epochStartForIndex(3) - 86_400), price: "0.4" },
  ],
}

const items = [
  item(3, { [mezoToken]: 1_000n * wad }, { [musd]: 5n * wad }, false),
  item(1, { [mezoToken]: 1_000n * wad }, { [musd]: 10n * wad }, true),
  item(2, { [mezoToken]: 1_000n * wad }, {}, true),
]

describe("paid to voters", () => {
  const rows = paidByEpoch(items, prices, now)

  it("prices each epoch at its closing day, oldest first", () => {
    expect(rows.map((row) => row.epoch)).toEqual([1, 2, 3])
    expect(rows.map((row) => row.total.usd)).toEqual([
      210n * wad,
      400n * wad,
      405n * wad,
    ])
  })

  it("leads with the last closed epoch, stacked by token kind", () => {
    const view = paidToVoters(rows, 3, true, null)
    expect(view?.figure).toBe("$400")
    expect(view?.note).toBe("Epoch 2")
    expect(view?.stats).toEqual([
      { label: "Epoch 3 posted", value: "$400" },
      { label: "Epoch 3 so far", value: "$405" },
      { label: "vs Epoch 1", value: "+90.5%", tone: "pos" },
      { label: "All epochs", value: "$1,015" },
    ])
    expect(view?.series.map((each) => each.label)).toEqual([
      "MEZO",
      "Dollar tokens",
      "BTC",
    ])
    expect(view?.bars[0]).toMatchObject({
      epoch: 1,
      current: false,
      value: 210,
      parts: [200, 10, 0],
      text: "$210",
    })
    expect(view?.bars.at(-1)?.current).toBe(true)
  })

  it("splits rewards into fees and incentives on Epochs", () => {
    const view = rewardsToVoters(rows, 3, true, null)
    expect(view?.figure).toBe("$1,015")
    expect(view?.stats).toEqual([
      { label: "Epoch 2", value: "$400" },
      { label: "From incentives", value: "98.5%" },
      { label: "Avg 2 epochs", value: "$305" },
      { label: "Per vote", value: "$40.00" },
    ])
    expect(view?.bars[0]?.parts).toEqual([10, 200])
  })

  it("never passes a floor off as a total", () => {
    const floor = paidByEpoch(
      [item(1, { [unknown]: 7n }, {}, true), item(2, {}, {}, true)],
      prices,
      now,
    )
    const view = paidToVoters(floor, 3, true, null)
    expect(view?.stats.at(-1)).toEqual({
      label: "All epochs",
      value: "Unpriced",
    })
    expect(view?.bars[0]?.text).toBe("Unpriced")
    // No change between epochs whose totals leave a token out.
    expect(view?.stats.some((stat) => stat.label.startsWith("vs"))).toBe(false)
  })
})
