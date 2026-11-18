import { describe, expect, it } from "vitest"
import type { Lock } from "../data/view-models"
import { cardPill, cardRows, unlockMeta } from "./card-state"

const endsAt = Date.UTC(2026, 10, 12) / 1000

function lock(overrides: Partial<Lock> = {}): Lock {
  return {
    kind: "vemezo",
    tokenId: "2930",
    amount: "500000",
    usd: "2028",
    votingPower: "500000",
    votingPowerWei: "500000000000000000000000",
    unlocksAt: null,
    expired: false,
    autoMax: true,
    votedThisEpoch: true,
    votes: [],
    claimableUsd: "0",
    projectedUsd: "10.58",
    ifVotedUsd: null,
    boost: null,
    ...overrides,
  }
}

describe("cardPill", () => {
  it("claims what the lock earned first", () => {
    expect(cardPill(lock({ claimableUsd: "3.89" }))).toEqual({
      kind: "claim",
      usd: "3.89",
    })
    expect(
      cardPill(
        lock({ claimableUsd: "0.01", expired: true, votedThisEpoch: false }),
      ),
    ).toEqual({ kind: "claim", usd: "0.01" })
  })

  it("withdraws an expired lock with nothing to claim", () => {
    expect(
      cardPill(
        lock({ expired: true, votedThisEpoch: false, claimableUsd: "0.00" }),
      ),
    ).toEqual({ kind: "withdraw" })
  })

  it("votes on the escrow's first type when the lock has not voted", () => {
    expect(cardPill(lock({ votedThisEpoch: false }))).toEqual({
      kind: "vote",
      type: "vebtc",
    })
    expect(cardPill(lock({ kind: "vebtc", votedThisEpoch: false }))).toEqual({
      kind: "vote",
      type: "validator",
    })
  })

  it("falls back to Manage", () => {
    expect(cardPill(lock())).toEqual({ kind: "manage" })
  })
})

describe("unlockMeta", () => {
  it("shows auto max, the unlock date, or the expiry date", () => {
    expect(unlockMeta(lock())).toEqual({ kind: "auto-max" })
    expect(
      unlockMeta(lock({ autoMax: false, unlocksAt: 1_835_568_000 })),
    ).toEqual({ kind: "unlocks", at: 1_835_568_000 })
    expect(
      unlockMeta(
        lock({ autoMax: false, expired: true, unlocksAt: 1_792_000_000 }),
      ),
    ).toEqual({ kind: "expired", at: 1_792_000_000 })
  })

  it("treats a lock with no unlock as auto max", () => {
    expect(unlockMeta(lock({ autoMax: false, unlocksAt: null }))).toEqual({
      kind: "auto-max",
    })
  })
})

describe("cardRows", () => {
  it("lists the vote, projected and claimable for a voted veMEZO lock", () => {
    expect(cardRows(lock({ claimableUsd: "3.89" }), endsAt)).toEqual([
      { kind: "epoch" },
      { kind: "projected", usd: "10.58" },
      { kind: "claimable", usd: "3.89", tone: "positive" },
    ])
  })

  it("leaves Projected off veBTC locks and locks without a projection", () => {
    expect(cardRows(lock({ kind: "vebtc" }), endsAt)).toEqual([
      { kind: "epoch" },
      { kind: "claimable", usd: "0", tone: "muted" },
    ])
    const { projectedUsd: _projected, ...older } = lock()
    expect(cardRows(older, endsAt).map((row) => row.kind)).toEqual([
      "epoch",
      "claimable",
    ])
  })

  it("shows the allocation a lock carries from an earlier epoch", () => {
    const carried = lock({
      votedThisEpoch: false,
      votes: [
        {
          gauge: {
            address: "0x1",
            voter: "boost",
            name: "SNF",
            picture: { kind: "initials", initials: "SN" },
            color: { light: "#000", dark: "#fff" },
          } as Lock["votes"][number]["gauge"],
          weight: "500000",
          shareBps: 10_000,
        },
      ],
    })
    expect(cardRows(carried, endsAt)).toEqual([
      { kind: "epoch" },
      { kind: "projected", usd: "10.58" },
      { kind: "claimable", usd: "0", tone: "muted" },
    ])
    expect(cardPill(carried)).toEqual({ kind: "manage" })
  })

  it("flags a lock that has not voted, with the epoch's end", () => {
    expect(cardRows(lock({ votedThisEpoch: false }), endsAt)).toEqual([
      { kind: "not-voted", endsAt },
    ])
    expect(
      cardRows(
        lock({ votedThisEpoch: false, ifVotedUsd: "0.09", claimableUsd: "1" }),
        endsAt,
      ),
    ).toEqual([
      { kind: "not-voted", endsAt },
      { kind: "if-voted", usd: "0.09" },
      { kind: "claimable", usd: "1", tone: "positive" },
    ])
  })

  it("shows only Claimable on an expired lock", () => {
    expect(
      cardRows(
        lock({ expired: true, votedThisEpoch: false, claimableUsd: "0.00" }),
        endsAt,
      ),
    ).toEqual([{ kind: "claimable", usd: "0.00", tone: "muted" }])
  })
})
