/**
 * The pure parts of chart inspection, kept apart from the DOM so they can
 * be tested on their own: which point is nearest the pointer, where an
 * arrow key goes, and the change from the point before.
 */

/** The index of the centre nearest `x`; -1 for none. Ties go left. */
export function nearest(centres: readonly number[], x: number): number {
  let best = -1
  let distance = Number.POSITIVE_INFINITY
  centres.forEach((centre, index) => {
    const away = Math.abs(centre - x)
    if (away < distance) {
      best = index
      distance = away
    }
  })
  return best
}

/** Where a key moves the active point among `count`; null for other keys. */
export function step(index: number, key: string, count: number): number | null {
  if (count === 0) return null
  const last = count - 1
  const from = Math.min(Math.max(index, 0), last)
  switch (key) {
    // Up and Down for a list of rows, top first.
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(0, from - 1)
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(last, from + 1)
    case "Home":
      return 0
    case "End":
      return last
    default:
      return null
  }
}

export type Change = { text: string; tone: "pos" | "neg" | "flat" }

/**
 * The change from `before` to `now` in percent, one decimal: "+1.2%",
 * "-0.2%". Null without a point before or from zero, where a percent
 * means nothing. Display numbers only: never used for money arithmetic.
 */
export function change(before: number | null, now: number): Change | null {
  if (before === null || !Number.isFinite(before) || !Number.isFinite(now)) {
    return null
  }
  if (before === 0) return null
  const percent = Math.round(((now - before) / Math.abs(before)) * 1000) / 10
  if (percent === 0) return { text: "0.0%", tone: "flat" }
  const text = `${percent > 0 ? "+" : "-"}${Math.abs(percent).toFixed(1)}%`
  return { text, tone: percent > 0 ? "pos" : "neg" }
}

/** What a screen reader hears for a point: "Epoch 31, 4,703,651 MEZO, +1.2%". */
export function describe(
  label: string,
  value: string,
  delta: Change | null,
): string {
  return [label, value, delta?.text]
    .filter((part) => part !== undefined && part !== "")
    .join(", ")
}

/** The longest of the texts, to reserve a figure's width while inspecting. */
export function widest(texts: readonly string[]): string {
  let longest = ""
  for (const text of texts) if (text.length > longest.length) longest = text
  return longest
}
