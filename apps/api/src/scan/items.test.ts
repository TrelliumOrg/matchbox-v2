import { describe, expect, it } from "vitest"
import { lockItem } from "./items"

// A lock row as D1 holds it (scanLockRowSchema).
function row(overrides: Record<string, unknown> = {}) {
  return {
    escrow: "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279",
    token_id: "1226",
    owner: "0x920b1c573f503554e113e4c47a92cd289a3d1625",
    amount: "1103784362956406180",
    amount_key: `${"0".repeat(39)}1`,
    unlock_at: 0,
    created_at: null,
    last_extended_at: null,
    withdrawn_at: null,
    is_permanent: 0,
    is_withdrawn: 0,
    is_merged: 0,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: 66,
    updated_at: 1_794_000_000,
    ...overrides,
  }
}

describe("lockItem", () => {
  it("serves a live lock whose end is 0 as permanent", () => {
    // veBTC #1226: made permanent before the v2 warehouse's start, so its
    // flag is 0, while every later Deposit carried the permanent end, 0.
    expect(lockItem(row()).is_permanent).toBe(true)
  })

  it("keeps a timed lock timed", () => {
    expect(lockItem(row({ unlock_at: 1_790_812_800 })).is_permanent).toBe(false)
  })

  it("keeps a lock with no end recorded unknown, not permanent", () => {
    expect(lockItem(row({ unlock_at: null })).is_permanent).toBe(false)
  })

  it("never makes a withdrawn or merged lock permanent", () => {
    expect(lockItem(row({ is_withdrawn: 1 })).is_permanent).toBe(false)
    expect(lockItem(row({ is_merged: 1 })).is_permanent).toBe(false)
  })

  it("keeps the flag when it is set", () => {
    expect(lockItem(row({ is_permanent: 1 })).is_permanent).toBe(true)
  })
})
