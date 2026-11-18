import { type ReactNode, useCallback, useSyncExternalStore } from "react"
import { Tip } from "../floating/floating"
import { clockNow, subscribeClock } from "./clock"
import { formatAge, formatTimestamp } from "./format"

/**
 * Age and timestamp. `Root` is a `<time>` with the machine date and the age
 * ("12m", or "4s ago" with `suffix`); the full UTC timestamp shows in a tip
 * on hover, keyboard focus and tap (a title does nothing on touch). Inside
 * a link pass `tip={false}`: the link takes the tap, and the time keeps the
 * timestamp as its title. The server renders the age against `now` (the page's chain
 * time, so the HTML is stable for the cache) and the browser keeps it
 * current, ticking every second only while under a minute old.
 * `Timestamp` shows the full date with the age after it.
 *
 * Ages keep a minimum width (three characters, seven with " ago"), so an age
 * the browser corrects on edge-cached HTML ("4s" becoming "12m") does not
 * shift what follows it.
 */

/**
 * The time for an age: the server's `now` while rendering and hydrating (so
 * the HTML matches), then the shared clock.
 */
function useNow(timestamp: number, now: number): number {
  return useSyncExternalStore(
    useCallback((notify) => subscribeClock(timestamp, notify), [timestamp]),
    clockNow,
    () => now,
  )
}

export type RootProps = {
  /** Unix seconds. */
  timestamp: number
  /** Unix seconds the server rendered at. */
  now: number
  /** "4s ago" instead of "4s". */
  suffix?: boolean
  /** The full timestamp in a tip (default), or only as the title. */
  tip?: boolean
  className?: string
}

export function Root({
  timestamp,
  now,
  suffix = false,
  tip = true,
  className,
}: RootProps): ReactNode {
  const current = useNow(timestamp, now)
  const age = formatAge(current - timestamp)
  const full = formatTimestamp(timestamp)
  const classes = `inline-block tabular-nums whitespace-nowrap ${suffix ? "min-w-[7ch]" : "min-w-[3ch]"} ${className ?? ""}`
  const dateTime = new Date(timestamp * 1000).toISOString()
  const text = suffix ? `${age} ago` : age
  if (!tip) {
    return (
      <time dateTime={dateTime} title={full} className={classes}>
        {text}
      </time>
    )
  }
  return (
    <Tip
      content={full}
      trigger={(props) => (
        <time
          {...props}
          dateTime={dateTime}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the full time must be reachable by keyboard and tap
          tabIndex={0}
          className={`${classes} cursor-default rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`}
        >
          {text}
        </time>
      )}
    />
  )
}

/** "Sun 8 Nov 2026, 11:53:40 UTC  4s ago". */
export function Timestamp({
  timestamp,
  now,
  className,
}: Omit<RootProps, "suffix">): ReactNode {
  return (
    <span className={`inline-flex flex-wrap gap-x-2 ${className ?? ""}`}>
      <span className="tabular-nums">{formatTimestamp(timestamp)}</span>
      <Root timestamp={timestamp} now={now} suffix className="text-sec" />
    </span>
  )
}

Root.displayName = "Age.Root"
Timestamp.displayName = "Age.Timestamp"
