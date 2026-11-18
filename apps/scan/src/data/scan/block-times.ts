import { groupThousands } from "@matchbox/domain/format"

/**
 * Block times from the blocks' own timestamps (whole seconds on Mezo): a
 * block's "Took" is its time after the block before it, known only when
 * both are in hand; the average is the span over the blocks between the
 * newest and the oldest, so a gap in the list costs nothing. Pure, and
 * small enough for the browser (Home's live list).
 */

type Timed = { height: number; timestamp: number | null }

/** "3.8s", one decimal, from whole seconds over blocks, in integers. */
export function secondsText(seconds: number, blocks: number): string {
  const tenths = Math.round((seconds * 10) / blocks)
  return `${Math.floor(tenths / 10)}.${tenths % 10}s`
}

/**
 * Each block's time after its parent (newest first, as the lists come),
 * null where the parent is not the next row or a timestamp is missing.
 */
export function tookSeconds(rows: readonly Timed[]): (number | null)[] {
  return rows.map((row, index) => {
    const parent = rows[index + 1]
    if (
      parent === undefined ||
      parent.height !== row.height - 1 ||
      row.timestamp === null ||
      parent.timestamp === null
    ) {
      return null
    }
    return Math.max(0, row.timestamp - parent.timestamp)
  })
}

/** The average block time over the rows, "3.8s"; null under two blocks. */
export function averageBlockTime(rows: readonly Timed[]): string | null {
  const timed = rows.filter(
    (row): row is { height: number; timestamp: number } =>
      row.timestamp !== null,
  )
  if (timed.length < 2) return null
  let newest = timed[0]
  let oldest = timed[0]
  for (const row of timed) {
    if (newest === undefined || row.height > newest.height) newest = row
    if (oldest === undefined || row.height < oldest.height) oldest = row
  }
  if (newest === undefined || oldest === undefined) return null
  const blocks = newest.height - oldest.height
  if (blocks <= 0) return null
  return secondsText(Math.max(0, newest.timestamp - oldest.timestamp), blocks)
}

export type BlockTimes = {
  /** "3.8s" over the blocks counted. */
  average: string
  slowest: { height: string; took: string }
  fastest: { height: string; took: string }
  /** Blocks with a known time. */
  counted: number
  /** Oldest first, for the chart: seconds, and whether over `slowAfter`. */
  bars: { height: number; seconds: number; slow: boolean }[]
  /** The largest bar, for the chart's scale. */
  most: number
}

/** A block over this many seconds is drawn as slow. */
export const slowAfter = 5

/** The block-time panel's figures; null without a block time. */
export function blockTimes(rows: readonly Timed[]): BlockTimes | null {
  const took = tookSeconds(rows)
  const known = rows
    .map((row, index) => ({ height: row.height, seconds: took[index] }))
    .filter(
      (entry): entry is { height: number; seconds: number } =>
        entry.seconds !== null && entry.seconds !== undefined,
    )
  const average = averageBlockTime(rows)
  if (known.length === 0 || average === null) return null
  let slowest = known[0]
  let fastest = known[0]
  for (const entry of known) {
    if (slowest === undefined || entry.seconds > slowest.seconds) {
      slowest = entry
    }
    if (fastest === undefined || entry.seconds < fastest.seconds) {
      fastest = entry
    }
  }
  if (slowest === undefined || fastest === undefined) return null
  const label = (entry: { height: number; seconds: number }) => ({
    height: groupThousands(BigInt(entry.height)),
    took: `${entry.seconds}s`,
  })
  return {
    average,
    slowest: label(slowest),
    fastest: label(fastest),
    counted: known.length,
    bars: [...known].reverse().map((entry) => ({
      height: entry.height,
      seconds: entry.seconds,
      slow: entry.seconds > slowAfter,
    })),
    most: Math.max(...known.map((entry) => entry.seconds), 1),
  }
}
