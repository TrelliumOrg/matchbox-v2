import { shortHash } from "@matchbox/domain/format"
import * as Age from "@matchbox/ui/age"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { LoanEventView } from "../../data/scan/borrow-views"

/** Loan history: trove, Morpho and Enclave events, newest first. */

// -- loan history -------------------------------------------------------------

export function LoanHistory({
  events,
  more,
  skipped,
  now,
}: {
  events: readonly LoanEventView[]
  /** Older events exist past these: not the whole history. */
  more: boolean
  /** Rows the API left out (failed their schema). */
  skipped: number
  now: number
}): ReactNode {
  const notes = [
    more ? "Latest loan events, older not shown" : null,
    skipped > 0
      ? `${skipped === 1 ? "1 row" : `${skipped} rows`} not shown`
      : null,
  ].filter((note) => note !== null)
  if (events.length === 0 && notes.length === 0) {
    return <p className="py-10 text-center text-[15px] text-sec">No loans</p>
  }
  return (
    <>
      <LoanRows events={events} now={now} />
      {notes.length === 0 ? null : (
        <p className="mt-3 text-[14.5px] text-sec">{notes.join(", ")}</p>
      )}
    </>
  )
}

function LoanRows({
  events,
  now,
}: {
  events: readonly LoanEventView[]
  now: number
}): ReactNode {
  return (
    <ListRow.List aria-label="Loan history">
      {events.map((event) => (
        <ListRow.Root key={event.key}>
          <ListRow.Icon>
            <Glyph shape={shapes.creditCard} size={18} strokeWidth={1.8} />
          </ListRow.Icon>
          <ListRow.Text>
            <ListRow.Title>
              {event.action}, {event.loan}
            </ListRow.Title>
            <ListRow.Subline>{event.detail ?? "No amount"}</ListRow.Subline>
          </ListRow.Text>
          <ListRow.Value>
            <ListRow.Main>
              <Age.Root timestamp={event.timestamp} now={now} />
            </ListRow.Main>
            <Link
              to="/tx/$hash"
              params={{ hash: event.txHash }}
              className="mt-0.5 rounded-sm font-mono text-[14px] text-sec outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
            >
              {shortHash(event.txHash)}
            </Link>
          </ListRow.Value>
        </ListRow.Root>
      ))}
    </ListRow.List>
  )
}
