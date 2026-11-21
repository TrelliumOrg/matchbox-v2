// Dates in Stuart's sourcing check. A date is sourced as a whole, never as
// its numbers: "15 Aug 2026" in a tool result sources "15 Aug 2026",
// "Aug 15, 2026" and "2026-08-15", but not "15 Oct 2026", nor "15" or
// "2026" anywhere else in the sentence.
//
// Keys: "2026-08-15" (a full date), "--08-15" (no year), "2026-08" (a
// month). A sentence's date passes when each of its keys is known:
// a full date exactly, a day without a year by its month and day, and a
// month by any known date in it. A weekday written with a full date must
// be that date's weekday.

const MONTHS: ReadonlyArray<readonly [string, string]> = [
  ["Jan", "January"],
  ["Feb", "February"],
  ["Mar", "March"],
  ["Apr", "April"],
  ["May", "May"],
  ["Jun", "June"],
  ["Jul", "July"],
  ["Aug", "August"],
  ["Sep", "September"],
  ["Oct", "October"],
  ["Nov", "November"],
  ["Dec", "December"],
]

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

/** Month names as written, capitalised only: "may" is a verb. */
const MONTH =
  "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?"
const WEEKDAY =
  "(?:(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day|nesday|sday|urday|rsday)?\\.?,?\\s+)?"
/**
 * No digit is taken into a date unless it is part of the date: a day or a
 * year never starts after a digit, "." or "," that joins it to a number
 * ("5.19 Nov", "1,2026"), nor runs on into one ("Nov 19.5", "2026,5").
 */
const NOT_AFTER = "(?<![\\d.,])"
const NOT_BEFORE = "(?![\\d:]|[.,]\\d)"
/**
 * What may follow a year. Four digits after a day and a month are a year
 * only when nothing amount-like follows them: the end, a mark ("2026,",
 * "2026)"), a time ("2026 09:30"), a range dash, "UTC", or a lowercase word
 * that is no token or unit ("2026 at", "2026 shows"). A capitalised word,
 * a token or unit in any case ("bitcoin", "bucks", "-MUSD", "worth of"),
 * "%" or "$" make them an amount: "Repay Nov 19, 2026 Bitcoin" is a date
 * ("Nov 19") and then 2026, checked as a number. When unsure, an amount.
 */
const AMOUNT_WORDS =
  "bitcoins?|btc|tbtc|wbtc|musd|smusd|mezo|usd[a-z]*|dollars?|bucks?|cents?|sats?|satoshis?|tokens?|coins?|ve[a-z]+|eth|ether|eur[a-z]*|gbp|yen|units?|shares?|worth|lp|k|m|mm|bn|thousand|million|billion|grand|lakhs?|crores?|thou|x"
const YEAR_END = String.raw`(?=\s*$|[.,:!?)\]}"'’”\x3b]|\s+(?!(?:${AMOUNT_WORDS})(?![a-z]))[a-z]|\s+(?:UTC|GMT)\b|\s+\d{1,2}:\d{2}|\s+\(|\s+-\s)`
const DAY = `${NOT_AFTER}(\\d{1,2})(?:st|nd|rd|th)?${NOT_BEFORE}`
/** A plausible year only, 1970 to 2199: "Nov 19, 5000" is a day, then 5000. */
const YEAR_DIGITS = `${NOT_AFTER}((?:19[7-9]|2[01]\\d)\\d)${NOT_BEFORE}${YEAR_END}`
const YEAR = `(?:,?\\s+${YEAR_DIGITS})?`
/** "to", "until" or a hyphen or en dash (U+2013) between two dates. */
const BETWEEN = "\\s*(?:to|until|through|and|-|\\u2013)\\s*"

type Pattern = {
  regex: RegExp
  read: (match: RegExpExecArray) => Omit<DateSpan, "start" | "end" | "text">
}

export type DateSpan = {
  start: number
  end: number
  text: string
  /** One key per date the span names ("1 to 31 Mar 2026" names two). */
  keys: string[]
  /** The weekday written with it, lowercased ("wed"), if any. */
  weekday: string | null
}

