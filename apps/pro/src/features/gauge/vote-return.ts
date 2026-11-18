import type { GaugeKind } from "../../data/view-models"
import { type VoteSearch, validateVoteSearch } from "../vote/vote-route"
import { kindOrder } from "./kinds"

/**
 * Where the gauge page's "Vote" link goes back to (see back-to-list):
 * the list a gauge was opened from and its place in this tab's history,
 * in sessionStorage. Apart from the link so Vote, which only records, does
 * not carry the link's code.
 */

const storageKey = "mbx-vote-return"

export type VoteReturn = {
  kind: GaugeKind
  /** Only what differs from the defaults (see `validateVoteSearch`). */
  search: VoteSearch
  /** The list's index in this tab's history (`__TSR_index`). */
  index: number
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function historyIndex(): number | null {
  if (typeof window === "undefined") return null
  const state: unknown = window.history.state
  if (typeof state !== "object" || state === null) return null
  const index: unknown = Reflect.get(state, "__TSR_index")
  return typeof index === "number" && Number.isInteger(index) ? index : null
}

/** Called as a gauge opens from Vote: where to come back to. */
export function rememberVoteList(kind: GaugeKind, search: VoteSearch): void {
  const index = historyIndex()
  if (index === null) return
  const entry: VoteReturn = { kind, search: validateVoteSearch(search), index }
  try {
    storage()?.setItem(storageKey, JSON.stringify(entry))
  } catch {
    // No return point: the link falls back to the gauge's type.
  }
}

export function readVoteReturn(): VoteReturn | null {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(storageKey) ?? null
  } catch {
    return null
  }
  if (raw === null) return null
  return parseVoteReturn(raw)
}

/** A stored return point, without trusting it. */
export function parseVoteReturn(raw: string): VoteReturn | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const kind = kindOrder.find((each) => each === Reflect.get(value, "kind"))
  const index: unknown = Reflect.get(value, "index")
  const search: unknown = Reflect.get(value, "search")
  if (kind === undefined || typeof index !== "number") return null
  if (!Number.isInteger(index)) return null
  if (typeof search !== "object" || search === null) return null
  return {
    kind,
    search: validateVoteSearch(
      Object.fromEntries(
        ["tab", "sort", "page", "q"].map((key) => [
          key,
          Reflect.get(search, key),
        ]),
      ),
    ),
    index,
  }
}

/** Whether the history entry right before this one is the recorded list. */
export function listIsPrevious(
  entry: VoteReturn | null,
  index: number | null,
): boolean {
  return entry !== null && index !== null && entry.index === index - 1
}
