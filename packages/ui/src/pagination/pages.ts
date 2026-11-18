/**
 * Page arithmetic for numbered pagers. Pages count from 1. Pure, so apps
 * can use it on the server to clamp a page from the URL.
 */

/** Pages needed for `total` items, never fewer than one. */
export function pageCount(total: number, size: number): number {
  if (!Number.isFinite(total) || total <= 0 || size <= 0) return 1
  return Math.ceil(total / size)
}

/** A page from the URL, kept between 1 and the last page. */
export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(Math.floor(page), Math.max(1, count))
}

/** The 1-based first and last item on a page; both 0 when empty. */
export function pageRange(
  page: number,
  size: number,
  total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 }
  const current = clampPage(page, pageCount(total, size))
  const from = (current - 1) * size + 1
  return { from, to: Math.min(total, current * size) }
}

const grouped = new Intl.NumberFormat("en-US")

/** "1 to 24 of 131". */
export function rangeText(page: number, size: number, total: number): string {
  const { from, to } = pageRange(page, size, total)
  return `${grouped.format(from)} to ${grouped.format(to)} of ${grouped.format(Math.max(0, total))}`
}

export type PageItem = number | "gap"

function run(start: number, length: number): number[] {
  return Array.from({ length }, (_, index) => start + index)
}

/**
 * The page numbers to show: the first, the last, the current page and
 * `siblings` either side, with a gap where pages are left out. A gap never
 * stands for a single page (that page is shown instead), and the row keeps
 * one length as the current page moves.
 */
export function pageItems(
  current: number,
  count: number,
  siblings = 1,
): PageItem[] {
  const last = Math.max(1, count)
  const page = clampPage(current, last)
  const slots = siblings * 2 + 5
  if (last <= slots) return run(1, last)
  const edge = siblings * 2 + 3
  if (page <= edge - siblings) return [...run(1, edge), "gap", last]
  if (page >= last - edge + 1 + siblings) {
    return [1, "gap", ...run(last - edge + 1, edge)]
  }
  return [1, "gap", ...run(page - siblings, siblings * 2 + 1), "gap", last]
}
