/**
 * The rewards chart's period (`eSwId--0MF`: All, 90d, 30d, All by
 * default) as a search param, or a custom span's `from` and `to`. Only
 * the tiny range module: route search validation loads with the router,
 * so it must stay out of the chart's code.
 */

import { type Span, spanOf } from "../voting/range"

export type RewardsRange = "All" | "90d" | "30d"

export const rewardsRanges: readonly RewardsRange[] = ["All", "90d", "30d"]

/** `range` from a search object; All stays out of the URL. */
export function rewardsRangeOf(value: unknown): "90d" | "30d" | undefined {
  return value === "90d" || value === "30d" ? value : undefined
}

/** The rewards period's search params, for a route's validateSearch. */
export function rewardsSearch(
  search: Record<string, unknown>,
): { range?: "90d" | "30d" } & Partial<Span> {
  const range = rewardsRangeOf(search.range)
  return { ...(range === undefined ? {} : { range }), ...spanOf(search) }
}
