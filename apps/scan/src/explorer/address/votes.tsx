import { shortHash } from "@matchbox/domain/format"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { VotesByEpoch } from "../../data/address"
import { escrowName } from "./shared"

/** Votes by epoch for the address's locks. */

// -- votes ------------------------------------------------------------------

export function Votes({
  votes,
}: {
  votes: { epochs: VotesByEpoch; partial: boolean }
}): ReactNode {
  if (votes.epochs.length === 0) {
    return <p className="py-10 text-center text-[15px] text-sec">No votes</p>
  }
  return (
    <>
      {/* The page's h1 is the address; each epoch below is an h3. */}
      <h2 className="sr-only">Votes by epoch</h2>
      <ListRow.List aria-label="Votes by epoch">
        {votes.epochs.map(({ epoch, votes: list }) => (
          <li key={epoch} className="list-none">
            <ListRow.Heading>
              <Link
                to="/epochs/$epoch"
                params={{ epoch: String(epoch) }}
                className="rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
              >
                Epoch {epoch}
              </Link>
            </ListRow.Heading>
            <ul>
              {list.map((vote) => (
                <ListRow.Root key={`${vote.escrow}:${vote.id}:${vote.gauge}`}>
                  <ListRow.Icon>
                    <Glyph
                      shape={shapes.squareCheck}
                      size={18}
                      strokeWidth={1.8}
                    />
                  </ListRow.Icon>
                  <ListRow.Text>
                    <p className="truncate text-base font-semibold">
                      <Link
                        to="/gauges/$gauge"
                        params={{ gauge: vote.gauge }}
                        className="rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                      >
                        {vote.gaugeName === null ? (
                          <span className="font-mono">
                            {shortHash(vote.gauge)}
                          </span>
                        ) : (
                          <UntrustedText.Root
                            value={vote.gaugeName}
                            limit={40}
                          />
                        )}
                      </Link>
                    </p>
                    <p className="mt-0.5 text-[14.5px] text-sec">
                      {vote.escrow === null ? "Lock" : escrowName[vote.escrow]}{" "}
                      #{vote.id}
                      {vote.carried ? ", carried over" : ""}
                    </p>
                  </ListRow.Text>
                  <ListRow.Value>
                    <ListRow.Main>{vote.weight}</ListRow.Main>
                  </ListRow.Value>
                </ListRow.Root>
              ))}
            </ul>
          </li>
        ))}
        {votes.partial ? (
          <li className="mt-3 list-none text-[14.5px] text-sec">
            Some locks not shown
          </li>
        ) : null}
      </ListRow.List>
    </>
  )
}
