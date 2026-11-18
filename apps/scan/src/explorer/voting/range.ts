/**
 * The period a captioned panel shows (matchbox-v3: period toggle right,
 * 30d first, then 90d, then All), as a search param. No imports: safe for
 * the browser bundle; the server maps a range to days.
 */

export type Range = "30d" | "90d" | "All"

export const ranges: readonly Range[] = ["30d", "90d", "All"]

/** `range` from a search object; the default (30d) stays out of the URL. */
export function rangeOf(value: unknown): Exclude<Range, "30d"> | undefined {
  return value === "90d" || value === "All" ? value : undefined
}

/**
 * A custom period's days (`?from=2026-01-01&to=2026-03-31`), as asked.
 * The server clamps and orders them; this only checks their shape.
 */
export type Span = { from: string; to: string }

const dayShape = /^\d{4}-\d{2}-\d{2}$/

/** `from` and `to` from a search object, when both are days. */
export function spanOf(search: Record<string, unknown>): Span | undefined {
  const { from, to } = search
  return typeof from === "string" &&
    typeof to === "string" &&
    dayShape.test(from) &&
    dayShape.test(to)
    ? { from, to }
    : undefined
}

/** A period as its toggle shows it (the server works it out). */
export type PeriodView = {
  /** The range picked; null for a custom span. */
  range: Range | null
  /** The days shown, "2026-01-01". */
  from: string
  to: string
  /** The earliest and latest days a span may pick. */
  min: string
  max: string
  /** "30d", "All", "1 Jan to 31 Mar". */
  text: string
}

/** What a page's loader asks for: a range, or a custom span over it. */
export type PeriodInput = { range: Range; from?: string; to?: string }

/** A route's search as its loader's period. */
export function periodInput(search: {
  range?: Range
  from?: string
  to?: string
}): PeriodInput {
  const span = spanOf(search)
  return { range: search.range ?? "30d", ...(span ?? {}) }
}

/** The period's own search params, for a route's validateSearch. */
export function periodSearch(
  search: Record<string, unknown>,
): { range?: Exclude<Range, "30d"> } & Partial<Span> {
  const range = rangeOf(search.range)
  return { ...(range === undefined ? {} : { range }), ...spanOf(search) }
}

/** An opaque Scan list cursor from a search object. */
export function cursorOf(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,512}$/.test(value)
    ? value
    : undefined
}
