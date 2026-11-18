/**
 * Route transitions never block input. Every view transition this document
 * starts is tracked so the next one, or the next navigation, skips it at
 * once; with `::view-transition { pointer-events: none }` in styles.css,
 * clicks reach the page while one runs.
 */

let active: ViewTransition | null = null
let installed = false

/** Ends the running transition, if any, showing the new state at once. */
export function skipViewTransition(): void {
  active?.skipTransition()
  active = null
}

export function trackViewTransitions(doc: Document = document): void {
  // Older browsers have no view transitions: nothing to track.
  if (installed || typeof doc.startViewTransition !== "function") return
  installed = true
  const start = doc.startViewTransition.bind(doc)
  doc.startViewTransition = (update) => {
    skipViewTransition()
    const transition = start(update)
    active = transition
    transition.finished
      .catch(() => undefined)
      .finally(() => {
        if (active === transition) active = null
      })
    return transition
  }
}

/** Test helper. */
export function resetViewTransitions(): void {
  active = null
  installed = false
}
