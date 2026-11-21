import { afterEach, describe, expect, it } from "vitest"
import type { Lock } from "../../data/view-models"
import {
  changeLine,
  clearSaved,
  loadSaved,
  loadSavedAny,
  parseSaved,
  primaryLabel,
  savedFrom,
  savedStatus,
  splitByVote,
  startingBallot,
  storeSaved,
} from "./saved-ballots"

const gaugeA = "0x4da4c05483324ea9cfc951510a5e77cc79541159"
const gaugeB = "0x00000000000000000000000000000000000000b2"

function lock(fields: Partial<Lock> & Pick<Lock, "tokenId">): Lock {
  return {
    kind: "vemezo",
    amount: "1",
    usd: "1",
    votingPower: "1",
    votingPowerWei: "1000000000000000000",
    unlocksAt: null,
    expired: false,
    autoMax: false,
    votedThisEpoch: false,
    votes: [],
    claimableUsd: "0",
    ...fields,
  }
}

afterEach(() => window.localStorage.clear())

describe("saving changes for a lock that voted this epoch", () => {
  const voted = lock({
    tokenId: "2207",
    votedThisEpoch: true,
    votes: [
      {
        gauge: { address: gaugeA, name: "Kiln Labs", voter: "boost" },
        shareBps: 10_000,
        weight: "1",
      } as unknown as Lock["votes"][number],
    ],
  })
  const fresh = lock({ tokenId: "3011" })

  it("signs the unvoted locks now and saves the voted ones", () => {
    expect(splitByVote([voted, fresh])).toEqual({
      sign: [fresh],
      save: [voted],
    })
    expect(primaryLabel([voted], 47)).toBe("Save for Epoch 48")
    expect(primaryLabel([voted, fresh], 47)).toBe("Review and sign")
    expect(primaryLabel([voted, fresh, lock({ tokenId: "3012" })], 47)).toBe(
      "Review and sign, 2 signatures",
    )
    expect(primaryLabel([fresh], 47)).toBe("Review and sign")
  })

  it("starts the ballot from the saved split, else the lock's votes", () => {
    const any = () => true
    expect([...startingBallot([voted], () => null, "vebtc", any)]).toEqual([
      [gaugeA, 10_000],
    ])
    const saved = savedFrom(
      new Map([
        [gaugeA, 4_000],
        [gaugeB, 6_000],
        ["0x00000000000000000000000000000000000000c3", 0],
      ]),
      47,
      1_000,
    )
    expect(saved).toEqual({
      forEpoch: 48,
      picks: [
        [gaugeA, 4_000],
        [gaugeB, 6_000],
      ],
      savedAt: 1_000,
    })
    expect([
      ...startingBallot(
        [fresh, voted],
        (each) => (each === voted ? saved : null),
        "vebtc",
        any,
      ),
    ]).toEqual([
      [gaugeA, 4_000],
      [gaugeB, 6_000],
    ])
  })

  it("keeps only the type's gauges from a split saved across two types", () => {
    // Saved before each type had its own ballot: A is a veBTC gauge, B a
    // MEZO gauge, sharing one 100%.
    const mixed = savedFrom(
      new Map([
        [gaugeA, 5_400],
        [gaugeB, 4_600],
      ]),
      47,
      1,
    )
    expect([
      ...startingBallot(
        [voted],
        () => mixed,
        "mezo",
        (id) => id === gaugeB,
      ),
    ]).toEqual([[gaugeB, 4_600]])
    // Nothing of the type in the saved split: the lock's votes in it.
    const mezoOnly = savedFrom(new Map([[gaugeB, 10_000]]), 47, 1)
    expect([
      ...startingBallot(
        [voted],
        () => mezoOnly,
        "vebtc",
        (id) => id === gaugeA,
      ),
    ]).toEqual([[gaugeA, 10_000]])
  })

  it("leaves a vote on a gauge the list does not show off the ballot", () => {
    expect([
      ...startingBallot(
        [voted],
        () => null,
        "vebtc",
        () => false,
      ),
    ]).toEqual([])
  })

  it("keeps a split per wallet and lock, in this browser", () => {
    const saved = savedFrom(new Map([[gaugeA, 10_000]]), 47, 1)
    storeSaved("0xABC", voted, "vebtc", saved)
    expect(loadSaved("0xabc", voted, "vebtc")).toEqual(saved)
    expect(loadSaved("0xabc", fresh, "vebtc")).toBeNull()
    expect(loadSaved("0xdef", voted, "vebtc")).toBeNull()
    clearSaved("0xabc", voted, "vebtc")
    expect(loadSaved("0xabc", voted, "vebtc")).toBeNull()
  })

  it("keeps one split per gauge type, each with its own 100%", () => {
    const boost = savedFrom(new Map([[gaugeA, 10_000]]), 47, 1)
    const cross = savedFrom(new Map([[gaugeB, 10_000]]), 47, 2)
    storeSaved("0xabc", voted, "vebtc", boost)
    storeSaved("0xabc", voted, "mezo", cross)
    expect(loadSaved("0xabc", voted, "vebtc")).toEqual(boost)
    expect(loadSaved("0xabc", voted, "mezo")).toEqual(cross)
    clearSaved("0xabc", voted, "vebtc")
    expect(loadSaved("0xabc", voted, "vebtc")).toBeNull()
    expect(loadSaved("0xabc", voted, "mezo")).toEqual(cross)
    expect(loadSavedAny("0xabc", voted)).toEqual(cross)
  })

  it("still reads a split saved under the old key, for either type", () => {
    const old = savedFrom(new Map([[gaugeA, 10_000]]), 47, 1)
    window.localStorage.setItem(
      "mbx-vote-saved:0xabc:vemezo:2207",
      JSON.stringify(old),
    )
    expect(loadSaved("0xabc", voted, "vebtc")).toEqual(old)
    expect(loadSaved("0xabc", voted, "mezo")).toEqual(old)
    expect(loadSavedAny("0xabc", voted)).toEqual(old)
    clearSaved("0xabc", voted, "vebtc")
    expect(loadSavedAny("0xabc", voted)).toBeNull()
  })

  it("ignores anything in storage that is not a saved split", () => {
    expect(parseSaved("not json")).toBeNull()
    expect(
      parseSaved('{"forEpoch":48,"picks":[["x",1]],"savedAt":1}'),
    ).toBeNull()
    expect(
      parseSaved(`{"forEpoch":48,"picks":[["${gaugeA}",10001]],"savedAt":1}`),
    ).toBeNull()
  })

  it("waits for the next epoch, then offers the split to sign", () => {
    const saved = savedFrom(new Map([[gaugeA, 10_000]]), 47, 1)
    expect(savedStatus(null, voted, 47)).toBeNull()
    expect(savedStatus(saved, voted, 47)).toBe("pending")
    // Epoch 48 opens: the lock has not voted yet.
    expect(savedStatus(saved, { ...voted, votedThisEpoch: false }, 48)).toBe(
      "ready",
    )
    // It voted in Epoch 48 (signed here or elsewhere): spent.
    expect(savedStatus(saved, voted, 48)).toBeNull()
  })

  it("says from when votes can change, after the first hour", () => {
    // Epoch 47 ends Thu 12 Nov 2026 00:00 UTC.
    expect(changeLine(Date.UTC(2026, 10, 12) / 1_000)).toBe(
      "Votes can change from Thu 12 Nov 01:00 UTC",
    )
  })
})
