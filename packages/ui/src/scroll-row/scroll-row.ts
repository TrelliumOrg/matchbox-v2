import { type RefObject, useEffect } from "react"

/**
 * Behaviour for a `scroll-row` (styles.css): a row of tabs or filters that
 * scrolls sideways with its scrollbar hidden. On mount it brings the
 * current item (`aria-current` or `aria-pressed="true"`) into the
 * row's view, moving the row only, never the page. While the row
 * overflows it marks the sides with more to see (`data-more-start`,
 * `data-more-end`), which fade the row's edge as the cue a scrollbar
 * would have given.
 */
export function useScrollRow(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const row = ref.current
    if (row === null) return
    const current = row.querySelector<HTMLElement>(
      "[aria-current]:not([aria-current=false]), [aria-pressed=true]",
    )
    if (current !== null) reveal(row, current)
    const mark = (): void => {
      const end = row.scrollWidth - row.clientWidth
      row.toggleAttribute("data-more-start", row.scrollLeft > 1)
      row.toggleAttribute("data-more-end", row.scrollLeft < end - 1)
    }
    mark()
    row.addEventListener("scroll", mark, { passive: true })
    const resized =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark)
    resized?.observe(row)
    for (const child of row.children) resized?.observe(child)
    return () => {
      row.removeEventListener("scroll", mark)
      resized?.disconnect()
    }
  }, [ref])
}

/** The fade's width: an item scrolled into view clears it. */
const edge = 32

function reveal(row: HTMLElement, item: HTMLElement): void {
  const box = row.getBoundingClientRect()
  const target = item.getBoundingClientRect()
  if (target.left < box.left + edge) {
    row.scrollLeft += target.left - box.left - edge
  } else if (target.right > box.right - edge) {
    row.scrollLeft += target.right - box.right + edge
  }
}
