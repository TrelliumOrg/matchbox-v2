import { describe, expect, it, vi } from "vitest"

vi.mock("cloudflare:workers", () => ({ env: { SCAN_DATA: "fixtures" } }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))

const { loanHistory, mergeLoanSources } = await import("./address.server")
const { wallet } = await import("./scan/fixtures/world")

/**
 * An address's loan history merges troves, Enclaves and each Morpho
 * market, each a newest-first page: when a source has more, the merge
 * stops at that source's oldest event and says it is not whole.
 */

function event(source: string, block: number) {
  return {
    key: `${source}:${block}`,
    kind: "trove" as const,
    loan: "MUSD loan",
    action: "Borrowed",
    detail: null,
    timestamp: block,
    block,
    txHash: `0x${String(block).padStart(64, "0")}`,
  }
}

describe("loan history", () => {
  it("cuts the merge where a source with more stops", () => {
    const merged = mergeLoanSources([
      // A full page: older trove events exist past block 500.
      { events: [event("trove", 900), event("trove", 500)], more: true },
      // Whole: its event at 300 is older than the trove gap begins.
      { events: [event("morpho", 700), event("morpho", 300)], more: false },
    ])
    expect(merged.items.map((each) => each.block)).toEqual([900, 700, 500])
    expect(merged.more).toBe(true)
  })

  it("keeps every event when every source is whole", () => {
    const merged = mergeLoanSources([
      { events: [event("trove", 500)], more: false },
      { events: [event("morpho", 300)], more: false },
    ])
    expect(merged.items.map((each) => each.block)).toEqual([500, 300])
    expect(merged.more).toBe(false)
  })

  it("reads the fixture wallet's loans whole", async () => {
    const read = await loanHistory({ address: wallet })
    if (read.status !== "ok") throw new Error("loans")
    expect(read.data.more).toBe(false)
    expect(read.data.items.length).toBeGreaterThan(3)
    expect(read.skipped).toBeUndefined()
  })
})
