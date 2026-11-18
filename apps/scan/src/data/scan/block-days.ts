import { formatDecimal, groupThousands } from "@matchbox/domain/format"
import { secondsText, slowAfter } from "./block-times"
import { dayLabel } from "./series-views"

/**
 * Block time between the daily head reads (`chain.block_height`, and the
 * head block's own time, `chain.block_height_time`): blocks made over the
 * seconds between two reads' head blocks. The reads happen whenever the
 * daily job ran, so neither span is taken to be 24 hours. A day stored
 * before head times were kept has no time and counts in no span: those
 * days are left out rather than guessed.
 */

export type BlockDayBar = {
  /** The later read's day. */
  day: string
  label: string
  /** Block time in tenths of a second, for the bar's height. */
  tenths: number
  text: string
  slow: boolean
}

export type BlockDays = {
  /** The span between the latest two timed reads. */
  latest: {
    label: string
    hours: string
    /** "Last day" for a span of about a day, else "Last 47.9h". */
    name: string
    blocks: string
    average: string
  }
  /** Every timed span read (up to 30 days). */
  span: { days: string; blocks: string; average: string }
  /** Oldest first, one per span. */
  bars: BlockDayBar[]
}

type Point = { day: string; decimal: string }

const whole = /^[0-9]+$/

/** "23.9" hours, "2" days: tenths rounded half up, a trailing ".0" dropped. */
function oneDecimal(tenths: bigint): string {
  return formatDecimal(`${tenths / 10n}.${tenths % 10n}`, 1).replace(/\.0$/, "")
}

/** A span of 22 to 26 hours is a day; any other says its hours. */
export function spanName(seconds: bigint): string {
  if (seconds >= 22n * 3_600n && seconds <= 26n * 3_600n) return "Last day"
  return `Last ${oneDecimal((seconds * 10n + 1_800n) / 3_600n)}h`
}

/** Null without two timed reads with blocks between them. */
export function blockDays(
  heights: readonly Point[],
  times: readonly Point[],
): BlockDays | null {
  const timeOf = new Map(
    times
      .filter((point) => whole.test(point.decimal))
      .map((point) => [point.day, BigInt(point.decimal)]),
  )
  const reads = heights
    .filter((point) => whole.test(point.decimal) && timeOf.has(point.day))
    .map((point) => ({
      day: point.day,
      height: BigInt(point.decimal),
      time: timeOf.get(point.day) ?? 0n,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
  const spans: { day: string; blocks: bigint; seconds: bigint }[] = []
  for (const [index, read] of reads.entries()) {
    const before = reads[index - 1]
    if (before === undefined) continue
    const blocks = read.height - before.height
    const seconds = read.time - before.time
    if (blocks > 0n && seconds > 0n) {
      spans.push({ day: read.day, blocks, seconds })
    }
  }
  const last = spans.at(-1)
  if (last === undefined) return null
  const blocks = spans.reduce((sum, span) => sum + span.blocks, 0n)
  const seconds = spans.reduce((sum, span) => sum + span.seconds, 0n)
  const text = (time: bigint, count: bigint) =>
    secondsText(Number(time), Number(count))
  return {
    latest: {
      label: dayLabel(last.day),
      hours: oneDecimal((last.seconds * 10n + 1_800n) / 3_600n),
      name: spanName(last.seconds),
      blocks: groupThousands(last.blocks),
      average: text(last.seconds, last.blocks),
    },
    span: {
      days: oneDecimal((seconds * 10n + 43_200n) / 86_400n),
      blocks: groupThousands(blocks),
      average: text(seconds, blocks),
    },
    bars: spans.map((span) => {
      const tenths = Number((span.seconds * 10n) / span.blocks)
      return {
        day: span.day,
        label: dayLabel(span.day),
        tenths,
        text: text(span.seconds, span.blocks),
        slow: tenths > slowAfter * 10,
      }
    }),
  }
}
