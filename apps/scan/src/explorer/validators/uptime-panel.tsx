import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type {
  StripBlock,
  UptimeFreshness,
  ValidatorUptimeView,
} from "../../data/uptime"
import { Figure, Panel, PanelEmpty, PanelState, Stats } from "../voting/parts"

/**
 * A validator's Uptime panel (`MecoxYurzZ`): signing over 24 hours, 7 days
 * and 30 days, blocks and proposals missed, its share of proposals against
 * the 1/N it would expect, and the newest 100 blocks as a strip. Counted
 * from CometBFT commit signatures read from a community node; the panel
 * says which and how fresh, and when uptime is paused the figures carry
 * the time they run to instead of passing as current.
 */

const stripColour: Record<StripBlock["state"], string> = {
  signed: "bg-ink/70",
  missed: "bg-neg",
  out: "bg-line",
}

function Strip({ strip }: { strip: readonly StripBlock[] }): ReactNode {
  return (
    <ol
      aria-label="Newest blocks, oldest first"
      className="mt-5 flex h-9 items-end gap-[2px]"
    >
      {strip.map((block) => (
        <li
          key={block.height}
          title={block.title}
          className="flex h-full min-w-0 flex-1 flex-col justify-end gap-[2px]"
        >
          <span
            aria-hidden="true"
            className={`block h-[3px] rounded-full ${block.proposed ? "bg-acc" : block.missedProposal ? "bg-neg" : "bg-transparent"}`}
          />
          <span
            className={`block flex-1 rounded-[2px] ${stripColour[block.state]}`}
          />
          <span className="sr-only">{block.title}</span>
        </li>
      ))}
    </ol>
  )
}

function Legend({ summary }: { summary: string | null }): ReactNode {
  const key = (className: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`size-2.5 rounded-[3px] ${className}`}
      />
      {label}
    </span>
  )
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-sec">
      {key("bg-ink/70", "Signed")}
      {key("bg-neg", "Missed")}
      {key("bg-acc", "Proposed")}
      {summary === null ? null : <span className="ml-auto">{summary}</span>}
    </p>
  )
}

export function FreshnessLine({
  freshness,
}: {
  freshness: UptimeFreshness
}): ReactNode {
  return freshness.live ? (
    <p className="text-[14px] text-sec">{freshness.line}</p>
  ) : (
    <p role="status" className="text-[14px] font-semibold text-ink2">
      {freshness.line}
    </p>
  )
}

export function UptimePanel({
  uptime,
}: {
  uptime: Section<ValidatorUptimeView>
}): ReactNode {
  if (uptime.status !== "ok") {
    return (
      <Panel label="Uptime">
        <PanelState section={uptime} />
      </Panel>
    )
  }
  const view = uptime.data
  const windows = view.windows
  if (windows === null) {
    return (
      <Panel
        label="Uptime"
        aside={<FreshnessLine freshness={view.freshness} />}
      >
        <PanelEmpty>
          {view.freshness.asOf === null
            ? "Nothing counted yet"
            : "Not in the validator set in the blocks counted"}
        </PanelEmpty>
      </Panel>
    )
  }
  const { d1, d7, d30 } = windows
  const asOf = view.freshness.live ? null : view.freshness.asOf
  return (
    <Panel label="Uptime" aside={<FreshnessLine freshness={view.freshness} />}>
      <Figure
        value={d1.uptime ?? "None"}
        note={`${d1.missed} ${d1.missedCount === 1 ? "block" : "blocks"} missed in 24 hours`}
      />
      <Stats
        stats={[
          {
            label: "7 days",
            value: d7.uptime ?? "None",
            ...(d7.bps !== null && d7.bps < 9_900
              ? { tone: "neg" as const }
              : {}),
          },
          {
            label: "30 days",
            value: d30.uptime ?? "None",
            ...(d30.bps !== null && d30.bps < 9_900
              ? { tone: "neg" as const }
              : {}),
          },
          { label: "Proposed 24h", value: d1.proposed },
          {
            label: "Missed proposals 24h",
            value: d1.proposalsMissed,
            ...(d1.proposalsMissed !== "0" ? { tone: "neg" as const } : {}),
          },
        ]}
      />
      {view.strip.length === 0 ? null : (
        <>
          <Strip strip={view.strip} />
          <Legend summary={view.stripSummary} />
        </>
      )}
      <p className="mt-3 text-[14px] text-sec">
        {d1.share === null || d1.expected === null
          ? null
          : `Proposed ${d1.share} of blocks in 24 hours, ${d1.expected} expected. `}
        {view.lastSigned === null ? null : `${view.lastSigned}. `}
        {d30.since === null ? null : `Counted since ${d30.since}. `}
        {asOf === null ? null : `Figures run to ${asOf}.`}
      </p>
    </Panel>
  )
}
