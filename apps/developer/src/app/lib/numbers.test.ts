import { describe, expect, it, vi } from "vitest"
import { compactNumber, dayLabel, formatLatency, formatRate } from "./numbers"

describe("console figures", () => {
  it("compacts large counts and keeps small ones whole", () => {
    expect(compactNumber(1_240_000)).toBe("1.24M")
    expect(compactNumber(842_310)).toBe("842k")
    expect(compactNumber(7_200)).toBe("7,200")
    expect(compactNumber(214)).toBe("214")
  })

  it("says No traffic instead of a dash", () => {
    expect(formatRate(null)).toBe("No traffic")
    expect(formatRate(0.0033)).toBe("0.33%")
    expect(formatLatency(null)).toBe("No traffic")
    expect(formatLatency(181.6)).toBe("182 ms")
  })

  it("labels UTC days", () => {
    expect(dayLabel("2026-11-01T00:00:00Z")).toBe("Sun 1")
  })

  it("dates by the UTC day, as the server renders it, in any local zone", async () => {
    const zone = process.env.TZ
    process.env.TZ = "America/New_York"
    try {
      vi.resetModules()
      const { shortDate } = await import("./numbers")
      // 20:15 on 10 Nov in New York: a local format would say "10 Nov".
      expect(shortDate("2026-11-11T00:15:00.000Z")).toBe("11 Nov")
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
      vi.resetModules()
    }
  })
})
