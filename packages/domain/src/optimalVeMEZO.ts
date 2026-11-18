// veMEZO weight that takes a veBTC gauge to the full boost. Pro's
// lib/optimalVeMEZO.ts (bigint) with Classic's ratio helpers from
// apps/webapp/src/utils/optimalVeMEZO.ts. Classic computed the same floor
// through cent Rationals; its colour helper stays with the UI.

export type OptimalVeMEZO = {
  optimalVeMEZO: bigint
  optimalAdditionalVeMEZO: bigint
}

/**
 * veMEZO voting weight on a gauge that reaches maximum (5x) boost.
 *   targetVeMEZO = (unboosted NFT veBTC * veMEZO totalVotingPower) / veBTC unboostedTotalVotingPower
 *   additionalVeMEZO = max(targetVeMEZO - currentGaugeVeMEZOWeight, 0)
 */
export function calculateOptimalVeMEZO(
  gaugeVeBTCWeight: bigint | undefined,
  currentGaugeVeMEZOWeight: bigint,
  veBTCTokenSupply: bigint | undefined,
  veMEZOTokenSupply: bigint | undefined,
): OptimalVeMEZO | undefined {
  if (!veMEZOTokenSupply || !veBTCTokenSupply || !gaugeVeBTCWeight) {
    return undefined
  }
  const optimalVeMEZO =
    (gaugeVeBTCWeight * veMEZOTokenSupply) / veBTCTokenSupply
  return {
    optimalVeMEZO,
    optimalAdditionalVeMEZO:
      optimalVeMEZO > currentGaugeVeMEZOWeight
        ? optimalVeMEZO - currentGaugeVeMEZOWeight
        : 0n,
  }
}

export default calculateOptimalVeMEZO

/** `totalWeight / optimal` — only meaningful when weight is at or above optimal. */
export function weightToOptimalRatio(weight: bigint, optimal: bigint): number {
  if (optimal <= 0n) return 1
  return Number((weight * 10000n) / optimal) / 10000
}

/** Oversubscription 0% at 1× optimal → 100% at 2×; stays full past 2×. */
export function oversubscribedRedWidthPercent(ratio: number): number {
  if (ratio <= 1) return 0
  return Math.min(100, (ratio - 1) * 100)
}
