import {
  demoPrices,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { carryClaimable } from "./carry-claimable"

const [veBtc, veMezo] = demoWalletOverview.locks
if (veBtc === undefined || veMezo === undefined) throw new Error("fixture")
const keyOf = (lock: { escrow: string; tokenId: string }) =>
  `${lock.escrow}:${lock.tokenId}`

const nothing = { usd: "0.00", tokens: [] }
/** This run's build: the veMEZO lock read, the veBTC lock not. */
const built = {
  overview: {
    ...demoWalletOverview,
    locks: [{ ...veBtc, claimable: nothing }, veMezo],
    claimable: veMezo.claimable,
  },
  rewards: {
    ...demoWalletRewards,
    readyToClaim: veMezo.claimable,
    byLock: demoWalletRewards.byLock.filter(
      (entry) => keyOf(entry.lock) === keyOf(veMezo),
    ),
  },
}
const previous = {
  overview: demoWalletOverview,
  rewards: demoWalletRewards,
  block: 13_100_000,
}

describe("carrying claimable into a rebuilt wallet", () => {
  it("keeps the last figure for a lock this run did not read", () => {
    const carried = carryClaimable({
      built,
      previous,
      unread: new Set([keyOf(veBtc)]),
      block: 13_180_000,
      prices: demoPrices,
    })
    const [first, second] = carried.overview.locks
    // Not zero: what the last document had.
    expect(first?.claimable).toEqual(veBtc.claimable)
    expect(second?.claimable).toEqual(veMezo.claimable)
    // The totals count both again, and Rewards lists both locks.
    expect(carried.overview.claimable.usd).toBe(
      demoWalletOverview.claimable.usd,
    )
    expect(carried.rewards.readyToClaim.tokens).toEqual(
      carried.overview.claimable.tokens,
    )
    expect(
      carried.rewards.byLock.map((entry) => keyOf(entry.lock)).sort(),
    ).toEqual([keyOf(veBtc), keyOf(veMezo)].sort())
    // And it says when that figure was read: the earlier block.
    expect(carried.overview.claimableAsOf).toEqual({
      block: 13_100_000,
      source: "stored",
      partial: false,
    })
    expect(carried.rewards.claimableAsOf).toEqual(
      carried.overview.claimableAsOf,
    )
  })

  it("keeps the first block through several carried runs", () => {
    const once = carryClaimable({
      built,
      previous,
      unread: new Set([keyOf(veBtc)]),
      block: 13_180_000,
      prices: demoPrices,
    })
    const twice = carryClaimable({
      built,
      previous: {
        overview: once.overview,
        rewards: once.rewards,
        block: 13_180_000,
      },
      unread: new Set([keyOf(veBtc)]),
      block: 13_181_000,
      prices: demoPrices,
    })
    expect(twice.overview.claimableAsOf?.block).toBe(13_100_000)
    expect(twice.overview.locks[0]?.claimable).toEqual(veBtc.claimable)
  })

  it("stamps this run's block when every lock was read", () => {
    const read = carryClaimable({
      built,
      previous,
      unread: new Set(),
      block: 13_180_000,
      prices: demoPrices,
    })
    expect(read.overview.locks).toEqual(built.overview.locks)
    expect(read.overview.claimableAsOf).toEqual({
      block: 13_180_000,
      source: "stored",
      partial: false,
    })
  })

  it("has nothing to carry for a lock the wallet did not have before", () => {
    const carried = carryClaimable({
      built,
      previous: {
        ...previous,
        overview: { ...demoWalletOverview, locks: [veMezo] },
      },
      unread: new Set([keyOf(veBtc)]),
      block: 13_180_000,
      prices: demoPrices,
    })
    expect(carried.overview.locks[0]?.claimable).toEqual(nothing)
  })
})
