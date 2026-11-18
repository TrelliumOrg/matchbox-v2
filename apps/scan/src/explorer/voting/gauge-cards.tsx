import { type ReactNode, Suspense } from "react"
import type { Section } from "../../data/explorer"
import type { IncentivesPanel, VotesPanel, WhoVotes } from "../../data/gauges"
import { deferred } from "../../shell/deferred"
import { Filling } from "../filling"
import {
  EpochBars,
  epochNote,
  Figure,
  Panel,
  PanelEmpty,
  PanelState,
  reserveFor,
  ShareBar,
  Stats,
  stackedReserve,
} from "./parts"

/** Stacked incentive bars: their code off the first paint's budget. */
const StackedEpochBars = deferred(() =>
  import("./paid-panel").then((module) => module.StackedEpochBars),
)
/**
 * A gauge's own figures as cards: votes and incentives per epoch and who
 * votes (its lists are in gauge-lists). The gauge page and a validator's
 * page show them; a module of their own, so a page that shows them loads
 * none of the other's code.
 */

export function VotesCard({
  votes,
  unit,
}: {
  votes: Section<VotesPanel | null>
  unit: string | null
}): ReactNode {
  return (
    <Panel
      label={unit === null ? "Votes per epoch" : `${unit} votes per epoch`}
    >
      {votes.status !== "ok" ? (
        <PanelState section={votes} />
      ) : votes.data === null ? (
        <PanelEmpty>No votes yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={votes.data.figure}
            note={epochNote(votes.data.bars)}
            reserve={reserveFor(votes.data.bars)}
          />
          {votes.data.filling === null ? null : (
            <Filling asOf={votes.data.filling.asOf} className="mt-1" />
          )}
          <Stats stats={votes.data.stats} />
          <EpochBars bars={votes.data.bars} label="Votes per epoch" />
        </>
      )}
    </Panel>
  )
}

export function IncentivesCard({
  incentives,
}: {
  incentives: Section<IncentivesPanel | null>
}): ReactNode {
  return (
    <Panel
      label="Incentives per epoch"
      aside={
        <span className="text-[14px] text-sec">Past epochs at their close</span>
      }
    >
      {incentives.status !== "ok" ? (
        <PanelState section={incentives} />
      ) : incentives.data === null ? (
        <PanelEmpty>No incentives yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={incentives.data.figure}
            note="this epoch"
            reserve={stackedReserve(incentives.data.bars)}
          />
          <Stats stats={incentives.data.stats} />
          <Suspense fallback={null}>
            <StackedEpochBars
              bars={incentives.data.bars}
              series={incentives.data.series}
              label="Incentives per epoch"
            />
          </Suspense>
        </>
      )}
    </Panel>
  )
}

export function WhoCard({
  who,
  epoch,
}: {
  who: Section<WhoVotes | null>
  epoch: number
}): ReactNode {
  return (
    <Panel
      label="Who votes"
      aside={<span className="text-[14px] font-semibold">Epoch {epoch}</span>}
    >
      {who.status !== "ok" ? (
        <PanelState section={who} />
      ) : who.data === null ? (
        <PanelEmpty>No votes this epoch</PanelEmpty>
      ) : (
        <>
          <Figure value={who.data.figure} note={`Top ${who.data.top}`} />
          <ShareBar label="Votes this epoch" segments={who.data.segments} />
          <Stats stats={who.data.stats} />
        </>
      )}
    </Panel>
  )
}
