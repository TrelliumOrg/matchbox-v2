import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { DirectoryView, EmissionsView } from "../../data/gauges"
import { Filling } from "../filling"
import {
  EpochBars,
  Figure,
  GaugeBars,
  GaugeName,
  Panel,
  PanelEmpty,
  PanelState,
  reserveFor,
  rowsReserve,
  ShareBar,
  Stats,
} from "./parts"

/**
 * The Gauges page's overview panels after Paid to voters: where veBTC
 * votes go, the best APYs and MEZO emissions by epoch. Server rendered
 * with the page; their code loads after first paint.
 */
export function GaugesPanels({
  directory,
  emissions,
}: {
  directory: Section<DirectoryView>
  emissions: Section<EmissionsView | null>
}): ReactNode {
  return (
    <>
      <VeBtcPanel directory={directory} />
      <ApyPanel directory={directory} />
      <EmissionsPanel emissions={emissions} />
    </>
  )
}

function VeBtcPanel({
  directory,
}: {
  directory: Section<DirectoryView>
}): ReactNode {
  const aside =
    directory.status === "ok" ? (
      <span className="text-[14px] font-semibold">
        Epoch {directory.data.epoch.number}
      </span>
    ) : null
  return (
    <Panel label="Where veBTC votes go" aside={aside}>
      {directory.status !== "ok" ? (
        <PanelState section={directory} />
      ) : directory.data.split === null ? (
        <PanelEmpty>No veBTC votes</PanelEmpty>
      ) : (
        <>
          <Figure value={directory.data.split.figure} note="on validators" />
          <ShareBar
            label="veBTC votes"
            segments={directory.data.split.segments}
          />
          <p className="mt-2 flex justify-between text-[14px] text-sec">
            <span>
              {directory.data.split.counts.validators} validator gauges
            </span>
            <span>{directory.data.split.counts.pools} pool gauges</span>
          </p>
          <GaugeBars rows={directory.data.split.top} label="Most veBTC votes" />
        </>
      )}
    </Panel>
  )
}

function ApyPanel({
  directory,
}: {
  directory: Section<DirectoryView>
}): ReactNode {
  const best = directory.status === "ok" ? directory.data.bestApy : []
  const top = best[0]
  return (
    <Panel
      label="Best APY right now"
      aside={
        directory.status === "ok" ? (
          <span className="text-[14px] font-semibold">
            Epoch {directory.data.epoch.number}
          </span>
        ) : null
      }
    >
      {directory.status !== "ok" ? (
        <PanelState section={directory} />
      ) : top === undefined ? (
        <PanelEmpty>No incentives this epoch</PanelEmpty>
      ) : (
        <>
          <Figure
            value={top.value}
            note={<GaugeName gauge={top.gauge} />}
            reserve={rowsReserve(best)}
          />
          <GaugeBars rows={best} label="Best APY" figure />
        </>
      )}
    </Panel>
  )
}

function EmissionsPanel({
  emissions,
}: {
  emissions: Section<EmissionsView | null>
}): ReactNode {
  const data = emissions.status === "ok" ? emissions.data : null
  return (
    <Panel
      label="MEZO emissions by epoch"
      aside={
        data === null ? null : (
          <span className="text-[14px] font-semibold">
            Since Epoch {data.since}
          </span>
        )
      }
    >
      {emissions.status !== "ok" ? (
        <PanelState section={emissions} />
      ) : data === null ? (
        <PanelEmpty>No emissions yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.figure}
            note={data.note}
            reserve={reserveFor(data.bars)}
          />
          {data.filling === null ? null : (
            <Filling asOf={data.filling.asOf} className="mt-1" />
          )}
          <Stats stats={data.stats} />
          <EpochBars bars={data.bars} label="MEZO emissions by epoch" />
        </>
      )}
    </Panel>
  )
}
