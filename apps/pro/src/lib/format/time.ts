const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

const weekdaysLong = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

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

function utcDate(unix: number): Date {
  return new Date(unix * 1000)
}

/** "Thu 5 Nov" */
export function formatDay(unix: number): string {
  const date = utcDate(unix)
  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]}`
}

/** "Thursday 5 Nov" for list headings. */
export function formatDayLong(unix: number): string {
  const date = utcDate(unix)
  return `${weekdaysLong[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]}`
}

/** "Thursday" */
export function formatWeekday(unix: number): string {
  return weekdaysLong[utcDate(unix).getUTCDay()] ?? ""
}

/** "9 Jan 2030" */
export function formatDate(unix: number): string {
  const date = utcDate(unix)
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** "09:40" */
export function formatTime(unix: number): string {
  const date = utcDate(unix)
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}`
}

/** "Fri 30 Oct, 09:12" */
export function formatDayTime(unix: number): string {
  return `${formatDay(unix)}, ${formatTime(unix)}`
}
