import {
  BOOST_WAD,
  type BoostTotals,
  boostWad,
  MAX_BOOST_WAD,
  veBtcForBoostWad,
  veMezoForBoostWad,
} from "@matchbox/domain"
import type { Lock, LockKind } from "../data/view-models"
import { parseAmount } from "../tx/amounts"
import type { CalcSolve } from "./calc-link"

/**
 * What the boost calculator shows for what is typed. Everything is base
 * units (18 decimals) through `@matchbox/domain`; null means "no answer
 * yet", never a guess.
 *
 * It works out one of three figures, as Matchbox Classic's calculator
 * does: the veMEZO a veBTC lock needs for a boost, the veBTC that veMEZO
 * takes to a boost, or the boost from both.
 */

/** Why a figure has no answer. */
export type CalcMissing =
  /** No system totals: never read, or typed over and incomplete. */
  | "totals"
  /** The veBTC figure is empty or zero. */
  | "vebtc"
  /** The veMEZO figure is empty (solving for veBTC). */
  | "vemezo"
  /** Solving for veBTC with no veMEZO: no lock gets above 1×. */
  | "no-vemezo"
  /** Solving for veBTC at 1×: no finite amount is the answer. */
  | "at-one"

export type CalcModel = {
  solve: CalcSolve
  /** The veBTC field's figure, typed or worked out. */
  veBtc: bigint | null
  /** The veMEZO field's figure, typed or worked out. */
  veMezo: bigint | null
  /**
   * The boost, 1e18 = 1×: the target when solving for a figure, worked
   * out from both when solving for the boost.
   */
  boost: bigint | null
  /** Why the worked-out figure is missing; null when it is there. */
  missing: CalcMissing | null
  /** veMEZO votes for 5× at this veBTC, the band's full width. */
  forMax: bigint | null
  /** Solving for the boost past 5×: the veMEZO that adds nothing. */
  over: bigint | null
  /** veMEZO votes per one veBTC at this boost. */
  ratio: bigint | null
}

function typed(input: string): bigint | null {
  const amount = parseAmount(input, 18)
  return amount === null || amount <= 0n ? null : amount
}

/** Like `typed`, but "0" (or "0.0") is zero rather than nothing. */
function typedOrZero(input: string): bigint | null {
  if (/^0*\.?0*$/.test(input) && /0/.test(input)) return 0n
  return typed(input)
}

export function calcModel(input: {
  solve: CalcSolve
  veBtc: string
  veMezo: string
  /** The boost to solve for, 1e18 = 1×; 5× when left out. */
  target?: bigint
  totals: BoostTotals | null
}): CalcModel {
  const { solve, totals } = input
  const target = input.target ?? MAX_BOOST_WAD
  const typedBtc = typed(input.veBtc)
  const typedMezo = typedOrZero(input.veMezo)
  const base = {
    solve,
    veBtc: solve === "vebtc" ? null : typedBtc,
    veMezo: solve === "vemezo" ? null : typedMezo,
    boost: solve === "boost" ? null : target,
    forMax: null,
    over: null,
    ratio: null,
  }
  const ratio = (boost: bigint): bigint | null =>
    totals === null
      ? null
      : veMezoForBoostWad({ targetWad: boost, veBtc: BOOST_WAD, totals })
  const forMax = (veBtc: bigint | null): bigint | null =>
    totals === null || veBtc === null
      ? null
      : veMezoForBoostWad({ targetWad: MAX_BOOST_WAD, veBtc, totals })

  if (solve === "vemezo") {
    if (typedBtc === null) return { ...base, missing: "vebtc" }
    if (totals === null) return { ...base, missing: "totals" }
    return {
      ...base,
      veMezo: veMezoForBoostWad({ targetWad: target, veBtc: typedBtc, totals }),
      missing: null,
      forMax: forMax(typedBtc),
      ratio: ratio(target),
    }
  }

  if (solve === "vebtc") {
    if (typedMezo === null) return { ...base, missing: "vemezo" }
    if (typedMezo === 0n) return { ...base, missing: "no-vemezo" }
    if (target <= BOOST_WAD) return { ...base, missing: "at-one" }
    if (totals === null) return { ...base, missing: "totals" }
    const veBtc = veBtcForBoostWad({
      targetWad: target,
      veMezo: typedMezo,
      totals,
    })
    return {
      ...base,
      veBtc,
      missing: veBtc === null ? "totals" : null,
      forMax: forMax(veBtc),
      ratio: ratio(target),
    }
  }

  if (typedBtc === null) return { ...base, missing: "vebtc" }
  if (totals === null) return { ...base, missing: "totals" }
  const veMezo = typedMezo ?? 0n
  const boost = boostWad({ veBtc: typedBtc, veMezo, totals })
  const max = forMax(typedBtc)
  return {
    ...base,
    boost,
    missing: null,
    forMax: max,
    over:
      boost >= MAX_BOOST_WAD && max !== null && veMezo > max
        ? veMezo - max
        : null,
    ratio: ratio(boost),
  }
}

/**
 * A veMEZO figure that is needed, rounded up to a whole veMEZO: 151,851.4
 * is shown as 151,852, since 151,851 falls short. Base units.
 */
export function wholeUp(wei: bigint): bigint {
  return ((wei + BOOST_WAD - 1n) / BOOST_WAD) * BOOST_WAD
}

/**
 * The text a worked-out figure shows in its field. veMEZO is rounded up to
 * a whole veMEZO and veBTC down to six places, so either figure as shown
 * still reaches the boost.
 */
export function solvedText(model: CalcModel): string {
  if (model.solve === "vemezo" && model.veMezo !== null) {
    return `${wholeUp(model.veMezo) / BOOST_WAD}`
  }
  if (model.solve === "vebtc" && model.veBtc !== null) {
    return fieldValue(model.veBtc, 6)
  }
  return ""
}

/** Totals someone typed in "Try other totals"; null until both are there. */
export function typedTotals(veBtc: string, veMezo: string): BoostTotals | null {
  const btc = typed(veBtc)
  const mezo = typed(veMezo)
  return btc === null || mezo === null ? null : { veBtc: btc, veMezo: mezo }
}

/** The wallet's locks the fields can be filled from, largest first. */
export function usableLocks(locks: readonly Lock[], kind: LockKind): Lock[] {
  return locks
    .filter(
      (lock) =>
        lock.kind === kind && !lock.expired && BigInt(lock.votingPowerWei) > 0n,
    )
    .sort((left, right) =>
      BigInt(left.votingPowerWei) === BigInt(right.votingPowerWei)
        ? 0
        : BigInt(left.votingPowerWei) > BigInt(right.votingPowerWei)
          ? -1
          : 1,
    )
}

/** "0.611" from base units: a plain decimal for a field, at most `places`. */
export function fieldValue(wei: bigint, places: number): string {
  const scale = 10n ** 18n
  const whole = wei / scale
  const fraction = (wei % scale)
    .toString()
    .padStart(18, "0")
    .slice(0, places)
    .replace(/0+$/, "")
  return fraction === "" ? `${whole}` : `${whole}.${fraction}`
}
