import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { Section } from "../../data/explorer"
import type {
  EpochNav,
  EpochVotes,
  ValidatorSort,
  ValidatorsPage,
  ValidatorTable,
} from "../../data/validators"
import { deferred } from "../../shell/deferred"
import { PageTitle } from "../../shell/page"
import { sectionStateText } from "../section-text"
import { CardFigure, NotYet, StatCard, searchFor } from "./parts"
import { reasons } from "./status"

/**
 * Validators (`9qiDCpYgJ3`): the PoA set and blocks proposed per validator
 * on the latest day with counts (`/validators`), their veBTC votes and
 * voters' incentives for an epoch, and veBTC voting by epoch. Not
 * available yet, and said so in place: emissions per validator and
 * unclaimed rewards (no route reports them per gauge), voter concentration
 * across validators (one read per gauge). Uptime over 24 hours and how
 * many validators signed the newest block come from CometBFT commit
 * signatures read from a community node (`/uptime`), shown only while
 * that data is live.
 */

const stepClass =
  "grid size-9 place-items-center rounded-full text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"

function EpochStep({
  epoch,
  to,
  sort,
  direction,
}: {
  epoch: EpochNav
  to: number | null
  sort: ValidatorSort
  direction: "prev" | "next"
}): ReactNode {
  const shape = direction === "prev" ? shapes.chevronLeft : shapes.chevronRight
  if (to === null) {
    return (
      <span className={`${stepClass} text-mut`} aria-hidden="true">
        <Glyph shape={shape} size={16} strokeWidth={2} />
      </span>
    )
  }
  return (
    <Link
      to="/validators"
      search={searchFor(epoch, to, sort)}
      aria-label={`Epoch ${to}`}
      className={stepClass}
    >
      <Glyph shape={shape} size={16} strokeWidth={2} />
    </Link>
  )
}

function EpochSwitcher({
  epoch,
  sort,
}: {
  epoch: EpochNav
  sort: ValidatorSort
}): ReactNode {
  return (
    <nav
      aria-label="Epoch"
      className="flex h-12 items-center gap-1 rounded-[24px] bg-soft px-1.5"
    >
      <EpochStep epoch={epoch} to={epoch.prev} sort={sort} direction="prev" />
      <span className="px-2 text-[15px] font-semibold whitespace-nowrap">
        Epoch {epoch.number}
      </span>
      <EpochStep epoch={epoch} to={epoch.next} sort={sort} direction="next" />
    </nav>
  )
}

/** Below the stat cards: its own chunk, off the first paint's budget. */
const ValidatorsSections = deferred(() =>
  import("./validators-sections").then((module) => module.ValidatorsSections),
)

export function ValidatorsView({ page }: { page: ValidatorsPage }): ReactNode {
  return (
    <>
      <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <PageTitle>Validators</PageTitle>
        <span className="flex-1" />
        <p className="text-[15px] text-sec max-md:hidden">
          {page.epoch.span.dates}
        </p>
        <EpochSwitcher epoch={page.epoch} sort={page.sort} />
      </header>
      <div className="mt-6 grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
        <SetCard table={page.table} />
        <EmissionsCard emissions={page.emissions} />
        <VotingCard votes={page.votes} />
        <StatCard icon={shapes.gift} label="Unclaimed by validators">
          <NotYet reason={reasons.unclaimed} />
        </StatCard>
        <IncentivesCard votes={page.votes} />
        <StatCard icon={shapes.vote} label="Voter concentration">
          <NotYet reason={reasons.concentration} />
        </StatCard>
      </div>
      <Suspense fallback={null}>
        <ValidatorsSections page={page} />
      </Suspense>
    </>
  )
}

function SetCard({ table }: { table: Section<ValidatorTable> }): ReactNode {
  if (table.status !== "ok") {
    return (
      <StatCard icon={shapes.shieldCheck} label="Validator set">
        <NotYet reason={sectionStateText[table.status]} />
      </StatCard>
    )
  }
  const { blocks, left } = table.data
  return (
    <StatCard icon={shapes.shieldCheck} label="Validator set">
      <CardFigure
        value={`${table.data.active} active`}
        note={
          blocks.available
            ? blocks.shareOf === "all_blocks"
              ? `${blocks.total} blocks on about ${blocks.day}`
              : `${blocks.total} blocks proposed on about ${blocks.day}`
            : "Blocks per day: not available yet"
        }
      />
      {table.data.signing === null ? null : (
        <p className="text-[14.5px] text-sec">{table.data.signing}</p>
      )}
      {left > 0 ? (
        <p className="text-[14.5px] text-sec">{left} left the set</p>
      ) : null}
    </StatCard>
  )
}

function VotingCard({
  votes,
}: {
  votes: Section<EpochVotes | "not-yet" | null>
}): ReactNode {
  return (
    <StatCard icon={shapes.lock} label="veBTC voting for validators">
      {votes.status !== "ok" ? (
        <NotYet reason={sectionStateText[votes.status]} />
      ) : votes.data === "not-yet" ? (
        <NotYet reason={reasons.votesFilling} />
      ) : votes.data === null ? (
        <CardFigure value="No votes" />
      ) : (
        <CardFigure
          value={votes.data.figure}
          note={
            <>
              {votes.data.gauges} {votes.data.gauges === 1 ? "gauge" : "gauges"}
              {votes.data.inactive > 0 ? (
                <span className="ml-2 font-semibold text-neg">
                  {votes.data.inactive} inactive
                </span>
              ) : null}
            </>
          }
        />
      )}
    </StatCard>
  )
}

/**
 * Under the incentives figure: the tokens behind the USD (or how many
 * more tokens, when it is a token amount), then the validators funded.
 */
function incentivesNote(data: EpochVotes, first: string): string {
  const more = data.incentives.length - 1
  const tokens =
    data.incentivesUsd === null
      ? more > 0
        ? `${more} more tokens, `
        : ""
      : `${first}${more > 0 ? `, ${more} more` : ""}, `
  const validators = data.incentivized === 1 ? "validator" : "validators"
  return `${tokens}${data.incentivized} ${validators}`
}

function IncentivesCard({
  votes,
}: {
  votes: Section<EpochVotes | "not-yet" | null>
}): ReactNode {
  const data = votes.status === "ok" ? votes.data : null
  const first = data === "not-yet" ? undefined : data?.incentives[0]
  return (
    <StatCard icon={shapes.gift} label="Incentives for voters">
      {votes.status !== "ok" ? (
        <NotYet reason={sectionStateText[votes.status]} />
      ) : data === "not-yet" ? (
        <NotYet reason={reasons.votesFilling} />
      ) : data === null || first === undefined ? (
        <CardFigure value="None" note="No incentives posted" />
      ) : (
        <CardFigure
          value={data.incentivesUsd ?? first}
          note={incentivesNote(data, first)}
        />
      )}
    </StatCard>
  )
}

/** MEZO the validators voter distributed in the epoch. */
function EmissionsCard({
  emissions,
}: {
  emissions: ValidatorsPage["emissions"]
}): ReactNode {
  const label = "Emissions to validators"
  return (
    <StatCard icon={shapes.coins} label={label}>
      {emissions.status !== "ok" ? (
        <NotYet reason={sectionStateText[emissions.status]} />
      ) : emissions.data === null ? (
        <CardFigure value="None" note="This epoch" />
      ) : (
        <CardFigure value={emissions.data.value} note={emissions.data.note} />
      )}
    </StatCard>
  )
}