function monthNumber(name: string): number {
  const index = MONTHS.findIndex(([short]) => name.startsWith(short))
  return index + 1
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function isRealDay(year: number | null, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  // A leap year, when the year is unknown, so 29 Feb stays possible.
  const probe = new Date(Date.UTC(year ?? 2024, month - 1, day))
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

function dayKey(year: number | null, month: number, day: number): string {
  return year === null
    ? `--${pad(month)}-${pad(day)}`
    : `${year}-${pad(month)}-${pad(day)}`
}

/**
 * A captured year must be a real one: an implausible year makes the whole
 * date invalid (NaN fails validKey), never a date without its year, so the
 * digits it took are never dropped unchecked.
 */
function yearOf(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const year = Number(raw)
  return plausibleYear(year) ? year : Number.NaN
}

function plausibleYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1970 && year <= 2199
}

function weekdayOf(raw: string | undefined): string | null {
  return raw === undefined ? null : raw.slice(0, 3).toLowerCase()
}

/** Longest forms first: a span claimed by one is not read again. */
const PATTERNS: Pattern[] = [
  {
    // 2026-08-15, 2026-08-15T00:00:00Z, 2026-08-15T09:30:00.000+02:00.
    // Only a real time belongs to the date: "2026-11-19T5000" is the date,
    // then "T5000".
    regex:
      /(?<![\d.,])\b(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?(?![\d-]|[.,:]\d)/g,
    read: (m) => ({
      keys: [dayKey(yearOf(m[1]), Number(m[2]), Number(m[3]))],
      weekday: null,
    }),
  },
  {
    // 1 to 31 March 2026, 1-31 Mar
    regex: new RegExp(`\\b${DAY}${BETWEEN}${DAY}\\s+${MONTH}${YEAR}\\b`, "g"),
    read: (m) => {
      const month = monthNumber(m[3] ?? "")
      const year = yearOf(m[4])
      return {
        keys: [
          dayKey(year, month, Number(m[1])),
          dayKey(year, month, Number(m[2])),
        ],
        weekday: null,
      }
    },
  },
  {
    // Wed 20 Oct 2027, 15 August 2026, 13 Nov
    regex: new RegExp(`\\b${WEEKDAY}${DAY}\\s+${MONTH}${YEAR}\\b`, "g"),
    read: (m) => ({
      keys: [dayKey(yearOf(m[4]), monthNumber(m[3] ?? ""), Number(m[2]))],
      weekday: weekdayOf(m[1]),
    }),
  },
  {
    // Aug 15, 2026, Wednesday, October 20 2027
    regex: new RegExp(`\\b${WEEKDAY}${MONTH}\\s+${DAY}${YEAR}\\b`, "g"),
    read: (m) => ({
      keys: [dayKey(yearOf(m[4]), monthNumber(m[2] ?? ""), Number(m[3]))],
      weekday: weekdayOf(m[1]),
    }),
  },
  {
    // March 2026
    regex: new RegExp(`\\b${MONTH}\\s+${YEAR_DIGITS}\\b`, "g"),
    read: (m) => ({
      keys: [`${m[2]}-${pad(monthNumber(m[1] ?? ""))}`],
      weekday: null,
    }),
  },
]

function validKey(key: string): boolean {
  const day = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/.exec(key)
  if (day) {
    const year = day[1] === undefined ? null : Number(day[1])
    if (year !== null && !plausibleYear(year)) return false
    return isRealDay(year, Number(day[2]), Number(day[3]))
  }
  const month = /^(\d{4})-(\d{2})$/.exec(key)
  return (
    month !== null &&
    plausibleYear(Number(month[1])) &&
    Number(month[2]) >= 1 &&
    Number(month[2]) <= 12
  )
}

/**
 * Every date written in the text, in order. A day without a year takes the
 * year of the date it runs to ("1 Oct to 31 Oct 2026").
 */
export function dateSpans(text: string): DateSpan[] {
  const spans: DateSpan[] = []
  const taken = (start: number, end: number) =>
    spans.some((span) => start < span.end && end > span.start)
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0
    for (const match of text.matchAll(pattern.regex)) {
      const start = match.index
      const end = start + match[0].length
      if (taken(start, end)) continue
      const read = pattern.read(match as RegExpExecArray)
      // Not a real date ("31 Feb", "Oct 2026" read as a day): not a date.
      if (!read.keys.every(validKey)) continue
      spans.push({ start, end, text: match[0], ...read })
    }
  }
  spans.sort((a, b) => a.start - b.start)
  for (const [index, span] of spans.entries()) {
    const next = spans[index + 1]
    if (next === undefined) continue
    const year = next.keys[0]?.slice(0, 4)
    if (year === undefined || year.startsWith("-")) continue
    if (!new RegExp(`^${BETWEEN}$`).test(text.slice(span.end, next.start))) {
      continue
    }
    span.keys = span.keys.map((key) =>
      key.startsWith("--") && validKey(`${year}${key.slice(1)}`)
        ? `${year}${key.slice(1)}`
        : key,
    )
  }
  return spans
}

/** A date's own key for a timestamp, in UTC as Stuart writes dates. */
export function dateKeyOf(date: Date): string {
  return dayKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  )
}

/** The keys of every date written in the text. */
export function dateKeys(text: string): string[] {
  return dateSpans(text).flatMap((span) => span.keys)
}

function keyIsKnown(key: string, known: ReadonlySet<string>): boolean {
  if (known.has(key)) return true
  if (key.startsWith("--")) {
    // No year: any known day with that month and day.
    const tail = key.slice(1)
    for (const each of known) if (each.endsWith(tail)) return true
    return false
  }
  if (key.length === 7) {
    // A month: any known day in it.
    for (const each of known) if (each.startsWith(`${key}-`)) return true
  }
  return false
}

function weekdayMatches(span: DateSpan): boolean {
  if (span.weekday === null) return true
  return span.keys.every((key) => {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
    if (!day) return true
    const date = new Date(
      Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])),
    )
    return WEEKDAYS[date.getUTCDay()] === span.weekday
  })
}

/** A written date is sourced when each date it names is known. */
export function dateIsKnown(
  span: DateSpan,
  known: ReadonlySet<string>,
): boolean {
  return (
    span.keys.every((key) => keyIsKnown(key, known)) && weekdayMatches(span)
  )
}
