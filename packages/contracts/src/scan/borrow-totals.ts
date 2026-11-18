import { z } from "zod"
import { addressSchema, decimalStringSchema } from "../common"
import { unixSecondsSchema } from "../read-models/primitives"
import { scanLiveSnapshotSchema, scanPartReasonSchema } from "./api"
import { scanDaySchema } from "./rows"

// /internal/scan/borrow/totals: MUSD owed across Mezo's borrow venues, for
// the homepage's "Borrowed" figure. One unit only: MUSD base units (18
// decimals, the token's own). A Morpho market that lends any other token
// (mUSDC today) is listed under `excluded` in its own token and never
// added: nothing here is priced, and no stablecoin is taken as $1.

/** The venues the total covers. */
export const scanBorrowVenueSchema = z.enum(["troves", "enclaves", "markets"])

export type ScanBorrowVenue = z.infer<typeof scanBorrowVenueSchema>

/**
 * Why a part is missing: a composed document's reasons, plus `incomplete`
 * when a bounded read did not reach the end of its rows (more Enclave
 * positions, open troves or Enclave events than one answer reads).
 */
export const scanBorrowTotalsReasonSchema = z.enum([
  ...scanPartReasonSchema.options,
  "incomplete",
])

export type ScanBorrowTotalsReason = z.infer<
  typeof scanBorrowTotalsReasonSchema
>

function totalsPart<Data extends z.ZodType>(data: Data) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), data }),
    z.object({
      status: z.literal("unavailable"),
      reason: scanBorrowTotalsReasonSchema,
    }),
  ])
}

/** Open troves (READ_DB live snapshot): principal plus accrued interest. */
export const scanBorrowTrovesTotalSchema = z.object({
  basis: z.literal("principal_plus_interest"),
  debt: decimalStringSchema,
  principal: decimalStringSchema,
  interest: decimalStringSchema,
  open: z.number().int().nonnegative(),
  /** Newest snapshot block among the open troves; null with none open. */
  block: z.number().int().nonnegative().nullable(),
})

/**
 * Open Enclave positions (EnclaveDebtManager, from `enclave_events`): the
 * principal after each position's latest event. Interest accrues on chain
 * with no event, so it is not included (`basis: "principal"`).
 */
export const scanBorrowEnclavesTotalSchema = z.object({
  basis: z.literal("principal"),
  debt: decimalStringSchema,
  open: z.number().int().nonnegative(),
  /** Positions ever opened, open or closed. */
  positions: z.number().int().nonnegative(),
  /** The newest event read; null with no position. */
  latest_block: z.number().int().nonnegative().nullable(),
  latest_timestamp: unixSecondsSchema.nullable(),
})

export const scanBorrowMarketTotalSchema = z.object({
  market_id: z.string().regex(/^0x[0-9a-f]{64}$/),
  loan_token: addressSchema,
  /** Total borrow assets, base units of the loan token. */
  borrowed: decimalStringSchema,
  /** Null when neither the chain nor the token registry knows them. */
  loan_decimals: z.number().int().min(0).max(36).nullable(),
})

/**
 * Morpho markets (READ_DB live snapshot): total borrow assets, with
 * interest accrued up to each market's last update. `included` lend MUSD;
 * `excluded` lend another token (`loan_token`) or MUSD with decimals that
 * did not resolve to MUSD's (`decimals`), and are not in `debt`.
 */
export const scanBorrowMarketsTotalSchema = z.object({
  basis: z.literal("total_borrow_assets"),
  debt: decimalStringSchema,
  included: z.array(scanBorrowMarketTotalSchema),
  excluded: z.array(
    scanBorrowMarketTotalSchema.extend({
      reason: z.enum(["loan_token", "decimals"]),
    }),
  ),
})

/**
 * One UTC day's close in MUSD base units. Troves and markets are the
 * `musd.trove_debt` and `morpho.total_borrow` daily closes; Enclaves are
 * the principal after the last event before the day ended. A venue with no
 * value that day is null and so is `total`: never a smaller number. Today's
 * point is the live total (`partial`).
 */
export const scanBorrowTotalsPointSchema = z.object({
  day: scanDaySchema,
  total: decimalStringSchema.nullable(),
  troves: decimalStringSchema.nullable(),
  enclaves: decimalStringSchema.nullable(),
  markets: decimalStringSchema.nullable(),
  partial: z.boolean(),
})

export const scanBorrowTotalsHistorySchema = z.object({
  from: scanDaySchema,
  to: scanDaySchema,
  /** Oldest first, one per day, the last one today. */
  points: z.array(scanBorrowTotalsPointSchema),
})

/**
 * BTC backing the loans Borrowed counts, in BTC base units (18 decimals):
 * open troves' collateral, the veBTC locked in the locks open Enclave
 * positions pledge, and the collateral of positions in the MUSD markets
 * (`venues.markets.included`) whose collateral is BTC. With those
 * markets' positions that owe anything (`open_markets`); the open troves
 * and Enclave positions are the venues' `open`.
 */
export const scanBorrowCollateralSchema = z.object({
  token: addressSchema,
  decimals: z.literal(18),
  total: decimalStringSchema,
  troves: decimalStringSchema,
  enclaves: decimalStringSchema,
  markets: decimalStringSchema,
  open_markets: z.number().int().nonnegative(),
})

export type ScanBorrowCollateral = z.infer<typeof scanBorrowCollateralSchema>

/** Days of history the answer carries (the homepage sparkline's). */
export const scanBorrowTotalsDays = 30

export const scanBorrowTotalsSchema = z.object({
  /** Every amount below except `excluded` markets is in this unit. */
  unit: z.object({
    symbol: z.literal("MUSD"),
    token: addressSchema,
    decimals: z.number().int().min(0).max(36),
  }),
  /**
   * Troves plus Enclaves plus MUSD markets, base units. Null when any venue
   * is unavailable (`missing` says which): never the sum of the others.
   */
  total: decimalStringSchema.nullable(),
  /** The venues `total` lacks; [] when it is given. */
  missing: z.array(scanBorrowVenueSchema),
  /** Enclaves' debt over `total`, 1e18 = 100%; null without a total. */
  enclaves_share: decimalStringSchema.nullable(),
  venues: z.object({
    troves: totalsPart(scanBorrowTrovesTotalSchema),
    enclaves: totalsPart(scanBorrowEnclavesTotalSchema),
    markets: totalsPart(scanBorrowMarketsTotalSchema),
  }),
  history: totalsPart(scanBorrowTotalsHistorySchema),
  /** Absent from an API older than 14 Nov 2026. */
  collateral: totalsPart(scanBorrowCollateralSchema).optional(),
})

export type ScanBorrowTotals = z.infer<typeof scanBorrowTotalsSchema>

/** The whole answer: the document plus the live snapshot's age. */
export const scanBorrowTotalsResponseSchema = z.object({
  data: scanBorrowTotalsSchema,
  snapshot: scanLiveSnapshotSchema,
})

export type ScanBorrowTotalsResponse = z.infer<
  typeof scanBorrowTotalsResponseSchema
>
