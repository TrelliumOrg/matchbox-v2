/**
 * A custom span's name, for the server's period and the rewards chart.
 * Its own module: the route modules' range parsing loads with every page,
 * and this need not.
 */

const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")

/**
 * A real day, "2026-02-28": a day's shape that round-trips. The URL's
 * `from` and `to` are checked for their shape only (range.ts, loaded by
 * every page); "2026-02-31" is no day, which those who name one check.
 */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value)
}

/** "5 Nov" from "2026-11-05", "5 Nov 2025" with its year. */
function dayText(day: string, year: boolean): string {
  const [y = "", m = "", d = ""] = day.split("-")
  const text = `${Number(d)} ${months[Number(m) - 1] ?? ""}`
  return year ? `${text} ${y}` : text
}

/**
 * A span as a toggle and a label say it: "1 Jan to 31 Mar", with the year
 * where it is not today's ("1 Dec 2025 to 31 Jan 2026").
 */
export function spanText(from: string, to: string, today: string): string {
  const thisYear = today.slice(0, 4)
  const fromYear = from.slice(0, 4)
  const toYear = to.slice(0, 4)
  if (from === to) return dayText(from, fromYear !== thisYear)
  if (fromYear === toYear) {
    return `${dayText(from, false)} to ${dayText(to, toYear !== thisYear)}`
  }
  return `${dayText(from, true)} to ${dayText(to, true)}`
}
