/**
 * Tools the host app offers from the search box (Ctrl K), beside Ask
 * Stuart and the gauges, wallets and transactions the Worker finds. Pro
 * registers its boost calculator, its pages and the viewed wallet's locks:
 * typing "boost" lists the calculator first.
 *
 * A tiny module of its own so an app can register on first paint without
 * loading the search results' code.
 */

export type SearchCommand = {
  id: string
  /** "Boost calculator" */
  label: string
  /** The line under the label: "How much veMEZO for 5×" */
  hint: string
  /** Words that find it, lower case. The label's own words count too. */
  keywords: readonly string[]
  /** Where it goes in the host app, through the host's navigation. */
  to: string
  /**
   * The heading it is listed under ("Pages", "Locks"). Commands without
   * one come first, under no heading.
   */
  group?: string
}

/** Each registered set, by name, in the order first registered. */
const sets = new Map<string, readonly SearchCommand[]>()

/**
 * Registers a set of commands, replacing the set of the same name. The
 * app's fixed tools are one set; a list that changes with the page or the
 * wallet (the viewed wallet's locks) is another, replaced as it changes.
 */
export function registerSearchCommands(
  list: readonly SearchCommand[],
  set = "app",
): void {
  sets.set(set, list)
}

/**
 * The commands a query finds: every word typed starts one of the
 * command's words ("boo calc" finds "Boost calculator"). An empty query
 * finds none. Ungrouped commands first, then each group together, in the
 * order registered.
 */
export function matchCommands(query: string): SearchCommand[] {
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (typed.length === 0) return []
  const found = [...sets.values()].flat().filter((command) => {
    const words = [
      ...command.label.toLowerCase().split(/\s+/),
      ...command.keywords,
    ]
    return typed.every((part) => words.some((word) => word.startsWith(part)))
  })
  const groups = [...new Set(found.map((command) => command.group))]
  return [
    ...found.filter((command) => command.group === undefined),
    ...groups.flatMap((group) =>
      group === undefined
        ? []
        : found.filter((command) => command.group === group),
    ),
  ]
}
