/**
 * Dates as the v3 designs write them: "21 Oct", "21 Oct 2025" outside this
 * year, "Today, 15:42", "Yesterday, 21:08", "2 Nov, 09:14". Times are local
 * in the browser; the server renders them in UTC, and so does the browser
 * while it hydrates (dates.tsx), so the two never disagree.
 */

/** `undefined` is the browser's zone; "UTC" is the server's. */
export type DateZone = "UTC" | undefined

function formatters(zone: DateZone) {
  const options = zone === undefined ? {} : { timeZone: zone }
  return {
    dayMonth: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      ...options,
    }),
    dayMonthYear: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...options,
    }),
    time: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...options,
    }),
    day: new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...options,
    }),
  }
}

const local = formatters(undefined)
const utc = formatters("UTC")

function inZone(zone: DateZone) {
  return zone === undefined ? local : utc
}

/** "21 Oct" this year, "21 Oct 2025" otherwise. */
export function formatShortDate(
  iso: string,
  now: Date = new Date(),
  zone: DateZone = undefined,
): string {
  const format = inZone(zone)
  const date = new Date(iso)
  const year = (value: Date) => format.day.format(value).slice(0, 4)
  return year(date) === year(now)
    ? format.dayMonth.format(date)
    : format.dayMonthYear.format(date)
}

/** "Today, 15:42", "Yesterday, 21:08" or "2 Nov, 09:14". */
export function formatSeen(
  iso: string,
  now: Date = new Date(),
  zone: DateZone = undefined,
): string {
  const format = inZone(zone)
  const date = new Date(iso)
  const yesterday = new Date(now.getTime() - 86_400_000)
  const key = (value: Date) => format.day.format(value)
  const day =
    key(date) === key(now)
      ? "Today"
      : key(date) === key(yesterday)
        ? "Yesterday"
        : formatShortDate(iso, now, zone)
  return `${day}, ${format.time.format(date)}`
}

/** "0xf39F…2266": the first six and last four characters. */
export function shortAddress(address: string): string {
  return address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`
}
