import { EPOCH_SECONDS, EPOCH_ZERO_START } from "@matchbox/domain"
import { describe, expect, it } from "vitest"
import { governanceEpochs, governanceSweepPerRun } from "./governance"
import {
  type ChainLock,
  lockDistribution,
  SupplyMismatch,
} from "./lock-distribution"

const unit = 10n ** 18n
const time = 1_795_000_000
const week = 7 * 86_400

function lock(
  id: number,
  amount: bigint,
  end: number,
  permanent = false,
): ChainLock {
  return { id, amount, end, permanent, votingPower: permanent ? amount : 0n }
}

function read(locks: ChainLock[], supply?: bigint) {
  return {
    block: 1,
    time,
    ids: locks.length,
    supply: supply ?? locks.reduce((sum, each) => sum + each.amount, 0n),
    locks,
  }
}

describe("lockDistribution", () => {
  it("buckets veBTC locks by size and by weeks left", () => {
    const doc = lockDistribution(
      "vebtc",
      read([
        lock(1, unit / 1_000n, time + 2 * 86_400),
        lock(2, unit / 20n, time + 9 * 86_400),
        lock(3, 3n * unit, time + 9 * 86_400),
        lock(4, 50n * unit, 0, true),
        lock(5, unit / 2n, time - 1),
      ]),
      "2026-11-15",
    )
    expect(doc.by_size.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1])
    expect(doc.by_size[0]).toMatchObject({
      min: "0",
      max: (unit / 100n).toString(),
    })
    expect(doc.by_size.at(-1)?.max).toBeNull()
    expect(doc.by_remaining.map((bucket) => bucket.count)).toEqual([1, 2, 0, 0])
    expect(doc.by_remaining.map((bucket) => bucket.max_seconds)).toEqual([
      week,
      2 * week,
      3 * week,
      4 * week,
    ])
    expect(doc.permanent).toMatchObject({
      count: 1,
      amount: (50n * unit).toString(),
    })
    expect(doc.expired.count).toBe(1)
    expect(doc.timed.count).toBe(3)
    expect(doc.unlocks).toEqual([
      { at: time + 2 * 86_400, count: 1, amount: (unit / 1_000n).toString() },
      {
        at: time + 9 * 86_400,
        count: 2,
        amount: (unit / 20n + 3n * unit).toString(),
      },
    ])
    // Odd count: the middle amount.
    expect(doc.median).toBe((unit / 2n).toString())
    expect(doc.largest).toBe((50n * unit).toString())
  })

  it("weights time left by amount", () => {
    const doc = lockDistribution(
      "vemezo",
      read([lock(1, 3n * unit, time + 100), lock(2, unit, time + 500)]),
      "2026-11-15",
    )
    expect(doc.mean_remaining_seconds).toBe(200)
    expect(doc.median).toBe(((3n * unit + unit) / 2n).toString())
    expect(doc.by_remaining[0]?.count).toBe(2)
  })

  it("refuses a read that does not add up to supply()", () => {
    expect(() =>
      lockDistribution("vebtc", read([lock(1, unit, 0, true)], 2n * unit), "x"),
    ).toThrow(SupplyMismatch)
  })

  it("reads an escrow with no locks", () => {
    const doc = lockDistribution("vebtc", read([]), "2026-11-15")
    expect(doc.live.count).toBe(0)
    expect(doc.median).toBeNull()
    expect(doc.mean_remaining_seconds).toBeNull()
  })
})

describe("governanceEpochs", () => {
  const current = EPOCH_ZERO_START + 48 * EPOCH_SECONDS
  const now = current + 3_600

  it("starts with the current and previous epoch, then sweeps back", () => {
    const plan = governanceEpochs(now, null)
    expect(plan.epochs).toEqual([
      current,
      current - EPOCH_SECONDS,
      ...Array.from(
        { length: governanceSweepPerRun },
        (_, index) => current - (index + 2) * EPOCH_SECONDS,
      ),
    ])
    expect(plan.next).toBe(
      current - (governanceSweepPerRun + 2) * EPOCH_SECONDS,
    )
  })

  it("wraps to the newest older epoch after Epoch 0", () => {
    const plan = governanceEpochs(now, EPOCH_ZERO_START)
    expect(plan.epochs).toContain(EPOCH_ZERO_START)
    expect(plan.epochs).toContain(current - 2 * EPOCH_SECONDS)
  })

  it("has nothing to sweep in Epoch 0 and 1", () => {
    const plan = governanceEpochs(EPOCH_ZERO_START + EPOCH_SECONDS + 10, null)
    expect(plan.epochs).toEqual([
      EPOCH_ZERO_START + EPOCH_SECONDS,
      EPOCH_ZERO_START,
    ])
  })
})
