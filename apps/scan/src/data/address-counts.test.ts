import { describe, expect, it } from "vitest"
import { transactionCount, transactionWord } from "./address-counts"

describe("an address's transaction count", () => {
  const creation = `0x${"dc".repeat(32)}`

  it("adds back the creation Blockscout's counter leaves out", () => {
    // The Enclave at 0x1473…D786 (14 Nov 2026): counters 0, a list of one
    // (its creation), 158 transfers.
    expect(transactionCount("0", creation)).toBe("1")
    expect(transactionCount("4169", null)).toBe("4169")
    expect(transactionCount("12", creation)).toBe("13")
  })

  it("knows no count without a counter", () => {
    expect(transactionCount(null, creation)).toBeNull()
    expect(transactionCount("lots", null)).toBeNull()
  })

  it("says one transaction, never one transactions", () => {
    expect(transactionWord("1")).toBe("transaction")
    expect(transactionWord("0")).toBe("transactions")
    expect(transactionWord("4,169")).toBe("transactions")
  })
})
