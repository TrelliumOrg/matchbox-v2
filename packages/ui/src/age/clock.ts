/**
 * One clock for every age on the page. Each age registers the timestamp it
 * shows; a single timer wakes at the soonest moment any of them changes
 * (every second while one is under a minute old, less often after), and
 * every age re-reads the time then. A page of 50 rows runs one timer, not
 * fifty.
 */

import { tickMs } from "./format"

type Listener = { timestamp: number; notify: () => void }

const listeners = new Set<Listener>()
let timer: ReturnType<typeof setTimeout> | null = null
let now = 0

/**
 * The clock's time in unix seconds, as of its last tick. Read once on first
 * use, then only changed by ticks, so React sees a stable snapshot.
 */
export function clockNow(): number {
  if (now === 0) now = Date.now() / 1000
  return now
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  if (listeners.size === 0) return
  let delay = Number.POSITIVE_INFINITY
  for (const listener of listeners) {
    delay = Math.min(delay, tickMs(now - listener.timestamp))
  }
  timer = setTimeout(tick, delay)
}

function tick(): void {
  now = Date.now() / 1000
  for (const listener of listeners) listener.notify()
  schedule()
}

/** Follows the clock for an age showing `timestamp`. */
export function subscribeClock(
  timestamp: number,
  notify: () => void,
): () => void {
  if (listeners.size === 0) now = Date.now() / 1000
  const listener = { timestamp, notify }
  listeners.add(listener)
  schedule()
  // The first reading may already be newer than the server's.
  notify()
  return () => {
    listeners.delete(listener)
    schedule()
  }
}

/** Test helper. */
export function resetClock(): void {
  listeners.clear()
  if (timer !== null) clearTimeout(timer)
  timer = null
  now = 0
}
