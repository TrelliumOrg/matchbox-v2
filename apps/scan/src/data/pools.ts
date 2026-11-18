import { createServerFn } from "@tanstack/react-start"
import {
  poolGauge,
  poolPage,
  poolPageCharts,
  poolsPage,
} from "./crosschain.server"
import type { PoolChain, PoolFilters } from "./scan/crosschain-views"

/**
 * The Pools pages' server functions. Their work is in crosschain.server;
 * this module stays light so the browser keeps only the RPC stubs.
 */

export type {
  MezoPoolFigures,
  PoolCharts,
  PoolDetail,
  PoolPage,
  PoolsPage,
} from "./crosschain.server"
export type {
  AssetFilter,
  ChainFilter,
  PoolChain,
  PoolFilters,
  PoolLink,
  PoolRow,
  PoolsView,
  PoolTableRow,
  Rate,
  TradeRow,
} from "./scan/crosschain-views"
export type { ChartFigures, VotesView } from "./scan/pool-views"
export type { SeriesPanelData } from "./scan/series-views"

function identity<T>(input: T): T {
  return input
}

export const getPoolsPage = createServerFn({ method: "GET" })
  .validator(identity<PoolFilters>)
  .handler(({ data }) => poolsPage(data))

export const getPoolPage = createServerFn({ method: "GET" })
  .validator(identity<{ chain: PoolChain; pool: string }>)
  .handler(({ data }) => poolPage(data))

export const getPoolGauge = createServerFn({ method: "GET" })
  .validator(identity<{ gauge: string }>)
  .handler(({ data }) => poolGauge(data))

export const getPoolCharts = createServerFn({ method: "GET" })
  .validator(identity<{ pool: string }>)
  .handler(({ data }) => poolPageCharts(data))
