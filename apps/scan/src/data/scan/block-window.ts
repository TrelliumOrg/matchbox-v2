/**
 * The block-time panel's period (`YY3BAmH_lR`: the page's blocks, 24h,
 * 30d) as a search param. No imports: route search validation loads with
 * the router.
 */

export type BlockWindow = "blocks" | "24h" | "30d"

export const blockWindows: readonly BlockWindow[] = ["blocks", "24h", "30d"]

/** `window` from a search object; the page's blocks stay out of the URL. */
export function blockWindowOf(value: unknown): "24h" | "30d" | undefined {
  return value === "24h" || value === "30d" ? value : undefined
}
