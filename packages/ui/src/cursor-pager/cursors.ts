/**
 * The keyset cursors an API page returns: opaque strings the next request
 * echoes back, null at either end. Never an offset or a page number.
 */
export type Cursors = { newer: string | null; older: string | null }

/**
 * The URL of the page at `cursor`: `path` with `?before=` (older) or
 * `?after=` (newer) set and the other cleared, other query values kept.
 * Null when there is no such page.
 */
export function cursorHref(
  path: string,
  direction: "newer" | "older",
  cursors: Cursors,
): string | null {
  const cursor = direction === "newer" ? cursors.newer : cursors.older
  if (cursor === null) return null
  const url = new URL(path, "https://x.invalid")
  url.searchParams.delete("before")
  url.searchParams.delete("after")
  url.searchParams.set(direction === "newer" ? "after" : "before", cursor)
  return `${url.pathname}${url.search}`
}
