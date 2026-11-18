import { type ReactNode, useSyncExternalStore } from "react"
import { type DateZone, formatSeen, formatShortDate } from "./format"

const subscribe = () => () => undefined

/**
 * "UTC" on the server and while the page hydrates, then the browser's own
 * zone. A local date or time rendered during hydration would differ from
 * the server's UTC text for anyone outside UTC (React error 418 and a full
 * client re-render); this renders the server's text first and switches to
 * local time right after.
 */
export function useDateZone(): DateZone {
  return useSyncExternalStore(
    subscribe,
    () => undefined,
    () => "UTC" as const,
  )
}

/** `formatShortDate`, hydration-safe. */
export function ShortDate({ iso }: { iso: string }): ReactNode {
  const zone = useDateZone()
  return <time dateTime={iso}>{formatShortDate(iso, new Date(), zone)}</time>
}

/** `formatSeen`, hydration-safe. */
export function SeenAt({ iso }: { iso: string }): ReactNode {
  const zone = useDateZone()
  return <time dateTime={iso}>{formatSeen(iso, new Date(), zone)}</time>
}
