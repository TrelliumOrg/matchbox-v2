/**
 * Protocol's epoch pages (decided 9 Nov): 12 epochs at a time (6 on phones),
 * pages counted back from the latest epoch so the default page ends on it.
 * The earliest page is a full page that overlaps the next one. Positions
 * are indexes into the epoch series, oldest first.
 */

export type EpochWindow = { start: number; end: number }

/** The page that holds `selected` (an index; out of range picks the latest). */
export function windowFor(
  selected: number,
  count: number,
  size: number,
): EpochWindow {
  const last = count - 1
  if (count <= 0) return { start: 0, end: -1 }
  const at = selected < 0 || selected > last ? last : selected
  const end = last - size * Math.floor((last - at) / size)
  return clamp(end, count, size)
}

/** The page `pages` pages later (positive) or earlier (negative). */
export function shiftWindow(
  current: EpochWindow,
  pages: number,
  count: number,
  size: number,
): EpochWindow {
  return clamp(current.end + pages * size, count, size)
}

function clamp(end: number, count: number, size: number): EpochWindow {
  const last = count - 1
  const fullEnd = Math.min(last, size - 1)
  const at = Math.min(last, Math.max(fullEnd, end))
  return { start: Math.max(0, at - size + 1), end: at }
}

export function canShift(
  current: EpochWindow,
  pages: number,
  count: number,
): boolean {
  return pages < 0 ? current.start > 0 : current.end < count - 1
}

/** "Epoch 36 to 47". */
export function windowLabel(
  epochs: readonly number[],
  current: EpochWindow,
): string {
  const first = epochs[current.start]
  const last = epochs[current.end]
  if (first === undefined || last === undefined) return ""
  return first === last ? `Epoch ${first}` : `Epoch ${first} to ${last}`
}

/** Phones show 6 epochs a page, everything wider 12. */
export const windowSizes = { wide: 12, phone: 6 } as const
