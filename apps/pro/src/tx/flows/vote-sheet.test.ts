import { describe, expect, it } from "vitest"
import { lockRetryLabel, locksLabel, multiLockVotePlan } from "./vote-sheet"

describe("multi-lock votes", () => {
  it("signs once per lock and voter, each step tagged with its lock", () => {
    const steps = multiLockVotePlan(
      [{ tokenId: "2930" }, { tokenId: "3011" }],
      [
        {
          voter: "boost",
          targets: ["0x4da4c05483324ea9cfc951510a5e77cc79541159"],
          weights: [10_000n],
        },
      ],
    )
    expect(steps.map((step) => step.id)).toEqual([
      "lock-2930:vote-boost",
      "lock-3011:vote-boost",
    ])
    const [first, second] = steps
    expect(first?.prepare(new Map()).data).not.toBe(
      second?.prepare(new Map()).data,
    )
  })

  it("names the lock to retry and the locks voting", () => {
    expect(lockRetryLabel({ id: "lock-3011:vote-boost" }, 1)).toBe(
      "Try lock #3011 again",
    )
    expect(lockRetryLabel({ id: "approve" }, 2)).toBe("Try step 3 again")
    expect(
      locksLabel([
        { kind: "vemezo", tokenId: "2930" },
        { kind: "vemezo", tokenId: "3011" },
      ] as unknown as Parameters<typeof locksLabel>[0]),
    ).toBe("veMEZO #2930, #3011")
  })
})
