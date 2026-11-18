import { describe, expect, it } from "vitest"
import { perThousandVotes } from "./incentive-estimate"

const votes = (whole: bigint): string => `${whole * 10n ** 18n}`

describe("what an incentive pays per 1,000 votes", () => {
  it("divides the addition by the gauge's votes now", () => {
    // The design's case: $250 on 2.18M votes.
    expect(perThousandVotes("250.00", votes(2_180_000n))).toBe("About $0.11")
    expect(perThousandVotes("1000.00", votes(1_000n))).toBe("About $1,000.00")
  })

  it("does not print a zero for a small addition", () => {
    expect(perThousandVotes("1.00", votes(5_000_000n))).toBe("Under $0.01")
  })

  it("gives nothing without votes or without an amount", () => {
    expect(perThousandVotes("250.00", "0")).toBeNull()
    expect(perThousandVotes("250.00", "999999999999999999")).toBeNull()
    expect(perThousandVotes("0.00", votes(1_000n))).toBeNull()
  })
})
