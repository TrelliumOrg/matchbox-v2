import { describe, expect, it } from "vitest"
import {
  blockLabel,
  cardActions,
  type LockAction,
  type LockFacts,
  lockEligibility,
  mergeEligibility,
  resetClearsAt,
  viewFacts,
} from "./eligibility"

// Epoch 47 starts Thu 5 Nov 2026 00:00 UTC.
const epoch47 = Date.UTC(2026, 10, 5) / 1000
const epoch48 = epoch47 + 7 * 86_400
const hour = 3_600
/** Mon 9 Nov 2026 12:00 UTC, mid epoch. */
const now = epoch47 + 4 * 86_400 + 12 * hour
const year = 365 * 86_400

function lock(overrides: Partial<LockFacts> = {}): LockFacts {
  return {
    kind: "vemezo",
    tokenId: "2930",
    end: now + year,
    vestingEnd: 0,
    managed: false,
    votedAt: [],
    ...overrides,
  }
}

const every: LockAction[] = ["add", "extend", "merge", "transfer", "withdraw"]

function reason(
  result: ReturnType<typeof lockEligibility>,
): string | { reset: boolean; autoMaxOff?: true } {
  if (!result.ok) return blockLabel(result.block)
  return result.autoMaxOff
    ? { reset: result.reset, autoMaxOff: true }
    : { reset: result.reset }
}

describe("lockEligibility", () => {
  it("lets a plain lock add, extend, merge and transfer, not withdraw", () => {
    expect(
      every.map((action) => reason(lockEligibility(lock(), action, now))),
    ).toEqual([
      { reset: false },
      { reset: false },
      { reset: false },
      { reset: false },
      "Unlocks 9 Nov 2027",
    ])
  })

  it("keeps a vesting lock read-only until vesting ends", () => {
    // veMEZO #2322's vestingEnd on mainnet.
    const vesting = lock({
      tokenId: "2322",
      end: 1_870_905_600 + year,
      vestingEnd: 1_870_905_600,
    })
    for (const action of every) {
      expect(reason(lockEligibility(vesting, action, now))).toBe(
        "Vesting until Sun 15 Apr 2029",
      )
    }
    expect(lockEligibility(vesting, "add", 1_870_905_600)).toEqual({
      ok: true,
      reset: false,
      autoMaxOff: false,
    })
  })

  it("keeps a managed lock read-only", () => {
    for (const action of every) {
      expect(
        reason(lockEligibility(lock({ managed: true }), action, now)),
      ).toBe("Managed lock")
    }
  })

  it("lets an expired lock only withdraw", () => {
    const expired = lock({ end: now - hour })
    expect(
      every.map((action) => reason(lockEligibility(expired, action, now))),
    ).toEqual(["Expired", "Expired", "Expired", "Expired", { reset: false }])
    expect(
      reason(lockEligibility(lock({ end: now }), "withdraw", now)),
    ).toEqual({ reset: false })
  })

  it("never extends or withdraws an auto max lock, and turns it off to merge", () => {
    const autoMax = lock({ end: null })
    expect(
      every.map((action) => reason(lockEligibility(autoMax, action, now))),
    ).toEqual([
      { reset: false },
      "Auto max is on",
      { reset: false, autoMaxOff: true },
      { reset: false },
      "Auto max is on",
    ])
    // unlockPermanent and merge both revert AlreadyVoted until a reset.
    const voted = lock({ end: null, votedAt: [epoch47 - 2 * 86_400] })
    expect(reason(lockEligibility(voted, "merge", now))).toEqual({
      reset: true,
      autoMaxOff: true,
    })
    expect(reason(lockEligibility(voted, "auto-max-off", now))).toEqual({
      reset: true,
    })
  })

  it("resets a lock that voted in an earlier epoch before merge or withdraw", () => {
    const voted = lock({ votedAt: [epoch47 - 2 * 86_400] })
    expect(reason(lockEligibility(voted, "merge", now))).toEqual({
      reset: true,
    })
    // The escrow moves a lock with its votes (no AlreadyVoted on transfer).
    expect(reason(lockEligibility(voted, "transfer", now))).toEqual({
      reset: false,
    })
    expect(
      reason(lockEligibility({ ...voted, end: now - 1 }, "withdraw", now)),
    ).toEqual({ reset: true })
    expect(reason(lockEligibility(voted, "add", now))).toEqual({
      reset: false,
    })
    expect(reason(lockEligibility(voted, "extend", now))).toEqual({
      reset: false,
    })
  })

  it("holds a lock voted this epoch until next Thursday 01:00", () => {
    const voted = lock({ votedAt: [epoch47 + 2 * hour] })
    expect(reason(lockEligibility(voted, "transfer", now))).toEqual({
      reset: false,
    })
    const result = lockEligibility(voted, "merge", now)
    expect(result).toEqual({
      ok: false,
      block: { kind: "voted", clearsAt: epoch48 + hour + 1, now },
    })
    expect(reason(result)).toBe("Voted, clears Thu 12 Nov 01:00")
    expect(reason(lockEligibility(voted, "merge", epoch48 - 2 * hour))).toBe(
      "Voted, clears at 01:00",
    )
  })

  it("waits on the voter that clears last", () => {
    const voted = lock({ votedAt: [epoch47 - 86_400, epoch47 + hour] })
    expect(lockEligibility(voted, "merge", now)).toMatchObject({
      ok: false,
      block: { kind: "voted", clearsAt: epoch48 + hour + 1 },
    })
  })
})

