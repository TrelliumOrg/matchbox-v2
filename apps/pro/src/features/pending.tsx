import { demoNow } from "@matchbox/contracts/read-models/fixtures"
import type { ReactNode } from "react"
import { Loading } from "../components/loading"
import { ActivityView } from "./activity/activity-view"
import { GaugeView } from "./gauge/gauge-view"
import { OverviewView } from "./overview/overview-view"
import { ProtocolView } from "./protocol/protocol-view"
import { RewardsView } from "./rewards/rewards-view"
import {
  activitySample,
  gaugeSample,
  gaugesSample,
  overviewSample,
  protocolSample,
  rewardsSample,
  voterSample,
} from "./samples"
import { VoteView } from "./vote/vote-view"

/**
 * Pending screens for client navigations, drawn by Skullet from sample data
 * so each skeleton takes the final shape. Loaded only when a route is slow,
 * never on first paint.
 */

export type PendingRoute =
  | "overview"
  | "vote"
  | "rewards"
  | "activity"
  | "protocol"
  | "gauge"

function noop(): void {}

function sample(route: PendingRoute): ReactNode {
  switch (route) {
    case "overview":
      return <OverviewView data={overviewSample} />
    case "vote":
      return (
        <VoteView
          list={gaugesSample}
          voter={voterSample}
          epoch={47}
          kind="vebtc"
          tab="all"
          sort="incentives"
          page={1}
          query=""
          arrivalPick={null}
          onArrivalPickDone={noop}
          onTab={noop}
          onSort={noop}
          onQuery={noop}
          onPageFix={noop}
        />
      )
    case "rewards":
      return <RewardsView data={rewardsSample} />
    case "activity":
      return (
        <ActivityView
          data={activitySample}
          filter="all"
          today={demoNow}
          onFilter={noop}
        />
      )
    case "protocol":
      return <ProtocolView data={protocolSample} now={demoNow} onEpoch={noop} />
    case "gauge":
      return <GaugeView data={gaugeSample} epoch={47} />
  }
}

export default function Pending({ route }: { route: PendingRoute }): ReactNode {
  return (
    <Loading id={`pending-${route}`} label="Loading" sample={sample(route)} />
  )
}
