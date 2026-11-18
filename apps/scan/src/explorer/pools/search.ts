import type { PoolChain, PoolFilters } from "../../data/pools"

/**
 * The Pools search params for a set of filters, leaving out the defaults.
 * Its own module because the route's validateSearch, which every Scan page
 * loads, needs it: importing it from pools-page put the whole Pools table
 * and its imports in the entry chunk.
 */
export function searchOf(filters: PoolFilters): {
  chain?: PoolChain
  token?: "musd" | "mezo"
  small?: true
} {
  return {
    ...(filters.chain === "all" ? {} : { chain: filters.chain }),
    ...(filters.asset === "all" ? {} : { token: filters.asset }),
    ...(filters.small ? { small: true as const } : {}),
  }
}