describe("the reset window", () => {
  const lastVoted = epoch47 - 86_400

  it("is closed from Thu 00:00 through 01:00 UTC", () => {
    const opens = epoch48 + hour + 1
    expect(resetClearsAt(lastVoted, epoch48 - 1)).toBe(epoch48 - 1)
    expect(resetClearsAt(lastVoted, epoch48)).toBe(opens)
    expect(resetClearsAt(lastVoted, epoch48 + hour - 1)).toBe(opens)
    expect(resetClearsAt(lastVoted, epoch48 + hour)).toBe(opens)
    expect(resetClearsAt(lastVoted, opens)).toBe(opens)
  })

  it("blocks the reset step inside the window and says when it clears", () => {
    const voted = lock({ votedAt: [lastVoted] })
    const inside = epoch48 + 20 * 60
    expect(reason(lockEligibility(voted, "merge", inside))).toBe(
      "Voted, clears at 01:00",
    )
    expect(reason(lockEligibility(voted, "merge", epoch48 + hour + 1))).toEqual(
      { reset: true },
    )
  })

  it("counts a vote cast at the epoch's first second as this epoch's", () => {
    expect(resetClearsAt(epoch47, now)).toBe(epoch48 + hour + 1)
    expect(resetClearsAt(epoch47 - 1, now)).toBe(now)
  })
})

describe("mergeEligibility", () => {
  const from = lock({ tokenId: "3011" })

  it("lets a lock merge into another of its escrow", () => {
    expect(mergeEligibility(from, lock(), now)).toEqual({
      ok: true,
      reset: false,
      autoMaxOff: false,
    })
  })

  it("names each target it cannot merge into", () => {
    const targets: [Partial<LockFacts>, string][] = [
      [{ kind: "vebtc", tokenId: "4120" }, "Other escrow"],
      [{ tokenId: "3011" }, "Same lock"],
      [{ end: now - 1 }, "Expired"],
      [{ vestingEnd: 1_870_905_600 }, "Vesting until Sun 15 Apr 2029"],
      [{ managed: true }, "Managed lock"],
    ]
    for (const [target, label] of targets) {
      const result = mergeEligibility(from, lock(target), now)
      expect(result.ok ? null : blockLabel(result.block)).toBe(label)
    }
  })

  it("merges into an auto max lock or one that voted", () => {
    expect(mergeEligibility(from, lock({ end: null }), now).ok).toBe(true)
    expect(
      mergeEligibility(from, lock({ votedAt: [epoch47 + hour] }), now).ok,
    ).toBe(true)
  })

  it("carries the source's own block and reset", () => {
    const voted = { ...from, votedAt: [epoch47 + hour] }
    expect(reason(mergeEligibility(voted, lock(), now))).toBe(
      "Voted, clears Thu 12 Nov 01:00",
    )
    expect(
      mergeEligibility({ ...from, votedAt: [epoch47 - 1] }, lock(), now),
    ).toEqual({ ok: true, reset: true, autoMaxOff: false })
    expect(
      mergeEligibility({ ...from, vestingEnd: now + 1 }, lock(), now).ok,
    ).toBe(false)
  })
})

describe("cardActions", () => {
  const live = {
    expired: false,
    unlocksAt: now + year,
    autoMax: false,
    votedThisEpoch: false,
  }

  it("offers add, extend, merge and transfer on a live lock", () => {
    expect(cardActions(live)).toEqual([
      { action: "add", note: null },
      { action: "extend", note: null },
      { action: "merge", note: null },
      { action: "transfer", note: null },
    ])
  })

  it("notes auto max on extend, and keeps every action open", () => {
    expect(cardActions({ ...live, unlocksAt: null, autoMax: true })).toEqual([
      { action: "add", note: null },
      { action: "extend", note: "Auto max" },
      { action: "merge", note: null },
      { action: "transfer", note: null },
    ])
  })

  it("notes a vote this epoch on merge only (transfer moves the votes)", () => {
    expect(cardActions({ ...live, votedThisEpoch: true })).toEqual([
      { action: "add", note: null },
      { action: "extend", note: null },
      { action: "merge", note: "Voted this epoch" },
      { action: "transfer", note: null },
    ])
  })

  it("only withdraws an expired lock", () => {
    expect(cardActions({ ...live, expired: true, unlocksAt: now - 1 })).toEqual(
      [{ action: "withdraw", note: null }],
    )
  })
})

describe("viewFacts", () => {
  it("knows expiry and auto max from the read model", () => {
    const base = { kind: "vemezo", tokenId: "2930" } as const
    expect(viewFacts({ ...base, unlocksAt: null, expired: false }).end).toBe(
      null,
    )
    const expired = viewFacts({ ...base, unlocksAt: now + year, expired: true })
    expect(lockEligibility(expired, "merge", now)).toEqual({
      ok: false,
      block: { kind: "expired" },
    })
    expect(
      viewFacts({ ...base, unlocksAt: now + year, expired: false }),
    ).toEqual(lock({ end: now + year }))
  })
})
