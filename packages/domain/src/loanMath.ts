// mUSD trove math, identical to LiquityMath: 1e18 fixed point, floor
// division, liquidatable iff ICR < MCR (strict). Ratios are shown as basis
// points rounded half up; liquidation prices round up to the cent.

const BPS = 10_000n

export type LoanBand = "healthy" | "near_liquidation" | "liquidatable"

export function collateralRatio(
  coll: bigint,
  price: bigint,
  debt: bigint,
): bigint | null {
  if (debt <= 0n) return null
  return (coll * price) / debt
}

/** 1e18 ratio (1e18 = 100%) → basis points, rounded half up. */
export function ratioToBps(ratio: bigint): number {
  return Number((ratio + 5n * 10n ** 13n) / 10n ** 14n)
}

/** USD/BTC at which ICR equals MCR, 1e18-scaled, rounded up. */
export function liquidationPrice(
  mcr: bigint,
  debt: bigint,
  coll: bigint,
): bigint | null {
  if (coll <= 0n || debt <= 0n) return null
  return (mcr * debt + coll - 1n) / coll
}

/** 1e18 USD → micro-USD, floored. */
export function wadToMicro(value: bigint): bigint {
  return value / 10n ** 12n
}

/** 1e18 USD → micro-USD rounded up to the cent. */
export function wadToMicroCeilCent(value: bigint): bigint {
  const micro = (value + 10n ** 12n - 1n) / 10n ** 12n
  return ((micro + 9_999n) / 10_000n) * 10_000n
}

/** Percentage BTC can fall before liquidation, in bps (floored, ≥ 0). */
export function dropToLiquidationBps(price: bigint, liqPrice: bigint): number {
  if (price <= 0n || liqPrice >= price) return 0
  return Number(((price - liqPrice) * BPS) / price)
}

export function bandFor(
  ratio: bigint | null,
  mcr: bigint,
  ccr: bigint,
): LoanBand {
  if (ratio === null) return "healthy"
  if (ratio < mcr) return "liquidatable"
  if (ratio < ccr) return "near_liquidation"
  return "healthy"
}

export type ScenarioPoint = {
  shockBps: number
  price: bigint
  ratio: bigint | null
  band: LoanBand
}

export function scenarioPoint(input: {
  coll: bigint
  debt: bigint
  price: bigint
  shockBps: number
  mcr: bigint
  ccr: bigint
}): ScenarioPoint {
  const price = (input.price * (BPS + BigInt(input.shockBps))) / BPS
  const ratio = collateralRatio(input.coll, price, input.debt)
  return {
    shockBps: input.shockBps,
    price,
    ratio,
    band: bandFor(ratio, input.mcr, input.ccr),
  }
}

/** Smallest bps drop (as a negative shock) at which the trove is liquidatable. */
export function liquidationShockBps(input: {
  coll: bigint
  debt: bigint
  price: bigint
  mcr: bigint
}): number | null {
  const liq = liquidationPrice(input.mcr, input.debt, input.coll)
  if (liq === null || liq >= input.price) return null
  let shock = -(dropToLiquidationBps(input.price, liq) + 1)
  for (let attempt = 0; attempt < 3 && shock >= -9_900; attempt += 1) {
    const point = scenarioPoint({ ...input, shockBps: shock, ccr: input.mcr })
    if (point.band === "liquidatable") return shock
    shock -= 1
  }
  return shock >= -9_900 ? shock : null
}

export function maxPartialRepay(
  debt: bigint,
  gasCompensation: bigint,
  minNetDebt: bigint,
): bigint {
  const max = debt - gasCompensation - minNetDebt
  return max > 0n ? max : 0n
}

/** Interest is repaid first, then principal. */
export function repaySplit(
  amount: bigint,
  interest: bigint,
): { interestRepaid: bigint; principalRepaid: bigint } {
  const interestRepaid = amount < interest ? amount : interest
  return { interestRepaid, principalRepaid: amount - interestRepaid }
}

// musd InterestRateMath (simple interest, rate in basis points per year).
// Moved from the indexer's decode/handlers/musd.ts so the indexer and Stuart
// accrue interest the same way.
const SECONDS_IN_A_YEAR = 31_556_952n

/** musd InterestRateMath.calculateInterestOwed, flooring like the contract. */
export function interestOwed(
  principal: bigint,
  interestRate: bigint,
  startTime: bigint,
  endTime: bigint,
): bigint {
  if (endTime <= startTime) return 0n
  return (
    (principal * interestRate * (endTime - startTime)) /
    (BPS * SECONDS_IN_A_YEAR)
  )
}

// -- Morpho Blue market figures -------------------------------------------------

const WAD = 10n ** 18n

/** Morpho's LIQUIDATION_CURSOR (0.3) and MAX_LIQUIDATION_INCENTIVE_FACTOR (1.15). */
const MORPHO_LIQUIDATION_CURSOR = 300_000_000_000_000_000n
const MORPHO_MAX_LIQUIDATION_INCENTIVE_FACTOR = 1_150_000_000_000_000_000n

/**
 * Morpho Blue's liquidation incentive factor for a market's LLTV, as
 * `Morpho.liquidate` computes it (morpho-org/morpho-blue src/Morpho.sol,
 * constants in src/libraries/ConstantsLib.sol; docs.morpho.org,
 * "Liquidation incentive"): LIF = min(1.15, 1 / (0.3 × LLTV + 0.7)), that
 * is `min(MAX_LIQUIDATION_INCENTIVE_FACTOR, WAD.wDivDown(WAD -
 * LIQUIDATION_CURSOR.wMulDown(WAD - lltv)))`. 1e18-scaled, rounded down
 * as the contract rounds. The incentive is LIF − 1 (4.38% at 86% LLTV).
 */
export function morphoLiquidationIncentiveFactor(lltv: bigint): bigint {
  const denominator = WAD - (MORPHO_LIQUIDATION_CURSOR * (WAD - lltv)) / WAD
  const factor = (WAD * WAD) / denominator
  return factor < MORPHO_MAX_LIQUIDATION_INCENTIVE_FACTOR
    ? factor
    : MORPHO_MAX_LIQUIDATION_INCENTIVE_FACTOR
}

/** Seconds in a year as Morpho's interfaces annualize (365 days). */
const MORPHO_SECONDS_PER_YEAR = 31_536_000n

/**
 * A per-second borrow rate compounded over a year with Morpho Blue's own
 * approximation (src/libraries/MathLib.sol `wTaylorCompounded`: x + x²/2 +
 * x³/6 with x = rate × seconds, each term rounded down): the borrow APY,
 * 1e18-scaled.
 */
export function morphoBorrowApy(ratePerSecond: bigint): bigint {
  const first = ratePerSecond * MORPHO_SECONDS_PER_YEAR
  const second = (first * first) / (2n * WAD)
  const third = (second * first) / (3n * WAD)
  return first + second + third
}

/**
 * What suppliers earn: borrow APY × utilization × (1 − fee), all
 * 1e18-scaled (docs.morpho.org, "Supply APY": borrowers' interest is
 * shared by suppliers in proportion to what is lent out, less the
 * protocol fee). Rounded down.
 */
export function morphoSupplyApy(input: {
  ratePerSecond: bigint
  utilization: bigint
  fee: bigint
}): bigint {
  const earned =
    (morphoBorrowApy(input.ratePerSecond) * input.utilization) / WAD
  return (earned * (WAD - input.fee)) / WAD
}
