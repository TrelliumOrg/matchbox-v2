import {
  gaugeDirectoryResponseSchema,
  gaugeProfileResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  scanActivityItemSchema,
  scanAddressDocumentSchema,
  scanAggregatePageSchema,
  scanBlockDocumentSchema,
  scanBorrowEventsSchema,
  scanBorrowPositionsSchema,
  scanBorrowTotalsResponseSchema,
  scanBridgeFlowsSchema,
  scanCrossChainPoolsSchema,
  scanCrossChainPricesSchema,
  scanCrossChainSupplySchema,
  scanDocumentSchema,
  scanEnclaveEventItemSchema,
  scanEnclaveLockSchema,
  scanEnclavePositionSummarySchema,
  scanEpochDetailSchema,
  scanEpochDocumentSchema,
  scanEpochItemSchema,
  scanGaugeEpochAggregateSchema,
  scanGaugeEpochItemSchema,
  scanGaugeRankingSchema,
  scanIncentiveItemSchema,
  scanLabelMapSchema,
  scanLiquidationItemSchema,
  scanLiveSnapshotSchema,
  scanLockDocumentSchema,
  scanLockItemSchema,
  scanLockVoteItemSchema,
  scanMarketsSchema,
  scanMezoIdLookupSchema,
  scanMezoIdNamesSchema,
  scanMorphoEventItemSchema,
  scanMorphoMarketSchema,
  scanMorphoPositionSchema,
  scanOwnerVotesPageSchema,
  scanPageSchema,
  scanPriceHistorySchema,
  scanPriceSeriesSchema,
  scanSearchResultSchema,
  scanSeriesSchema,
  scanSeriesSplitSchema,
  scanSkippedSchema,
  scanStabilityPoolSchema,
  scanStatusSchema,
  scanTokenListSchema,
  scanTransactionDocumentSchema,
  scanTroveEventItemSchema,
  scanTroveSchema,
  scanValidatorsSchema,
} from "@matchbox/contracts/scan"
import { z } from "zod"

/**
 * An epoch's {voter source: weight} maps (`vote_weight`, `killed_weight`):
 * the contract takes any string, and pages sum them with BigInt, so a
 * value that is not a base-10 integer fails the read here (its section
 * says so) instead of throwing while the page renders.
 */
const weightMapSchema = z.record(z.string(), z.string().regex(/^(0|[1-9]\d*)$/))
const epochItemSchema = scanEpochItemSchema.extend({
  vote_weight: weightMapSchema,
  killed_weight: weightMapSchema.default({}),
})

/**
 * Every live Borrow answer (READ_DB's snapshot: markets, positions,
 * troves, the Stability Pool, an owner's loans) says how far behind the
 * head that snapshot is; kept so a page can say its Borrow data is
 * delayed.
 */
const live = { snapshot: scanLiveSnapshotSchema.optional() }

/**
 * The response body of each /internal/scan route Scan reads, from the
 * route contracts in `@matchbox/contracts/scan` (and Pro's gauge documents
 * from `@matchbox/contracts/read-models`). Server-only: zod stays out of
 * the browser.
 */
export const scanSchemas = {
  txDocument: scanDocumentSchema(scanTransactionDocumentSchema),
  addressDocument: scanDocumentSchema(scanAddressDocumentSchema),
  blockDocument: scanDocumentSchema(scanBlockDocumentSchema),
  activityPage: scanPageSchema(scanActivityItemSchema),
  lockPage: scanPageSchema(scanLockItemSchema),
  lock: scanLockDocumentSchema,
  votePage: scanPageSchema(scanLockVoteItemSchema),
  ownerVotePage: scanOwnerVotesPageSchema,
  incentivePage: scanPageSchema(scanIncentiveItemSchema),
  gaugeHistory: scanAggregatePageSchema(scanGaugeEpochAggregateSchema),
  epochPage: scanAggregatePageSchema(epochItemSchema),
  epoch: scanEpochDocumentSchema.extend({
    data: scanEpochDetailSchema.extend({ epoch: epochItemSchema }).nullable(),
  }),
  epochGauges: scanAggregatePageSchema(scanGaugeEpochItemSchema),
  /** The same route with its killed gauges (validators pages). */
  gaugeRanking: scanGaugeRankingSchema,
  /** Blocks proposed per validator on the latest day with counts. */
  validators: scanValidatorsSchema,
  gauges: gaugeDirectoryResponseSchema,
  gaugeProfile: gaugeProfileResponseSchema,
  search: scanDocumentSchema(scanSearchResultSchema),
  mezoId: scanDocumentSchema(scanMezoIdLookupSchema),
  mezoIdNames: scanDocumentSchema(scanMezoIdNamesSchema),
  labels: scanDocumentSchema(scanLabelMapSchema),
  series: scanDocumentSchema(scanSeriesSchema),
  seriesSplit: scanDocumentSchema(scanSeriesSplitSchema),
  dexMarkets: scanDocumentSchema(scanMarketsSchema),
  prices: scanDocumentSchema(scanPriceSeriesSchema),
  // The list says how many stored market rows failed their schema.
  markets: scanDocumentSchema(z.array(scanMorphoMarketSchema)).extend({
    ...live,
    meta: z.object({ skipped: scanSkippedSchema }).optional(),
  }),
  market: scanDocumentSchema(scanMorphoMarketSchema).extend(live),
  positionPage: scanPageSchema(scanMorphoPositionSchema).extend(live),
  morphoEventPage: scanPageSchema(scanMorphoEventItemSchema),
  borrowOwner: scanDocumentSchema(scanBorrowPositionsSchema).extend(live),
  enclaveEventPage: scanPageSchema(scanEnclaveEventItemSchema),
  /** Enclave positions summed from their events, in position id order. */
  enclavePositionPage: scanPageSchema(scanEnclavePositionSummarySchema),
  /** The Enclave positions a veBTC was pledged to. */
  enclaveLock: scanDocumentSchema(scanEnclaveLockSchema),
  /** MUSD owed across troves, Enclaves and MUSD markets (live). */
  borrowTotals: scanBorrowTotalsResponseSchema,
  trovePage: scanPageSchema(scanTroveSchema).extend(live),
  trove: scanDocumentSchema(scanTroveSchema).extend(live),
  troveEventPage: scanPageSchema(scanTroveEventItemSchema),
  /** `/borrow/liquidations`: trove and Morpho liquidations (`kind`). */
  liquidationPage: scanPageSchema(scanLiquidationItemSchema),
  /** `/borrow/events`: every venue's latest events (`kind`). */
  borrowEvents: scanBorrowEventsSchema,
  stabilityPool: scanDocumentSchema(scanStabilityPoolSchema).extend(live),
  tokenList: scanTokenListSchema,
  /** MUSD's on-chain price per venue and MEZO's CoinGecko price. */
  crossChainPrices: scanCrossChainPricesSchema,
  /** MUSD's daily closes, headline and per venue. */
  crossChainPriceHistory: scanPriceHistorySchema,
  /** MUSD and MEZO supply on each chain, with the bridge's lock. */
  crossChainSupply: scanCrossChainSupplySchema,
  /** Every tracked MUSD and MEZO pool on Mezo, Ethereum and Base. */
  crossChainPools: scanCrossChainPoolsSchema,
  /** Wormhole transfers per route (MUSD only). */
  bridgeFlows: scanBridgeFlowsSchema,
  status: scanDocumentSchema(scanStatusSchema),
} as const

export type ScanSchemaName = keyof typeof scanSchemas
