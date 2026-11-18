import {
  type BoostTotals,
  boostWad,
  MAX_BOOST_WAD,
  veBtcForBoostWad,
  veMezoForBoostWad,
} from "@matchbox/domain"
import type { Lock } from "../data/view-models"
import { usableLocks, wholeUp } from "./calc-model"

/**
 * What New lock's Boost panel says about the lock being made, from the
 * voting power it will have (amount and duration through `votingPowerAt`)
 * and the system totals. All base units; null when there is no answer
 * (no amount yet, or no totals), never a guess.
 */
export type LockBoostFigures =
  | {
      kind: "vebtc"
      /** veMEZO on its gauge for 5×, rounded up to a whole veMEZO. */
      forMax: bigint
      /** The wallet's veMEZO, if it all voted for this lock's gauge. */
      wallet: {
        veMezo: bigint
        boost: bigint
        /** veMEZO still to find for 5×, rounded up; 0 at 5×. */
        more: bigint
      } | null
    }
  | {
      kind: "vemezo"
      /** The most veBTC this veMEZO brings to 5×, rounded down. */
      carries: bigint
      /** The wallet's veBTC locks, if this veMEZO were spread over them. */
      wallet: {
        veBtc: bigint
        count: number
        /** Spread in proportion over their gauges, each gets this boost. */
        boost: bigint
        covered: boolean
      } | null
    }

/** The wallet's live locks of a kind: their count and voting power. */
export function holdings(
  locks: readonly Lock[],
  kind: Lock["kind"],
): { count: number; total: bigint } {
  const usable = usableLocks(locks, kind)
  return {
    count: usable.length,
    total: usable.reduce((sum, lock) => sum + BigInt(lock.votingPowerWei), 0n),
  }
}

export function lockBoostFigures(input: {
  kind: Lock["kind"]
  votingPower: bigint
  totals: BoostTotals | null
  locks: readonly Lock[]
}): LockBoostFigures | null {
  const { kind, votingPower, totals, locks } = input
  if (votingPower <= 0n || totals === null) return null

  if (kind === "vebtc") {
    const needed = veMezoForBoostWad({
      targetWad: MAX_BOOST_WAD,
      veBtc: votingPower,
      totals,
    })
    if (needed === null) return null
    const forMax = wholeUp(needed)
    const { total } = holdings(locks, "vemezo")
    return {
      kind,
      forMax,
      wallet:
        total === 0n
          ? null
          : {
              veMezo: total,
              boost: boostWad({ veBtc: votingPower, veMezo: total, totals }),
              more: total >= forMax ? 0n : forMax - total,
            },
    }
  }

  const carries = veBtcForBoostWad({
    targetWad: MAX_BOOST_WAD,
    veMezo: votingPower,
    totals,
  })
  if (carries === null) return null
  const { count, total } = holdings(locks, "vebtc")
  return {
    kind,
    carries,
    wallet:
      total === 0n
        ? null
        : {
            veBtc: total,
            count,
            // The boost is linear in veMEZO per veBTC, so veMEZO split in
            // proportion to the locks' veBTC gives each the same boost as
            // all of it on all of their veBTC.
            boost: boostWad({ veBtc: total, veMezo: votingPower, totals }),
            covered: total <= carries,
          },
  }
}
