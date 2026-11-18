import type { GaugeCard } from "@matchbox/contracts/read-models"
import { matchesGaugeSearch } from "@matchbox/domain/pool-search"
import { nameWithPoolType, poolTypeLabel } from "@matchbox/domain/pool-type"

/**
 * Gauge names for the name search. A pool gauge is named with its pool
 * type ("BTC/MUSD CL200"), as Pro and Matchscan show it, so the pools that
 * share a pair can be told apart in the results and found by their type
 * ("cl200", "btc/musd volatile").
 */

export type GaugeSearchEntry = {
  address: string
  /** The name as shown, with the pool type for pool gauges. */
  name: string
  base: string
  label: string | null
}

export function gaugeSearchEntry(card: GaugeCard): GaugeSearchEntry {
  const label =
    card.gauge.kind === "pool"
      ? poolTypeLabel({
          poolType: card.gauge.poolType,
          tickSpacing: card.gauge.tickSpacing,
        })
      : null
  return {
    address: card.gauge.address,
    name: nameWithPoolType(card.gauge.name, label),
    base: card.gauge.name,
    label,
  }
}

/** The entries whose name or pool type holds every word of `query`. */
export function matchGaugeNames(
  entries: readonly GaugeSearchEntry[],
  query: string,
  limit: number,
): { address: string; name: string }[] {
  return entries
    .filter((entry) => matchesGaugeSearch(query, entry.base, entry.label))
    .slice(0, limit)
    .map(({ address, name }) => ({ address, name }))
}
