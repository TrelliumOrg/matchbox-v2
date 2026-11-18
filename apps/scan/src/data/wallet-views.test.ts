import {
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import {
  barsSince,
  centsOf,
  rewardBars,
  veMezoVotes,
  voteStreak,
  walletView,
} from "./wallet-views"

/** Mon 9 Nov 2026, in Epoch 47 (the demo data's current epoch). */
const now = 1_794_200_000

describe("a wallet's rewards", () => {
  const view = walletView(demoWalletRewards, demoWalletOverview, now)

  it("says what it can claim and for which epoch's votes", () => {
    expect(view.claimable).toEqual({
      usd: "$212.48",
      symbols: ["BTC", "MEZO", "MUSD"],
      epoch: 46,
      storedAt: null,
    })
  })

  it("adds up the claims read, as rewards by epoch draws them", () => {
    // Four claims, Epochs 42 to 45: the tile and the chart agree.
    expect(view.claimed).toEqual({
      usd: "$2,457.40",
      epochs: 4,
      capped: false,
    })
    const drawn = view.bars
      .filter((bar) => !bar.projected)
      .reduce((sum, bar) => sum + bar.cents, 0)
    expect(drawn).toBe(245_740)
    expect(view.claims).toHaveLength(demoWalletRewards.history.length)
    expect(view.claims[0]?.epoch).toBe(45)
  })

  it("says when the history is only the latest claims", () => {
    const [claim] = demoWalletRewards.history
    if (claim === undefined) throw new Error("demo")
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      ...claim,
      epoch: {
        ...claim.epoch,
        start: claim.epoch.start - index * 604_800,
      },
    }))
    const capped = walletView(
      { ...demoWalletRewards, history: twelve },
      null,
      now,
    )
    expect(capped.claimed).toMatchObject({ epochs: 12, capped: true })
  })

  it("stacks each epoch's claims by coin, then the projected epoch", () => {
    const last = view.bars.at(-1)
    expect(last).toMatchObject({ epoch: 47, projected: true })
    expect(last?.text).toBe("$207.14")
    const claimed = view.bars.filter((bar) => !bar.projected)
    for (const bar of claimed) {
      const parts = bar.parts.reduce((sum, part) => sum + part.cents, 0)
      expect(parts).toBe(bar.cents)
    }
    // Every epoch from the first claim (42) to the projected, none skipped.
    const epochs = view.bars.map((bar) => bar.epoch)
    expect(epochs).toEqual(
      Array.from({ length: epochs.length }, (_, index) => 42 + index),
    )
  })

  it("fills an epoch without claims with an empty bar", () => {
    const [first, second] = demoWalletRewards.history.slice(-2)
    if (first === undefined || second === undefined) throw new Error("demo")
    const gap = {
      ...second,
      epoch: {
        ...second.epoch,
        start: second.epoch.start - 2 * 604_800,
      },
    }
    const bars = rewardBars([first, gap], null)
    expect(bars.map((bar) => bar.cents === 0)).toContain(true)
  })

  it("keeps the period's epochs", () => {
    const bars = barsSince(view.bars, 47, 5)
    expect(bars.every((bar) => bar.epoch > 42)).toBe(true)
    expect(barsSince(view.bars, 47, null)).toHaveLength(view.bars.length)
  })

  it("reads nothing to claim as no tile", () => {
    const none = walletView(
      {
        ...demoWalletRewards,
        readyToClaim: { usd: "0.00", tokens: [] },
        history: [],
        earned: { usd: "0.00", fromEpoch: null, toEpoch: null },
      },
      null,
      now,
    )
    expect(none.claimable).toBeNull()
    expect(none.claimed).toBeNull()
    expect(none.bars).toEqual([])
    expect(none.veMezo).toBeNull()
  })

  it("rounds cents half up, never with floats", () => {
    expect(centsOf("212.485")).toBe(21_249n)
    expect(centsOf("0.004")).toBe(0n)
    expect(centsOf(null)).toBe(0n)
  })
})

describe("veMEZO votes", () => {
  it("adds the locks' power and the share cast this epoch", () => {
    expect(veMezoVotes(demoWalletOverview, 47)).toEqual({
      votes: "41,260",
      usedBps: 10_000,
      epoch: 47,
      voted: true,
      // $8.75 a week over $8,832 locked, 52 weeks.
      projectedApr: "5.15%",
    })
  })

  it("says a lock that has not voted", () => {
    const [, mezo] = demoWalletOverview.locks
    if (mezo === undefined) throw new Error("demo")
    const overview = {
      ...demoWalletOverview,
      locks: [
        {
          ...mezo,
          vote: { status: "not-voted" as const, epoch: mezo.vote.epoch },
          projected: null,
        },
      ],
    }
    expect(veMezoVotes(overview, 47)).toMatchObject({
      usedBps: 0,
      voted: false,
      epoch: 47,
      projectedApr: null,
    })
  })
})

describe("the voting streak", () => {
  it("counts epochs in a row up to the current one", () => {
    const streak = voteStreak(new Set([40, 41, 42, 43, 44, 45, 46, 47]), 47)
    expect(streak).toMatchObject({ streak: 8, more: false, missed: 39 })
    expect(streak.squares.map((square) => square.epoch)).toEqual([
      39, 40, 41, 42, 43, 44, 45, 46, 47,
    ])
    expect(streak.squares.at(-1)).toEqual({
      epoch: 47,
      voted: true,
      current: true,
    })
  })

  it("runs to the epoch before while this one has no votes yet", () => {
    expect(voteStreak(new Set([45, 46]), 47)).toMatchObject({
      streak: 2,
      missed: 44,
    })
  })

  it("says the streak may be longer than the window", () => {
    const all = new Set(Array.from({ length: 9 }, (_, index) => 39 + index))
    expect(voteStreak(all, 47)).toMatchObject({
      streak: 9,
      more: true,
      missed: null,
    })
  })

  it("is zero after a missed epoch", () => {
    expect(voteStreak(new Set([42]), 47)).toMatchObject({
      streak: 0,
      missed: 46,
    })
  })
})
