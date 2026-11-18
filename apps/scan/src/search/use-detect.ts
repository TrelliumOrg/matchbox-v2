import type { HeadStore } from "@matchbox/live/heads"
import { useMemo } from "react"
import { detect, type SearchTarget } from "./detect"

/**
 * The palette's results. Read once per query: a new head does not change
 * what was typed, so head ticks never re-run detection (the head only
 * bounds block heights, read at the moment the query changes).
 */
export function useDetect(
  query: string,
  store: Pick<HeadStore, "get">,
  epoch: number,
): SearchTarget[] {
  return useMemo(
    () => detect(query, { head: store.get().number, epoch }),
    [query, store, epoch],
  )
}
