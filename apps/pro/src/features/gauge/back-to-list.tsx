import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link, useRouter } from "@tanstack/react-router"
import { type MouseEvent, type ReactNode, useEffect, useState } from "react"
import type { GaugeKind } from "../../data/view-models"
import { gaugeKinds } from "./kinds"
import {
  historyIndex,
  listIsPrevious,
  readVoteReturn,
  type VoteReturn,
} from "./vote-return"

/**
 * The gauge page's "Vote" link goes back to the list the reader came from,
 * as the browser's back button does: the same type, filter, sort, search,
 * page and scroll (the view is a setting, so it is already the same).
 *
 * Opening a gauge from Vote records where the list was and its place in
 * this tab's history (sessionStorage). When the entry just before the
 * gauge page is that list, the link steps back in history, so no new entry
 * is pushed and the router restores the scroll. Otherwise (the gauge page
 * was opened directly, or reached some other way) it is a plain link to
 * the last list this tab saw, or to the gauge's own type.
 */

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

export function BackToVote({ kind }: { kind: GaugeKind }): ReactNode {
  const router = useRouter()
  // Read after hydration: the server link is the gauge's own type.
  const [entry, setEntry] = useState<VoteReturn | null>(null)
  useEffect(() => setEntry(readVoteReturn()), [])
  const target = entry ?? { kind, search: {} }
  return (
    <Link
      to="/vote/$type"
      params={{ type: target.kind }}
      search={target.search}
      aria-label={`Vote, ${gaugeKinds[target.kind].label}`}
      onClick={(event) => {
        if (!plainClick(event)) return
        if (!listIsPrevious(readVoteReturn(), historyIndex())) return
        event.preventDefault()
        router.history.back()
      }}
      className="mt-5 inline-flex items-center gap-1.5 rounded-sm text-base font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ink"
    >
      <Glyph shape={shapes.chevronLeft} size={18} strokeWidth={2.2} />
      Vote
    </Link>
  )
}
