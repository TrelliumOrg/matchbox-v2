import { watchCountUps } from "./count-up"
import { watchLists } from "./flip-run"

/**
 * The page-wide motion that needs no first-paint code: lists marked
 * `data-flip-list` animate their layout, and `data-count-up` headlines
 * count up the first time they are seen. Call once when the page is idle,
 * from a module that already loads then (Pro: ThemeSync). Exported as
 * `@matchbox/motion/page` so it stays out of the entry chunk.
 */
export function startPageMotion(): void {
  watchLists()
  watchCountUps()
}
