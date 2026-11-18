import type { ProtocolEvent } from "../../data/view-models"

/**
 * Protocol's Live activity: which rows a view shows and where its next
 * page starts. The page paints with the 20 rows in the protocol document;
 * "Load more" and the event filter read the rest from the API, a page at
 * a time, starting after the last row already on screen.
 */

export type Feed = "activity" | "system"

export type EventFilter = "all" | "votes" | "claims" | "locks" | "incentives"

export const eventFilters: readonly { value: EventFilter; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "votes", label: "Votes" },
  { value: "claims", label: "Claims" },
  { value: "locks", label: "Locks" },
  { value: "incentives", label: "Incentives" },
]

/** The API's category of each action (the contract's `activityCategory`). */
const categoryOf: Record<
  ProtocolEvent["action"],
  Exclude<EventFilter, "all"> | "system"
> = {
  vote: "votes",
  boost: "votes",
  claim: "claims",
  "lock-create": "locks",
  "lock-add": "locks",
  "lock-extend": "locks",
  "lock-merge": "locks",
  "lock-withdraw": "locks",
  incentive: "incentives",
  "boost-refresh": "system",
}

export function parseEventFilter(value: unknown): EventFilter {
  return eventFilters.find((filter) => filter.value === value)?.value ?? "all"
}

/**
 * The category to ask the API for, or null for every row. System rows are
 * a category of their own; "All events" under Activity has none, so it
 * reads everything and `shown` leaves the system rows out.
 */
export function categoryFor(
  feed: Feed,
  filter: EventFilter,
): Exclude<EventFilter, "all"> | "system" | null {
  if (feed === "system") return "system"
  return filter === "all" ? null : filter
}

/** The rows of `events` this view shows, in the order given. */
export function shown(
  events: readonly ProtocolEvent[],
  feed: Feed,
  filter: EventFilter,
): ProtocolEvent[] {
  return events.filter((event) => {
    const category = categoryOf[event.action]
    if (feed === "system") return category === "system"
    return category !== "system" && (filter === "all" || category === filter)
  })
}

/**
 * Where the first "Load more" of a view starts: after the last painted row
 * the API's list for that category also holds, or from its top when the
 * painted rows hold none of that category.
 */
export function firstCursor(
  painted: readonly ProtocolEvent[],
  feed: Feed,
  filter: EventFilter,
): string | null {
  const category = categoryFor(feed, filter)
  const inList =
    category === null
      ? painted
      : painted.filter((event) => categoryOf[event.action] === category)
  return inList.at(-1)?.id ?? null
}

/** `first` then the rows of `later` not already in it. */
export function mergeById(
  first: readonly ProtocolEvent[],
  later: readonly ProtocolEvent[],
): ProtocolEvent[] {
  const seen = new Set(first.map((event) => event.id))
  return [...first, ...later.filter((event) => !seen.has(event.id))]
}

/**
 * The line under the list. With a total: "Showing 20 of 215 events", and
 * once the last page was read with rows still short of it, "Showing the
 * latest 97 of 215 events", so a list that ends early does not read as
 * broken. Without a total (a filtered view): "Showing 12".
 */
export function countLine(
  shownRows: number,
  total: number | null,
  hasMore: boolean,
): string {
  if (total === null) return `Showing ${shownRows}`
  const of = `${shownRows} of ${total.toLocaleString("en-US")} events`
  return !hasMore && shownRows < total
    ? `Showing the latest ${of}`
    : `Showing ${of}`
}
