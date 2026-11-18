/**
 * Words the pages show for borrow states (copy rules: labels). No imports:
 * safe for the browser bundle.
 */

export type HealthBand =
  | "healthy"
  | "near_liquidation"
  | "liquidatable"
  | "no_debt"
  /**
   * Debt without a price to value the collateral (a Morpho position whose
   * oracle has no price): no health claim either way.
   */
  | "unknown"

export const bandWords: Record<HealthBand, string> = {
  healthy: "Healthy",
  near_liquidation: "At risk",
  liquidatable: "Liquidatable",
  no_debt: "No debt",
  unknown: "No price",
}
