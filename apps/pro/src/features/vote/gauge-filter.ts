import { matchesGaugeSearch } from "@matchbox/domain/pool-search"
import type { GaugeSummary } from "../../data/view-models"
import { usdToMicro } from "./ballot"
import type { VoteSort, VoteTab } from "./vote-route"

/**
 * Vote's list of one gauge type: the search box, the tabs and the sort.
 * Kept apart from the view so the rules can be tested without rendering.
 */

type Compare = (left: GaugeSummary, right: GaugeSummary) => number

function compareBig(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1
}

function room(gauge: GaugeSummary): bigint {
  if (gauge.optimalVotes === null) return 0n
  const left = BigInt(gauge.optimalVotes) - BigInt(gauge.votes)
  return left > 0n ? left : 0n
}

const byIncentives: Compare = (left, right) =>
  compareBig(usdToMicro(left.incentivesUsd), usdToMicro(right.incentivesUsd))
const byApy: Compare = (left, right) =>
  (right.apyBps ?? -1) - (left.apyBps ?? -1)
const byVotes: Compare = (left, right) =>
  compareBig(BigInt(left.votes), BigInt(right.votes))
const byRoom: Compare = (left, right) => compareBig(room(left), room(right))

// Each sort, then what breaks its ties. Most gauges tie on the first key
// (on mainnet 722 of 723 veBTC gauges have no incentives and no APY), so
// the ties decide most of the list: the most voted first.
const orders: Record<VoteSort, readonly Compare[]> = {
  incentives: [byIncentives, byApy, byVotes],
  apy: [byApy, byIncentives, byVotes],
  votes: [byVotes, byIncentives],
  room: [byRoom, byIncentives, byVotes],
}

/**
 * Live gauges by the sort, then every expired veBTC gauge (they earn no
 * boost). Nothing is pinned above the sort: the Picked tab lists the
 * ballot. Full ties go by address, so the order is the same on the server
 * and the client and pages never trade rows.
 */
export function sortGauges(
  gauges: readonly GaugeSummary[],
  sort: VoteSort,
): GaugeSummary[] {
  const order = orders[sort]
  return [...gauges].sort((left, right) => {
    const expired = Number(left.expired) - Number(right.expired)
    if (expired !== 0) return expired
    for (const compare of order) {
      const result = compare(left, right)
      if (result !== 0) return result
    }
    const a = left.address.toLowerCase()
    const b = right.address.toLowerCase()
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/**
 * Whether the search box finds a gauge: by name, pool type, the lock id
 * the card shows beside the name ("SNF #6033"), or the start of its
 * address. `needle` is trimmed and lower case.
 */
export function matchesSearch(gauge: GaugeSummary, needle: string): boolean {
  const lockId =
    gauge.tokenId === null || gauge.name.includes("#")
      ? ""
      : ` #${gauge.tokenId}`
  return (
    matchesGaugeSearch(
      needle,
      `${gauge.name}${lockId}`,
      gauge.poolLabel ?? null,
    ) || gauge.address.toLowerCase().startsWith(needle)
  )
}

export type TabTests = Record<VoteTab, (gauge: GaugeSummary) => boolean>

const tabs: readonly VoteTab[] = ["all", "picked", "funded", "watching"]

/**
 * The rows a tab shows, sorted, and every tab's count under the same
 * search, so a tab's count is always the number of rows it lists.
 */
export function listGauges(
  gauges: readonly GaugeSummary[],
  {
    tab,
    sort,
    needle,
    tests,
  }: { tab: VoteTab; sort: VoteSort; needle: string; tests: TabTests },
): { rows: GaugeSummary[]; counts: Record<VoteTab, number> } {
  const found = gauges.filter((gauge) => matchesSearch(gauge, needle))
  const counts: Record<VoteTab, number> = {
    all: 0,
    picked: 0,
    funded: 0,
    watching: 0,
  }
  for (const gauge of found) {
    for (const each of tabs) if (tests[each](gauge)) counts[each] += 1
  }
  return { rows: sortGauges(found.filter(tests[tab]), sort), counts }
}
