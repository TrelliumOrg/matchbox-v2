import type { ReactNode } from "react"
import { getPoolGauge, type VotesView } from "../../data/pools"
import {
  EpochBars,
  Figure,
  Panel,
  PanelState,
  reserveFor,
  Stats,
} from "../voting/parts"
import { useAfterPaint } from "./after-paint"

/**
 * A Mezo pool gauge's veBTC votes per epoch and voter APY, read once the
 * page has painted (`poolGauge`, one request for the panel and the fact).
 * The fact and the panel keep their place and size while they wait.
 */

const pending = new Map<string, Promise<{ votes: VotesView | null }>>()

function useGauge(gauge: string): VotesView | null | "waiting" | "failed" {
  const state = useAfterPaint(gauge, pending, () =>
    getPoolGauge({ data: { gauge } }),
  )
  return typeof state === "string" ? state : state.votes
}

/** The header's "veBTC votes" figure, with the voter APY under it. */
export function VotesFact({ gauge }: { gauge: string }): ReactNode {
  const votes = useGauge(gauge)
  const data = typeof votes === "object" ? votes : null
  return (
    <div className="min-w-0">
      <dt className="text-[14px] text-sec">veBTC votes</dt>
      <dd className="mt-1 min-h-[34px] text-[23px] font-[650] tracking-[-0.01em] tabular-nums">
        {data?.figure ?? ""}
      </dd>
      <dd className="min-h-[21px] text-[14px] text-sec">
        {data?.apy == null ? "" : `Voter APY ${data.apy}`}
      </dd>
    </div>
  )
}

/** Room for a stat while it loads: unique keys, nothing to read. */
const waitingStats = [1, 2, 3, 4].map((count) => ({
  label: "\u00a0".repeat(count),
  value: "\u00a0",
}))

/**
 * The panel's body while it waits, laid out as the loaded one (figure,
 * four stats, the bars and their caption) but drawn invisible, so the
 * panels below do not move when it fills in.
 */
function VotesWaiting(): ReactNode {
  return (
    <div aria-busy="true" aria-hidden="true" className="invisible">
      <Figure value={"\u00a0"} />
      <Stats stats={waitingStats} />
      <div className="mt-6 flex flex-col gap-2">
        <div className="h-[140px]" />
        <p className="font-mono text-xs">{"\u00a0"}</p>
      </div>
    </div>
  )
}

/** The gauge's veBTC votes per epoch. */
export function VotesPanel({ gauge }: { gauge: string }): ReactNode {
  const votes = useGauge(gauge)
  return (
    <Panel label="veBTC votes per epoch">
      {votes === "waiting" ? (
        <VotesWaiting />
      ) : votes === "failed" || votes === null ? (
        <PanelState section={{ status: "unavailable" }} />
      ) : (
        <>
          <Figure value={votes.figure} reserve={reserveFor(votes.bars)} />
          <Stats stats={votes.stats} />
          <EpochBars bars={votes.bars} label="veBTC votes per epoch" />
        </>
      )}
    </Panel>
  )
}
