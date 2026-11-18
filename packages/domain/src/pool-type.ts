/**
 * Which pool a pool gauge is. Several gauges share a pair (BTC/MUSD has a
 * basic volatile pool and two concentrated pools), so the pair alone does
 * not tell them apart. Mezo's DEX (a Velodrome and Aerodrome fork) has
 * basic pools, `vAMM` volatile or `sAMM` stable, and concentrated
 * liquidity pools told apart by tick spacing. The short label follows the
 * DEX's own names and the one Matchbox already gives cross-chain gauges
 * ("Aerodrome MEZO/MUSD CL200"):
 *
 * - basic volatile pool: "Volatile"
 * - basic stable pool: "Stable"
 * - concentrated pool with tick spacing 200: "CL200"
 * - concentrated pool whose tick spacing is not known: "CL"
 *
 * Vaults (sMUSD) and gauges that are not pools have no label. Pro and
 * Matchscan both draw the label from here, so they cannot drift.
 */

export type PoolType = "volatile" | "stable" | "cl"

export type PoolTypeSource = {
  poolType: PoolType | null
  /** Concentrated pools only; null when unknown. */
  tickSpacing?: number | null | undefined
}

/** "Volatile", "Stable", "CL200"; null when the gauge is not a pair pool. */
export function poolTypeLabel(source: PoolTypeSource): string | null {
  switch (source.poolType) {
    case "volatile":
      return "Volatile"
    case "stable":
      return "Stable"
    case "cl": {
      const spacing = source.tickSpacing
      return typeof spacing === "number" &&
        Number.isInteger(spacing) &&
        spacing > 0
        ? `CL${spacing}`
        : "CL"
    }
    case null:
      return null
  }
}

/** The label spelled out, for tooltips and screen readers. */
export function poolTypeDescription(source: PoolTypeSource): string | null {
  switch (source.poolType) {
    case "volatile":
      return "Basic volatile pool"
    case "stable":
      return "Basic stable pool"
    case "cl": {
      const label = poolTypeLabel(source)
      return label === "CL"
        ? "Concentrated pool"
        : `Concentrated pool, tick spacing ${source.tickSpacing}`
    }
    case null:
      return null
  }
}

/**
 * A gauge's name with its pool type, where text has one line for both:
 * "BTC/MUSD CL200". A name that already ends with the label is kept.
 */
export function nameWithPoolType(name: string, label: string | null): string {
  if (label === null) return name
  return name.endsWith(` ${label}`) ? name : `${name} ${label}`
}
