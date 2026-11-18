/**
 * Runs `task` once the browser is idle after first paint, so enhancement
 * code (torph, the query cache) never competes with hydration. Returns a
 * cancel function. A no-op on the server.
 */
export function whenIdle(task: () => void, timeout = 2500): () => void {
  if (typeof window === "undefined") return () => {}
  if ("requestIdleCallback" in window) {
    const handle = window.requestIdleCallback(task, { timeout })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = setTimeout(task, 1200)
  return () => clearTimeout(handle)
}
