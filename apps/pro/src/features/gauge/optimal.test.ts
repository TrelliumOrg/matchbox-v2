import { describe, expect, it } from "vitest"
import { optimalVotes, votesContext } from "./optimal"

const wei = (whole: bigint): string => `${whole * 10n ** 18n}`

describe("a gauge's optimal votes", () => {
  it("is the 5x point of a boost gauge", () => {
    const boost = {
      optimalVotes: wei(6_970_000n),
      votesUnit: "veMEZO",
    } as const
    expect(optimalVotes(boost)).toBe(6_970_000n)
    expect(votesContext(boost)).toBe("of 6.97M optimal")
  })

  it("does not exist for pool, validator and MEZO gauges", () => {
    const pool = { optimalVotes: null, votesUnit: "veBTC" } as const
    expect(optimalVotes(pool)).toBeNull()
    // The unit, never "N of N optimal".
    expect(votesContext(pool)).toBe("veBTC")
    expect(votesContext({ optimalVotes: null, votesUnit: "veMEZO" })).toBe(
      "veMEZO",
    )
  })
})
