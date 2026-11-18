import { setResponseHeader } from "@tanstack/react-start/server"
import { type CacheClass, cacheClassHeader } from "./cache-policy"

/** Names the page's cache class (see cache-policy). Called by loaders. */
export function setCacheClass(cacheClass: CacheClass): void {
  try {
    setResponseHeader(cacheClassHeader, cacheClass)
  } catch {
    // Outside a request (tests): nothing to name.
  }
}

/**
 * Final once it is at least 30 blocks (about two minutes) old, the proxy's
 * finality depth. Older items get long caching, newer ones short.
 */
export function classForAge(
  timestamp: number | null,
  nowSeconds: number,
): CacheClass {
  if (timestamp === null) return "fresh"
  return nowSeconds - timestamp >= 120 ? "final" : "fresh"
}
