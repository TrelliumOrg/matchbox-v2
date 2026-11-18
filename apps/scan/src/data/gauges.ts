import { createServerFn } from "@tanstack/react-start"
import type { PeriodInput } from "../explorer/voting/range"
import {
  type GaugeSort,
  type GaugeType,
  gaugePage,
  gaugesPage,
} from "./gauges.server"

/**
 * The Gauges pages' server functions. Their work is in gauges.server; this
 * module stays light so the browser keeps only the RPC stubs.
 */

export type {
  DepositRow,
  DirectoryView,
  EmissionsView,
  EpochBar,
  GaugeBar,
  GaugeDetailPage,
  GaugeHeader,
  GaugeRow,
  GaugeSort,
  GaugesPage,
  GaugeType,
  IncentivesPanel,
  PoolPanels,
  Stat,
  VeBtcSplit,
  VoterRow,
  VotesPanel,
  WhoVotes,
} from "./gauges.server"

function identity<T>(input: T): T {
  return input
}

export const getGaugesPage = createServerFn({ method: "GET" })
  .validator(
    identity<{ type: GaugeType; sort: GaugeSort; after?: string | null }>,
  )
  .handler(({ data }) => gaugesPage(data))

export const getGaugePage = createServerFn({ method: "GET" })
  .validator(identity<{ gauge: string } & PeriodInput>)
  .handler(({ data }) => gaugePage(data))
