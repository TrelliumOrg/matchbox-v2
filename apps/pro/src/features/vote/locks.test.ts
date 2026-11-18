import { afterEach, describe, expect, it } from "vitest"
import type { Lock } from "../../data/view-models"
import { ballotGauges, ownVotes, perLock, powerOf, project } from "./ballot"
import {
  initialSelection,
  loadSelection,
  lockBlock,
  saveSelection,
} from "./locks"

const wei = (whole: bigint): string => `${whole * 10n ** 18n}`

function lock(fields: Partial<Lock> & Pick<Lock, "tokenId">): Lock {
  return {
    kind: "vemezo",
    amount: "1",
    usd: "1",
    votingPower: "1",
    votingPowerWei: wei(1n),
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

describe("which locks vote", () => {
  it("says why a lock cannot be picked (a vote this epoch does not block)", () => {
    expect(lockBlock(lock({ tokenId: "1" }))).toBeNull()
    expect(lockBlock(lock({ tokenId: "2", votedThisEpoch: true }))).toBeNull()
    expect(lockBlock(lock({ tokenId: "3", expired: true }))).toBe("Expired")
    expect(lockBlock(lock({ tokenId: "4", votingPowerWei: "0" }))).toBe(
      "No voting power",
    )
  })

  it("starts from every lock that can vote, or what was remembered", () => {
    const locks = [
      lock({ tokenId: "2930" }),
      lock({ tokenId: "3011" }),
      lock({ tokenId: "2322", votedThisEpoch: true }),
    ]
    expect(initialSelection(locks, null)).toEqual(["2930", "3011"])
    // A voted lock stays picked once chosen (its changes are saved).
    expect(initialSelection(locks, ["3011", "2322"])).toEqual(["3011", "2322"])
    expect(initialSelection(locks, ["9999"])).toEqual(["2930", "3011"])
    expect(initialSelection(locks, [])).toEqual([])
  })

  it("starts from the voted locks when every lock voted this epoch", () => {
    const voted = [
      lock({ tokenId: "2207", votedThisEpoch: true }),
      lock({ tokenId: "2208", expired: true }),
    ]
    expect(initialSelection(voted, null)).toEqual(["2207"])
  })

  it("remembers the selection per wallet and type", () => {
    saveSelection("0xABC", "vebtc", ["2930"])
    expect(loadSelection("0xabc", "vebtc")).toEqual(["2930"])
    expect(loadSelection("0xabc", "mezo")).toBeNull()
    window.localStorage.setItem("mbx-vote-locks:0xabc:pool", '["x"]')
    expect(loadSelection("0xabc", "pool")).toBeNull()
  })
})

describe("voting with several locks", () => {
  const a = lock({ tokenId: "2930", votingPowerWei: wei(18_402n) })
  const b = lock({ tokenId: "3011", votingPowerWei: wei(4_180n) })

  it("sums the locks' power and splits the projection pro rata", () => {
    expect(powerOf([a, b])).toBe(BigInt(wei(22_582n)))
    const parts = perLock(10_580_000n, [a, b])
    expect(parts.get("2930")).toBe(8_621_609n)
    expect(parts.get("3011")).toBe(1_958_391n)
    expect((parts.get("2930") ?? 0n) + (parts.get("3011") ?? 0n)).toBe(
      10_580_000n,
    )
  })

  it("projects the same split over the summed power", () => {
    const gauge = {
      address: "0xaaa",
      votes: wei(100_000n),
      incentivesUsd: "1000.00",
    } as Parameters<typeof ballotGauges>[0][number]
    const ballot = new Map([["0xaaa", 10_000]])
    const together = project(
      ballotGauges([gauge], [a, b]),
      powerOf([a, b]),
      ballot,
    )
    const alone = project(ballotGauges([gauge], a), powerOf(a), ballot)
    expect(together.total).toBeGreaterThan(alone.total)
    expect(together.total).toBe(184_219_542n)
  })

  it("sums the locks' current votes per gauge", () => {
    const ref = {
      address: "0xAAA",
      voter: "boost",
      name: "Kiln Labs",
      picture: { kind: "initials", initials: "KL", hue: 1 },
      color: { light: "#000", dark: "#fff" },
    } as const
    const own = ownVotes([
      lock({
        tokenId: "1",
        votes: [{ gauge: ref, weight: "5", shareBps: 10_000 }],
      }),
      lock({
        tokenId: "2",
        votes: [{ gauge: ref, weight: "7", shareBps: 10_000 }],
      }),
    ])
    expect(own.get("0xaaa")).toBe(12n)
  })
})
