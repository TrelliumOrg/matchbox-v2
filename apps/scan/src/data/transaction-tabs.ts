/**
 * The Transactions page's category tabs (`ndoSD6xB0U`), as `?tab=`. No
 * imports: the route's search check runs in the browser too. Each tab past
 * All is a set of activity actions (`/activity/action/{a}`); the design's
 * Loans, Transfers, Bridge and Contract calls tabs have no list to filter
 * yet and are left out.
 */

export type TxTab = "all" | "votes" | "claims" | "swaps"

export const txTabs: readonly TxTab[] = ["all", "votes", "claims", "swaps"]

export const txTabNames: Record<TxTab, string> = {
  all: "All",
  votes: "Votes",
  claims: "Claims",
  swaps: "Swaps",
}

/** The activity actions a tab lists. */
export const txTabActions: Record<Exclude<TxTab, "all">, readonly string[]> = {
  votes: ["BOOST_VOTE", "BOOST_ABSTAIN", "BOOST_POKE"],
  claims: ["VOTE_BRIBE_CLAIMED", "VOTE_FEE_CLAIMED"],
  swaps: ["SWAP"],
}

export function txTabOf(value: unknown): TxTab | null {
  return txTabs.find((tab) => tab === value) ?? null
}

/** A merged activity cursor in the URL (activity-merge). */
export const activityCursorPattern = /^[A-Za-z0-9_-]{4,2048}$/
