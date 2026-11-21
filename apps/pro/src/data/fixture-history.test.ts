import {
  walletActivitySchema,
  walletRewardsSchema,
} from "@matchbox/contracts/read-models"
import { EPOCH_ZERO_START, epochIndexFor, epochStartOf } from "@matchbox/domain"
import { describe, expect, it } from "vitest"
import {
  historyActivity,
  historyRewards,
  longHistoryWallet,
  pendingHistoryWallet,
} from "./fixture-history"

// Thursday 19 Nov 2026, 12:00 UTC: Epoch 49.
const nowMs = Date.UTC(2026, 10, 19, 12)

function allPages(wallet: string, category: "claims" | null = null) {
  const pages = []
  let cursor: string | null = null
  for (let guard = 0; guard < 50; guard += 1) {
    const page = walletActivitySchema.parse(
      historyActivity(wallet, category, cursor, 25, nowMs),
    )
    pages.push(page)
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }
  return pages
}

function epochOf(timestamp: number): number {
  return timestamp < EPOCH_ZERO_START
    ? -1
    : epochIndexFor(epochStartOf(timestamp))
}

describe("long history fixture", () => {
  it("pages from the latest epoch to before Epoch 0, each row once", () => {
    const pages = allPages(longHistoryWallet)
    const rows = pages.flatMap((page) => page.rows)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    const epochs = new Set(rows.map((row) => epochOf(row.timestamp)))
    // Epoch 0 to 49, and the lock made the week before Epoch 0.
    expect(epochs.size).toBeGreaterThanOrEqual(51)
    expect(Math.max(...epochs)).toBe(49)
    expect(rows.at(-1)?.type).toBe("lock-create")
    expect(rows.at(-1)?.timestamp).toBeLessThan(EPOCH_ZERO_START)
    // Newest first throughout.
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index - 1]?.timestamp).toBeGreaterThanOrEqual(
        rows[index]?.timestamp ?? 0,
      )
    }
    expect(pages.at(-1)?.pending).toBe(false)
  })

  it("ends history pages where an epoch ends, at 100 rows at most", () => {
    const pages = allPages(longHistoryWallet)
    const stored = pages.filter((_, index) => index > 1)
    expect(stored.length).toBeGreaterThan(1)
    for (const page of stored.slice(0, -1)) {
      expect(page.rows.length).toBeLessThanOrEqual(100)
      const last = page.rows.at(-1)
      const next = pages[pages.indexOf(page) + 1]?.rows[0]
      if (last === undefined || next === undefined) continue
      expect(epochOf(next.timestamp)).toBeLessThan(epochOf(last.timestamp))
    }
  })

  it("filters stored pages too", () => {
    const rows = allPages(longHistoryWallet, "claims").flatMap(
      (page) => page.rows,
    )
    expect(rows.every((row) => row.type === "claim")).toBe(true)
    // A claim every epoch from Epoch 1 on, each paying the epoch before.
    expect(rows).toHaveLength(49)
    const oldest = rows.at(-1)
    expect(oldest?.type === "claim" ? oldest.epoch?.number : null).toBe(0)
  })

  it("says older epochs are pending where the stored history stops", () => {
    const pages = allPages(pendingHistoryWallet)
    const last = pages.at(-1)
    expect(last?.nextCursor).toBeNull()
    expect(last?.pending).toBe(true)
    const oldest = pages.flatMap((page) => page.rows).at(-1)
    expect(epochOf(oldest?.timestamp ?? 0)).toBe(20)
  })

  it("counts Earned over every claim, exactly", () => {
    const rewards = walletRewardsSchema.parse(
      historyRewards(longHistoryWallet, nowMs),
    )
    expect(rewards.history).toHaveLength(12)
    // 49 claims: the first two had no price, and claims under 3 days old
    // wait for their day's price.
    const pending = rewards.earned.whenClaimed?.pending ?? -1
    expect(pending).toBeGreaterThanOrEqual(0)
    expect(pending).toBeLessThanOrEqual(1)
    const priced = 49 - 2 - pending
    expect(rewards.earned).toEqual({
      usd: `${Math.floor(priced / 2)}.${priced % 2 === 0 ? "00" : "50"}`,
      fromEpoch: 0,
      toEpoch: 48,
      whenClaimed: { unpriced: 2, pending, settling: pending },
    })
  })
})
