import { describe, expect, it } from "vitest"
import { canonicalUrl, scanOrigin, shareTags } from "./site"

describe("site origin", () => {
  it("names scan.matchbox.markets, never a workers.dev host", () => {
    expect(scanOrigin).toBe("https://scan.matchbox.markets")
    expect(canonicalUrl("/tx/0xab")).toBe(
      "https://scan.matchbox.markets/tx/0xab",
    )
    expect(canonicalUrl("/")).toBe("https://scan.matchbox.markets/")
    expect(canonicalUrl("/gauges/")).toBe(
      "https://scan.matchbox.markets/gauges",
    )
    const tags = shareTags("/epochs/47", "Epoch 47", "Mezo")
    expect(JSON.stringify(tags)).not.toContain("workers.dev")
    expect(tags.links).toEqual([
      { rel: "canonical", href: "https://scan.matchbox.markets/epochs/47" },
    ])
  })
})
