import type {
  WalletLock,
  WalletOverview,
} from "@matchbox/contracts/read-models"
import {
  demoGauges,
  demoWalletOverview,
} from "@matchbox/contracts/read-models/fixtures"
import { epochStartOf } from "@matchbox/domain"
import { describe, expect, it } from "vitest"
import { sharesOfAll } from "../components/lock-cards"
import { votedIn } from "../features/vote/ballot"
import { gaugeDisplayName, gaugeRef, voter } from "./adapters"

const now = Math.floor(Date.now() / 1000)
const thisEpoch = epochStartOf(now)

const base = demoWalletOverview.locks.find((lock) => lock.escrow === "vemezo")
if (base === undefined || base.vote.status !== "voted") {
  throw new Error("fixture")
}
const snf = demoGauges.kilnLabs
const aerodrome = demoGauges.aerodromeMezoMusd

/**
 * Lock #224 on 12 Nov 2026: 1,702,812 veMEZO on a veBTC gauge through
 * BoostVoter and 1,451,855 on a MEZO gauge through ThirdPartyVoter.
 */
function lock224(times: { boost: number; thirdParty: number }): WalletLock {
  if (base === undefined || base.vote.status !== "voted") {
    throw new Error("fixture")
  }
  return {
    ...base,
    tokenId: "224",
    votingPower: "1702812",
    vote: {
      ...base.vote,
      votes: "3154667",
      allocations: [
        { gauge: snf, basisPoints: 5398 },
        { gauge: aerodrome, basisPoints: 4602 },
      ],
      votedAt: Math.max(times.boost, times.thirdParty),
      byVoter: [
        {
          voter: "boost",
          votes: "1702812",
          allocations: [{ gauge: snf, basisPoints: 10_000 }],
          votedAt: times.boost,
        },
        {
          voter: "third-party",
          votes: "1451855",
          allocations: [{ gauge: aerodrome, basisPoints: 10_000 }],
          votedAt: times.thirdParty,
        },
      ],
    },
  }
}

function adapted(lock: WalletLock) {
  const overview: WalletOverview = { ...demoWalletOverview, locks: [lock] }
  const [first] = voter(overview).locks
  if (first === undefined) throw new Error("no lock")
  return first
}

describe("a lock's votes, per voter", () => {
  it("reads 100% on each voter, not a 54/46 split of one budget", () => {
    const lock = adapted(
      lock224({ boost: thisEpoch - 86_400, thirdParty: thisEpoch - 86_400 }),
    )
    expect(
      lock.votes.map((vote) => [vote.gauge.voter, vote.shareBps, vote.weight]),
    ).toEqual([
      ["boost", 10_000, `1702812${"0".repeat(18)}`],
      ["third-party", 10_000, `1451855${"0".repeat(18)}`],
    ])
    // The lock card's one bar is by weight across both.
    expect(sharesOfAll(lock.votes).map((vote) => vote.shareBps)).toEqual([
      5397, 4602,
    ])
  })

  it("knows which voter the lock voted through this epoch", () => {
    // Voted on veBTC gauges this epoch, on MEZO gauges two weeks ago.
    const lock = adapted(
      lock224({ boost: thisEpoch + 1, thirdParty: thisEpoch - 1_209_600 }),
    )
    expect(lock.votedThisEpoch).toBe(true)
    expect(lock.votedVoters).toEqual(["boost"])
    expect(votedIn(lock, "vebtc")).toBe(true)
    // ThirdPartyVoter still takes its vote now.
    expect(votedIn(lock, "mezo")).toBe(false)
  })

  it("falls back to the lock's latest vote for a document without per-voter votes", () => {
    const withTimes = lock224({
      boost: thisEpoch + 1,
      thirdParty: thisEpoch - 1_209_600,
    })
    if (withTimes.vote.status !== "voted") throw new Error("fixture")
    const lock = adapted({
      ...withTimes,
      vote: { ...withTimes.vote, byVoter: [] },
    })
    expect(lock.votedVoters).toBeUndefined()
    expect(lock.votes.map((vote) => vote.shareBps)).toEqual([5398, 4602])
    // One time for both voters: either type counts as voted.
    expect(votedIn(lock, "vebtc")).toBe(true)
    expect(votedIn(lock, "mezo")).toBe(true)
  })
})

describe("gauge names", () => {
  it("drops the spaces a hand-typed profile name came with", () => {
    // SNF's profile name is "SNF ": its title read "SNF , Matchbox Pro".
    const ref = gaugeRef({ ...demoGauges.kilnLabs, name: "SNF " })
    expect(ref.name).toBe("SNF")
    expect(gaugeDisplayName("  Kiln Labs\t")).toBe("Kiln Labs")
  })

  it("keeps a name of spaces only, which the schema allows", () => {
    expect(gaugeDisplayName(" ")).toBe(" ")
  })
})
