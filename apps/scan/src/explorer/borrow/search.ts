/**
 * The Borrow pages' search params: a chart's period and a list's keyset
 * cursor. The routes pass the raw search to their loaders and read it
 * here, so none of this ships in the entry chunk (route options other
 * than the split loader and components are in every page's first paint).
 * The server checks both again.
 */

import { type PeriodView, spanOf } from "../voting/range"

export const rangeNames = ["30d", "90d", "All"] as const
export type RangeName = (typeof rangeNames)[number]

/** A chart period as the pages ask for it: a range, or a custom span. */
export type ChartPeriod = { range: RangeName; from?: string; to?: string }

/** The period the server settled on, asked for again (a span's days). */
export function chartPeriod(view: PeriodView): ChartPeriod {
  return view.range === null
    ? { range: "30d", from: view.from, to: view.to }
    : { range: view.range }
}

/** One key per period, for the charts' kept reads. */
export function periodKey(period: ChartPeriod): string {
  return `${period.range}:${period.from ?? ""}:${period.to ?? ""}`
}

/** The period's search params (30d alone stays out of the URL). */
export function periodParams(period: ChartPeriod): Record<string, string> {
  if (period.from !== undefined && period.to !== undefined) {
    return { from: period.from, to: period.to }
  }
  return period.range === "30d" ? {} : { range: period.range }
}

/** The non-default period in a URL (30d is the default and stays out). */
function parseRange(value: unknown): "90d" | "All" | undefined {
  return value === "90d" || value === "All" ? value : undefined
}

const scanCursor = /^[A-Za-z0-9_-]{4,512}$/

/** An opaque API cursor (`?cursor=`), when it has a cursor's shape. */
function parseCursor(value: unknown): string | undefined {
  return typeof value === "string" && scanCursor.test(value) ? value : undefined
}

function field(search: unknown, key: string): unknown {
  return typeof search === "object" && search !== null && key in search
    ? Reflect.get(search, key)
    : undefined
}

/**
 * A Borrow page's search: the period (30d by default, or a custom span's
 * `from` and `to`) and the cursor.
 */
export function readSearch(search: unknown): {
  period: ChartPeriod
  cursor: string | null
} {
  const span = spanOf({ from: field(search, "from"), to: field(search, "to") })
  return {
    period: {
      range: parseRange(field(search, "range")) ?? "30d",
      ...(span ?? {}),
    },
    cursor: parseCursor(field(search, "cursor")) ?? null,
  }
}
