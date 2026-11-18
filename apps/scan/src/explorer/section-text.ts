import type { Entity } from "../data/explorer"

/**
 * What a section says when its read failed (copy rules: labels). A module
 * of its own (parts re-exports it), so a page that only needs the words
 * loads none of parts' components.
 */
export const sectionStateText: Record<
  Exclude<Entity<unknown>, { status: "ok" }>["status"],
  string
> = {
  missing: "Not found",
  unavailable: "Data unavailable",
  "rate-limited": "Busy, try again",
  disabled: "Not available yet",
}
