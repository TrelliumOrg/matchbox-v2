import { createServerFn } from "@tanstack/react-start"
import {
  type BorrowTabName,
  borrowCharts,
  borrowOverview,
  borrowTab,
  enclavePage,
  marketPage,
  morphoPositionPage,
  trovePage,
} from "./borrow.server"
import { borrowInput, chartsInput } from "./borrow-input"
import type { SeriesRange } from "./scan/series"

/** The Borrow pages' reads (work in borrow.server). */

export type {
  BorrowOverview,
  BorrowTabName,
  BorrowTabPage,
  ChartSeries,
  EnclavePage,
  EnclavesView,
  LiquidationView,
  MarketChart,
  MarketPage,
  MorphoPositionPage,
  StabilityPoolView,
  TrovePage,
  TrovesTab,
} from "./borrow.server"

// Each validator takes the typed input its callers send, and checks it
// at run time (borrow-input): a request can send anything.

export const getBorrowOverview = createServerFn({ method: "GET" })
  .validator((input: { range: SeriesRange }) => borrowInput.overview(input))
  .handler(({ data }) => borrowOverview(data))

export const getBorrowCharts = createServerFn({ method: "GET" })
  .validator((input: unknown) => chartsInput(input))
  .handler(({ data }) => borrowCharts(data))

export const getBorrowTab = createServerFn({ method: "GET" })
  .validator((input: { tab: BorrowTabName; cursor: string | null }) =>
    borrowInput.tab(input),
  )
  .handler(({ data }) => borrowTab(data))

export const getMarketPage = createServerFn({ method: "GET" })
  .validator(
    (input: { market: string; range: SeriesRange; cursor: string | null }) =>
      borrowInput.market(input),
  )
  .handler(({ data }) => marketPage(data))

export const getMorphoPositionPage = createServerFn({ method: "GET" })
  .validator((input: { market: string; account: string }) =>
    borrowInput.position(input),
  )
  .handler(({ data }) => morphoPositionPage(data))

export const getTrovePage = createServerFn({ method: "GET" })
  .validator((input: { owner: string }) => borrowInput.trove(input))
  .handler(({ data }) => trovePage(data))

export const getEnclavePage = createServerFn({ method: "GET" })
  .validator((input: { position: string }) => borrowInput.enclave(input))
  .handler(({ data }) => enclavePage(data))
