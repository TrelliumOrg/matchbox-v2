import type { ActivityFilter } from "../../data/view-models"

/** The Activity filter tabs, in order. Kept apart so route search validation stays light. */
export const activityFilters: readonly {
  value: ActivityFilter
  label: string
}[] = [
  { value: "all", label: "All" },
  { value: "votes", label: "Votes" },
  { value: "claims", label: "Claims" },
  { value: "locks", label: "Locks" },
  { value: "incentives", label: "Incentives" },
]
