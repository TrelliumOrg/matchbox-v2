/**
 * Age and timestamp text, in UTC so server and client agree. The same
 * rules as `@matchbox/domain/format` (formatAgo, formatDayTime): this
 * package does not depend on domain, so the few lines live here too.
 */

/** Elapsed time for live tables: "45s", "2m", "1h", "3d". */
export function formatAge(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m`
  if (total < 86_400) return `${Math.floor(total / 3600)}h`
  return `${Math.floor(total / 86_400)}d`
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

function two(value: number): string {
  return value.toString().padStart(2, "0")
}

/** "Sun 8 Nov 2026, 11:53:40 UTC", the block detail's Time row. */
export function formatTimestamp(unix: number): string {
  const date = new Date(unix * 1000)
  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} UTC`
}

/** How often an age this old changes: every second under a minute. */
export function tickMs(seconds: number): number {
  if (seconds < 60) return 1000
  if (seconds < 3600) return 15_000
  return 60_000
}
