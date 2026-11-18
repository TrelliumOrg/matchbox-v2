import type { GaugeSummary } from "../../data/view-models"
import { formatCompact, weiToWhole } from "../../lib/format"

type Counted = Pick<GaugeSummary, "optimalVotes" | "votesUnit">

/**
 * The votes at which a gauge reaches 5x, whole units. Only boost gauges
 * have such a point: for a pool, validator or MEZO gauge this is null, and
 * the profile shows neither an optimal count nor a boost. Falling back to
 * the gauge's own votes here once made every such gauge read "Boost 5.0×,
 * At 5×" and "N of N optimal".
 */
export function optimalVotes(gauge: Counted): bigint | null {
  return gauge.optimalVotes === null ? null : weiToWhole(gauge.optimalVotes)
}

/** Beside the vote count: "of 6.97M optimal", or the unit without one. */
export function votesContext(gauge: Counted): string {
  const optimal = optimalVotes(gauge)
  return optimal === null
    ? gauge.votesUnit
    : `of ${formatCompact(optimal)} optimal`
}
