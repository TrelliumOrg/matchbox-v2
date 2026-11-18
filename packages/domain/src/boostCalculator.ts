// The boost calculator's maths, in base units (18 decimals) and bigint all
// the way, so Pro, Stuart and Matchscan agree to the last digit.
//
// The formula is the whitepaper's (section 3.6) and Classic's
// (apps/webapp/src/utils/boostMultiplierFromCalculatorInputs.ts):
//
//   boost = min(5, 1 + 4 * (V / v) * (w / W))
//
//   v  the veBTC lock's unboosted voting power
//   w  the veMEZO votes on that lock's gauge
//   V  veBTC escrow unboostedTotalVotingPower()
//   W  veMEZO escrow totalVotingPower()
//
// Classic's page worked in floating point and showed two decimals rounded
// to nearest, so 4.996 read "5.00×" before 5× was reached. Here a boost is
// rounded down: the figure shown is one the lock has.

export const BOOST_WAD = 10n ** 18n
export const MAX_BOOST = 5n
export const MAX_BOOST_WAD = MAX_BOOST * BOOST_WAD

/** The escrows' totals the formula needs, in base units. */
export type BoostTotals = {
  /** veBTC `unboostedTotalVotingPower()`. */
  veBtc: bigint
  /** veMEZO `totalVotingPower()`. */
  veMezo: bigint
}

/** A whole boost to aim for: 2, 3, 4 or 5. */
export type BoostTarget = 2 | 3 | 4 | 5

export const boostTargets: readonly BoostTarget[] = [2, 3, 4, 5]

function usable(totals: BoostTotals): boolean {
  return totals.veBtc > 0n && totals.veMezo > 0n
}

/**
 * The boost of a veBTC lock with `veBtc` voting power whose gauge holds
 * `veMezo` votes, 1e18 = 1×, rounded down, capped at 5×. 1× when either
 * figure or a total is zero.
 */
export function boostWad(input: {
  veBtc: bigint
  veMezo: bigint
  totals: BoostTotals
}): bigint {
  const { veBtc, veMezo, totals } = input
  if (veBtc <= 0n || veMezo <= 0n || !usable(totals)) return BOOST_WAD
  const above =
    (4n * totals.veBtc * veMezo * BOOST_WAD) / (veBtc * totals.veMezo)
  const raw = BOOST_WAD + above
  return raw > MAX_BOOST_WAD ? MAX_BOOST_WAD : raw
}

/** 1e16: one hundredth of a boost, the slider's step. */
export const BOOST_STEP_WAD = 10n ** 16n

/** A boost in hundredths (100 to 500), as a wad: 325 is 3.25×. */
export function boostWadFromHundredths(hundredths: number): bigint {
  const whole = Math.round(hundredths)
  const clamped = Math.min(Math.max(whole, 100), 500)
  return BigInt(clamped) * BOOST_STEP_WAD
}

/** A boost in wad as hundredths, rounded down, 100 to 500. */
export function hundredthsFromBoostWad(wad: bigint): number {
  const hundredths = Number(wad / BOOST_STEP_WAD)
  return Math.min(Math.max(hundredths, 100), 500)
}

function clampTarget(targetWad: bigint): bigint {
  if (targetWad < BOOST_WAD) return BOOST_WAD
  return targetWad > MAX_BOOST_WAD ? MAX_BOOST_WAD : targetWad
}

/**
 * The veMEZO votes a gauge needs for its veBTC lock to reach `targetWad`
 * (1e18 = 1×, held to 1× to 5×), rounded up so that the amount shown is
 * enough: `boostWad` of the answer is at least the target. 0 at 1×. Null
 * without totals.
 *
 *   w = v * W * (target - 1) / (4 * V)
 */
export function veMezoForBoostWad(input: {
  targetWad: bigint
  veBtc: bigint
  totals: BoostTotals
}): bigint | null {
  const { veBtc, totals } = input
  if (!usable(totals) || veBtc < 0n) return null
  const above = clampTarget(input.targetWad) - BOOST_WAD
  const numerator = veBtc * totals.veMezo * above
  const denominator = 4n * totals.veBtc * BOOST_WAD
  return (numerator + denominator - 1n) / denominator
}

/**
 * The most veBTC voting power that `veMezo` votes still take to
 * `targetWad`, rounded down so that the amount shown does reach it:
 * `boostWad` of the answer is at least the target.
 *
 * Null without totals, and null at 1× or with no veMEZO: then no finite
 * amount of veBTC is the answer (any veMEZO lifts every lock above 1×,
 * and without veMEZO no lock gets above it).
 *
 *   v = 4 * V * w / (W * (target - 1))
 */
export function veBtcForBoostWad(input: {
  targetWad: bigint
  veMezo: bigint
  totals: BoostTotals
}): bigint | null {
  const { veMezo, totals } = input
  if (!usable(totals) || veMezo <= 0n) return null
  const above = clampTarget(input.targetWad) - BOOST_WAD
  if (above === 0n) return null
  return (4n * totals.veBtc * veMezo * BOOST_WAD) / (totals.veMezo * above)
}

/**
 * The veMEZO votes a gauge needs for its veBTC lock to reach `target`,
 * rounded up so that the amount shown is enough. Null without totals.
 */
export function veMezoForBoost(input: {
  target: BoostTarget
  veBtc: bigint
  totals: BoostTotals
}): bigint | null {
  return veMezoForBoostWad({
    targetWad: BigInt(input.target) * BOOST_WAD,
    veBtc: input.veBtc,
    totals: input.totals,
  })
}

/**
 * The veBTC voting power that `veMezo` votes take to `target`, rounded
 * down so that the amount shown does reach it. Null without totals; 0
 * without veMEZO.
 */
export function veBtcForBoost(input: {
  target: BoostTarget
  veMezo: bigint
  totals: BoostTotals
}): bigint | null {
  if (!usable(input.totals) || input.veMezo < 0n) return null
  if (input.veMezo === 0n) return 0n
  return veBtcForBoostWad({
    targetWad: BigInt(input.target) * BOOST_WAD,
    veMezo: input.veMezo,
    totals: input.totals,
  })
}

/** veMEZO votes per one veBTC of voting power for `target`. */
export function veMezoPerVeBtc(
  target: BoostTarget,
  totals: BoostTotals,
): bigint | null {
  return veMezoForBoost({ target, veBtc: BOOST_WAD, totals })
}

/**
 * What `target` still needs: `toGo` more veMEZO votes, or `over` past it
 * (one of the two is zero). Null without totals.
 */
export function boostGap(input: {
  target: BoostTarget
  veBtc: bigint
  veMezo: bigint
  totals: BoostTotals
}): { needed: bigint; toGo: bigint; over: bigint } | null {
  const needed = veMezoForBoost(input)
  if (needed === null) return null
  return input.veMezo >= needed
    ? { needed, toGo: 0n, over: input.veMezo - needed }
    : { needed, toGo: needed - input.veMezo, over: 0n }
}

/** "3.63" from a boost in wad: `decimals` places, rounded down. */
export function formatBoostWad(wad: bigint, decimals = 2): string {
  const scale = 10n ** BigInt(decimals)
  const scaled = (wad * scale) / BOOST_WAD
  const whole = scaled / scale
  if (decimals === 0) return `${whole}`
  return `${whole}.${(scaled % scale).toString().padStart(decimals, "0")}`
}
