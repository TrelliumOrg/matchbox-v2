import type { SeriesRange } from "./scan/series"

/** A chart period as asked: a range, with a custom span's days if any. */
export type PeriodAsked = {
  range: SeriesRange
  from?: string
  to?: string
}

/**
 * The Borrow server functions' inputs, checked: anything a request sends
 * becomes a well-formed input (an unknown period is 30d, an unknown tab
 * the markets, a non-string id empty, which the reads treat as not
 * found), so a crafted call cannot reach the reads with a value they do
 * not expect ("constructor" as a period was a 500). The reads check ids
 * and cursors by shape again. No imports: the browser keeps the stubs.
 */

export type BorrowTabName =
  | "enclaves"
  | "markets"
  | "positions"
  | "liquidations"
  | "troves"

const tabs: readonly BorrowTabName[] = [
  "enclaves",
  "markets",
  "positions",
  "liquidations",
  "troves",
]

/** Longer than any id or cursor a Borrow read takes. */
const maxText = 600

function field(input: unknown, key: string): unknown {
  return typeof input === "object" &&
    input !== null &&
    Object.hasOwn(input, key)
    ? Reflect.get(input, key)
    : undefined
}

function text(input: unknown, key: string): string {
  const value = field(input, key)
  return typeof value === "string" && value.length <= maxText ? value : ""
}

function optionalText(input: unknown, key: string): string | null {
  const value = text(input, key)
  return value === "" ? null : value
}

/** Markets one charts request may name (the overview's list). */
const maxCharts = 12

/**
 * The overview's market charts, read after first paint: the period and
 * each market's id (a 32-byte hex) with its loan decimals as the market
 * list gave them (an integer up to 36, else null). Anything else is
 * dropped; the reads check ids again.
 */
export function chartsInput(input: unknown): PeriodAsked & {
  markets: { id: string; decimals: number | null }[]
} {
  const list = field(input, "markets")
  const markets = (Array.isArray(list) ? list : [])
    .slice(0, maxCharts)
    .flatMap((each: unknown) => {
      const id = text(each, "id")
      if (!/^0x[0-9a-f]{64}$/.test(id)) return []
      const raw = field(each, "decimals")
      const decimals =
        typeof raw === "number" &&
        Number.isInteger(raw) &&
        raw >= 0 &&
        raw <= 36
          ? raw
          : null
      return [{ id, decimals }]
    })
  return { ...periodAsked(input), markets }
}

/** A chart period: 30d unless the input names 90d or All. */
export function rangeInput(value: unknown): SeriesRange {
  return value === "90d" || value === "All" ? value : "30d"
}

/** A custom span's day, by shape ("2026-01-31"); the server checks it. */
function dayInput(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null
}

/** The period asked for: the range, and a span when both days are given. */
export function periodAsked(input: unknown): PeriodAsked {
  const range = rangeInput(field(input, "range"))
  const from = dayInput(field(input, "from"))
  const to = dayInput(field(input, "to"))
  return from === null || to === null ? { range } : { range, from, to }
}

export const borrowInput = {
  overview: (input: unknown): PeriodAsked => periodAsked(input),
  tab: (input: unknown): { tab: BorrowTabName; cursor: string | null } => {
    const tab = field(input, "tab")
    return {
      tab: tabs.find((each) => each === tab) ?? "markets",
      cursor: optionalText(input, "cursor"),
    }
  },
  market: (
    input: unknown,
  ): { market: string; cursor: string | null } & PeriodAsked => ({
    market: text(input, "market"),
    ...periodAsked(input),
    cursor: optionalText(input, "cursor"),
  }),
  position: (input: unknown): { market: string; account: string } => ({
    market: text(input, "market"),
    account: text(input, "account"),
  }),
  trove: (input: unknown): { owner: string } => ({
    owner: text(input, "owner"),
  }),
  enclave: (input: unknown): { position: string } => ({
    position: text(input, "position"),
  }),
}

/** The troves' collateral ratio's key among the overview's charts. */
export const trovesChartId = "troves"
