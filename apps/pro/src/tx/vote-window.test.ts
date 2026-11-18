import { describe, expect, it } from "vitest"
import {
  canReset,
  epochNext,
  epochStart,
  voteBlock,
  votedThisEpoch,
  voteWindow,
} from "./vote-window"

// Thu 5 Nov 2026 00:00 UTC, an epoch flip.
const flip = Date.UTC(2026, 10, 5) / 1000

describe("voteWindow", () => {
  it("flips epochs on Thursday 00:00 UTC", () => {
    expect(new Date(epochStart(flip + 100) * 1000).getUTCDay()).toBe(4)
    expect(epochStart(flip + 100)).toBe(flip)
    expect(epochNext(flip + 100)).toBe(flip + 7 * 86_400)
  })

  it("reverts votes in the first hour (DistributeWindow)", () => {
    expect(voteWindow(flip + 30 * 60)).toEqual({
      kind: "distribute",
      opensAt: flip + 3_600,
    })
    expect(voteWindow(flip + 3_600).kind).toBe("distribute")
    expect(voteWindow(flip + 3_601).kind).toBe("open")
  })

  it("keeps the last hour for whitelisted locks", () => {
    const next = flip + 7 * 86_400
    expect(voteWindow(next - 3_600).kind).toBe("open")
    expect(voteWindow(next - 3_599)).toEqual({
      kind: "last-hour",
      flipsAt: next,
    })
  })
})

describe("voteBlock", () => {
  const midweek = flip + 3 * 86_400

  it("allows one vote per lock per epoch", () => {
    expect(votedThisEpoch(BigInt(flip + 10), midweek)).toBe(true)
    expect(votedThisEpoch(BigInt(flip - 10), midweek)).toBe(false)
    expect(
      voteBlock({
        now: midweek,
        lastVoted: [0n, BigInt(flip + 7_200)],
        whitelisted: [false, false],
      }),
    ).toBe("voted-this-epoch")
  })

  it("names the window before anything else", () => {
    expect(
      voteBlock({ now: flip + 60, lastVoted: [0n], whitelisted: [true] }),
    ).toBe("distribute-window")
  })

  it("lets whitelisted locks vote in the last hour", () => {
    const late = flip + 7 * 86_400 - 60
    expect(
      voteBlock({ now: late, lastVoted: [0n], whitelisted: [false] }),
    ).toBe("last-hour")
    expect(
      voteBlock({ now: late, lastVoted: [0n], whitelisted: [true] }),
    ).toBeNull()
  })

  it("resets only in a later epoch than the vote", () => {
    expect(canReset(BigInt(flip - 100), flip + 7_200)).toBe(true)
    expect(canReset(BigInt(flip + 7_200), flip + 9_000)).toBe(false)
    expect(canReset(0n, flip + 60)).toBe(false)
  })
})
