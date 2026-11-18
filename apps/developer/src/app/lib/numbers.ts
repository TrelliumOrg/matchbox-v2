/** Console figures as the v3 frames write them: "1.24M", "842k", "0.33%". */

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
})

const whole = new Intl.NumberFormat("en-US")

export function compactNumber(value: number): string {
  if (value < 10_000) return whole.format(value)
  return compact.format(value).replace("K", "k")
}

/** An error rate in [0, 1]; "No traffic" when there were no requests. */
export function formatRate(rate: number | null): string {
  if (rate === null) return "No traffic"
  return `${(rate * 100).toFixed(2)}%`
}

export function formatLatency(ms: number | null): string {
  return ms === null ? "No traffic" : `${Math.round(ms)} ms`
}

const weekday = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  timeZone: "UTC",
})

/** "Sun 1" for a UTC day bucket. */
export function dayLabel(iso: string): string {
  return weekday.format(new Date(iso)).replace(",", "")
}

/**
 * In UTC, like every console date: pages render on the server (UTC) and
 * hydrate in the browser, and a local day would differ from the server's
 * whenever the two calendars disagree (a hydration error, then a re-render).
 */
const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

/** "2 Oct", the UTC day. */
export function shortDate(iso: string): string {
  return dayMonth.format(new Date(iso))
}
