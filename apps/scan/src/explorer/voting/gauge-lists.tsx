import { shortAddress, shortHash } from "@matchbox/domain/format"
import * as Age from "@matchbox/ui/age"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { DepositRow, VoterRow } from "../../data/gauges"
import { SectionHeading, SectionState } from "../parts"

/**
 * A gauge's top voters and incentive deposits: lists below the fold, so
 * the gauge page loads their code after first paint (server rendered all
 * the same). A validator's page shows them too.
 */

const textLink =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

/** The gauge page's two lists, side by side. */
export function GaugeLists({
  epoch,
  voters,
  deposits,
  now,
}: {
  epoch: number
  voters: Section<VoterRow[]>
  deposits: Section<DepositRow[]>
  now: number
}): ReactNode {
  return (
    <div className="mt-12 grid grid-cols-2 gap-x-10 gap-y-12 max-lg:grid-cols-1">
      <section aria-labelledby="top-voters" className="min-w-0">
        <SectionHeading id="top-voters" aside={`Epoch ${epoch}`}>
          Top voters
        </SectionHeading>
        <Voters voters={voters} />
      </section>
      <section aria-labelledby="deposits" className="min-w-0">
        <SectionHeading id="deposits">Incentive deposits</SectionHeading>
        <Deposits deposits={deposits} now={now} />
      </section>
    </div>
  )
}

export function Voters({ voters }: { voters: Section<VoterRow[]> }): ReactNode {
  if (voters.status !== "ok") return <SectionState section={voters} />
  if (voters.data.length === 0) {
    return <p className="py-10 text-center text-[15px] text-sec">No voters</p>
  }
  return (
    <ListRow.List aria-label="Top voters">
      {voters.data.map((voter) => (
        <ListRow.Root key={`${voter.escrow}:${voter.id}`}>
          <ListRow.Icon>
            <Glyph shape={shapes.lock} size={18} strokeWidth={1.8} />
          </ListRow.Icon>
          <ListRow.Text>
            <ListRow.Title>
              {voter.escrow === null ? (
                `Lock #${voter.id}`
              ) : (
                <Link
                  to="/locks/$escrow/$id"
                  params={{ escrow: voter.escrow, id: voter.id }}
                  className={textLink}
                >
                  {voter.escrow === "vebtc" ? "veBTC" : "veMEZO"} #{voter.id}
                </Link>
              )}
            </ListRow.Title>
            <ListRow.Subline>
              {voter.carried ? "Carried over" : "Voted this epoch"}
            </ListRow.Subline>
          </ListRow.Text>
          <ListRow.Value>
            <span className="text-base font-semibold">{voter.weight}</span>
            {voter.share === null ? null : (
              <span className="mt-1 flex items-center gap-2 text-[14px] text-sec">
                <span
                  aria-hidden="true"
                  className="h-1 w-14 overflow-hidden rounded-full bg-soft2"
                >
                  <span
                    className="block h-full bg-mezo"
                    style={{ width: `${Math.min(100, voter.bps / 100)}%` }}
                  />
                </span>
                {voter.share}
              </span>
            )}
          </ListRow.Value>
        </ListRow.Root>
      ))}
    </ListRow.List>
  )
}

export function Deposits({
  deposits,
  now,
}: {
  deposits: Section<DepositRow[]>
  now: number
}): ReactNode {
  if (deposits.status !== "ok") return <SectionState section={deposits} />
  if (deposits.data.length === 0) {
    return <p className="py-10 text-center text-[15px] text-sec">No deposits</p>
  }
  return (
    <ListRow.List aria-label="Incentive deposits">
      {deposits.data.map((deposit) => (
        <ListRow.Root key={deposit.key}>
          <ListRow.Icon>
            <Glyph shape={shapes.gift} size={18} strokeWidth={1.8} />
          </ListRow.Icon>
          <ListRow.Text>
            <ListRow.Title>
              {deposit.kind} {deposit.amount}
            </ListRow.Title>
            <ListRow.Subline>
              <Link
                to="/epochs/$epoch"
                params={{ epoch: String(deposit.epoch) }}
                className={textLink}
              >
                Epoch {deposit.epoch}
              </Link>
              ,{" "}
              <Link
                to="/address/$address"
                params={{ address: deposit.depositor }}
                className={`font-mono ${textLink}`}
              >
                {shortAddress(deposit.depositor)}
              </Link>
              {deposit.usd === null ? null : (
                <>
                  , <Age.Root timestamp={deposit.timestamp} now={now} />
                </>
              )}
            </ListRow.Subline>
          </ListRow.Text>
          <ListRow.Value>
            <span className="text-base font-semibold">
              {deposit.usd ?? (
                <Age.Root timestamp={deposit.timestamp} now={now} />
              )}
            </span>
            <Link
              to="/tx/$hash"
              params={{ hash: deposit.txHash }}
              className={`mt-0.5 font-mono text-[14px] text-sec ${textLink}`}
            >
              {shortHash(deposit.txHash)}
            </Link>
          </ListRow.Value>
        </ListRow.Root>
      ))}
    </ListRow.List>
  )
}
