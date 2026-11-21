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

/**
 * The Borrow page's open positions by venue: "1 Enclave, 8 Morpho (1
 * MUSD), 4 troves", the Morpho positions in markets that lend MUSD named
 * when they are not all of them, so the count ties to the homepage's,
 * which counts those markets only ("1 Enclave, 1 MUSD Morpho").
 */
export function openPositionWords(counts: {
  enclaves: number | null
  morpho: number
  morphoMusd: number
  troves: number
}): string {
  const morpho =
    counts.morphoMusd === counts.morpho
      ? `${counts.morpho} Morpho`
      : `${counts.morpho} Morpho (${counts.morphoMusd} MUSD)`
  return [
    counts.enclaves === null
      ? null
      : `${counts.enclaves} Enclave${counts.enclaves === 1 ? "" : "s"}`,
    morpho,
    `${counts.troves} trove${counts.troves === 1 ? "" : "s"}`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ")
}
