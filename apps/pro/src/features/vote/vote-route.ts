import { fetchLive } from "../../data/live-query"
import { gaugesQuery, voterQuery } from "../../data/queries"
import type { GaugeList, Voter } from "../../data/view-models"

/**
 * What Vote's routes need before the view loads: search validation and
 * the loader (the default type is `default-kind`). Kept apart from the view so the route
 * definitions (which ship on every first paint) never pull the view in.
 */

export type VoteTab = "all" | "picked" | "funded" | "watching"
export type VoteSort = "apy" | "incentives" | "votes" | "room"

export type VoteSearch = {
  tab?: VoteTab | undefined
  sort?: VoteSort | undefined
  /** The list's page, from 2 (page 1 stays out of the URL). */
  page?: number | undefined
  /** The search box, as typed. */
  q?: string | undefined
  /**
   * A gauge to put on the ballot on arrival (Matchscan's "Vote on
   * Matchbox"): its address, lower case. Vote takes it out of the URL once
   * a connected wallet's ballot has it.
   */
  pick?: string | undefined
}

const tabs: readonly VoteTab[] = ["all", "picked", "funded", "watching"]
const sorts: readonly VoteSort[] = ["incentives", "apy", "votes", "room"]

const gaugeAddress = /^0x[0-9a-fA-F]{40}$/

export function validateVoteSearch(
  search: Record<string, unknown>,
): VoteSearch {
  const tab = tabs.find((value) => value === search.tab)
  const sort = sorts.find((value) => value === search.sort)
  const page = pageOf(search.page)
  const q = typeof search.q === "string" && search.q !== "" ? search.q : null
  const pick =
    typeof search.pick === "string" && gaugeAddress.test(search.pick)
      ? search.pick.toLowerCase()
      : null
  // Every key is set, to undefined when it is the default or unknown: the
  // router lays these over the raw query, so a key left out keeps what
  // the URL had, and "/vote?tab=" handed Vote a tab it has no list for
  // (the page fell to "Data unavailable", 19 Nov 2026).
  return {
    tab: tab === undefined || tab === "all" ? undefined : tab,
    sort: sort === undefined || sort === "incentives" ? undefined : sort,
    page: page ?? undefined,
    q: q === null ? undefined : q.slice(0, 80),
    pick: pick ?? undefined,
  }
}

/** A page number from the URL: a whole number from 2, else page 1. */
function pageOf(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]{1,5}$/.test(value)
        ? Number(value)
        : Number.NaN
  return Number.isInteger(number) && number >= 2 ? number : null
}

export async function loadVote(address: string | null): Promise<{
  list: GaugeList
  voter: Voter | null
}> {
  const [list, voter] = await Promise.all([
    fetchLive(gaugesQuery),
    address === null ? null : fetchLive(voterQuery(address)),
  ])
  return { list, voter }
}
