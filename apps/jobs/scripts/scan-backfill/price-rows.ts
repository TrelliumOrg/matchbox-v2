import type { JsonRow } from "../../src/scan/statements"
import { dayStart, nextDay } from "../../src/scan/transform"

// The price backfill's pure parts (price-history.ts): which block closes a
// day, which missing price is a failed read, and the price_daily rows.

export const priceHistorySource = "backfill:price-history"

/**
 * The live job's last write of a day's close is its 00:00 UTC run, with
 * the newest price (runPriceClose), so the close is the state at the head
 * at 00:00:00 of the next day: the last block below this bound.
 */
export function priceCloseBound(day: string): number {
  return dayStart(nextDay(day)) + 1
}

/**
 * Tokens priced on an earlier day but not on this one: a source that has
 * started never stops (the oracle and the pool stay deployed), so this is
 * a failed or rejected read and the day is retried. A token never priced
 * before simply has no source yet (the Base pool's first state is in Jan
 * 2026).
 */
export function missingPrices(
  earlier: Iterable<Readonly<Record<string, string>>>,
  prices: Readonly<Record<string, string>>,
): string[] {
  const seen = new Set<string>()
  for (const bucket of earlier) {
    for (const token of Object.keys(bucket)) seen.add(token)
  }
  return [...seen].filter((token) => prices[token] === undefined).sort()
}

/** price_daily rows, one per token per day, oldest first. */
export function priceRowsOf(
  days: Readonly<Record<string, Readonly<Record<string, string>>>>,
  source: string,
  nowSeconds: number,
): JsonRow[] {
  return Object.keys(days)
    .sort()
    .flatMap((day) =>
      Object.entries(days[day] ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([token, price]) => ({
          token,
          day,
          price,
          source,
          updated_at: nowSeconds,
        })),
    )
}
