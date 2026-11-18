import type { ScanLockItem } from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import { lockSubline } from "../../explorer/address/shared"
import { lockView } from "./lock-views"

const now = 1_794_463_200

function lock(overrides: Partial<ScanLockItem> = {}): ScanLockItem {
  return {
    escrow: "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279",
    token_id: "1226",
    owner: "0x920b1c573f503554e113e4c47a92cd289a3d1625",
    amount: "1103784362956406180",
    unlock_at: 0,
    created_at: null,
    last_extended_at: null,
    withdrawn_at: null,
    is_permanent: false,
    is_withdrawn: false,
    is_merged: false,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: 66,
    updated_at: now,
    ...overrides,
  }
}

describe("lockView unlock times", () => {
  it("shows a live lock whose end is 0 as auto max, never 1 Jan 1970", () => {
    const view = lockView(lock(), now)
    expect(view.state).toBe("auto-max")
    expect(view.unlockAt).toBeNull()
    expect(view.unlockText).toBeNull()
    expect(lockSubline(view)).toBe("Auto max")
  })

  it("shows a permanent lock as auto max", () => {
    const view = lockView(lock({ is_permanent: true }), now)
    expect(view.state).toBe("auto-max")
    expect(view.unlockText).toBeNull()
  })

  it("dates a timed lock and expires it once the date passes", () => {
    const active = lockView(lock({ unlock_at: now + 86_400 }), now)
    expect(active.state).toBe("active")
    expect(active.unlockText).toBe("13 Nov 2026")
    const expired = lockView(lock({ unlock_at: now - 86_400 }), now)
    expect(expired.state).toBe("expired")
  })

  it("keeps a lock with no end recorded undated, not expired", () => {
    const view = lockView(lock({ unlock_at: null }), now)
    expect(view.state).toBe("active")
    expect(view.unlockText).toBeNull()
  })

  it("keeps withdrawn and merged locks so, with no date", () => {
    expect(lockView(lock({ is_withdrawn: true }), now).state).toBe("withdrawn")
    const merged = lockView(lock({ is_merged: true }), now)
    expect(merged.state).toBe("merged")
    expect(merged.unlockText).toBeNull()
  })
})
