import { z } from "zod"
import { addressSchema } from "../common"
import { unixSecondsSchema } from "../read-models/primitives"

// MUSD and MEZO across Mezo, Ethereum, Base (and MEZO on BNB Chain):
// market prices per venue, supply by chain, pools, and Wormhole NTT bridge
// flows. The D1 rows the jobs Worker writes (scan-migrations 0006) and the
// `/internal/scan/crosschain/*` answers. USD figures are decimal strings,
// token amounts base-unit integer strings with their decimals. A figure
// nobody can give is null, and the row's `unavailable` says why: never 0.

const usdSchema = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
/** Percent a year, decimal string; may be negative (a falling share price). */
const percentSchema = z.string().regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/)
const rawAmountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/)
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const crossChainSchema = z.enum(["mezo", "ethereum", "base", "bsc"])
export type ScanCrossChain = z.infer<typeof crossChainSchema>

export const bridgedAssetSchema = z.enum(["musd", "mezo"])
export type ScanBridgedAsset = z.infer<typeof bridgedAssetSchema>

/** Field name → why that field is null. */
export const unavailableSchema = z.record(z.string(), z.string().min(1))

// ---------------------------------------------------------------------------
// Rows (SCAN_DB, written by apps/jobs/src/crosschain)

/** `market_quotes`: the latest reading per asset and venue. */
export const marketQuoteRowSchema = z.object({
  asset: bridgedAssetSchema,
  /** A venue id ("curve-musd-2pool"), or "headline". */
  venue: z.string().min(1),
  chain: crossChainSchema.nullable(),
  price: usdSchema,
  depth_usd: usdSchema.nullable(),
  /** How the price was read ("twap-1800", "get_dy-virtual-price", ...). */
  method: z.string().min(1),
  /** For "headline": "venues", "coingecko" or a single venue id. */
  source: z.string().min(1),
  block: z.string().nullable(),
  read_at: z.number().int(),
  /** JSON: the headline's spread and venues used; null for a venue. */
  detail: z.string().nullable(),
})
export type MarketQuoteRow = z.infer<typeof marketQuoteRowSchema>

/** `market_price_daily`: the last reading of each UTC day, per venue. */
export const marketPriceDailyRowSchema = z.object({
  asset: bridgedAssetSchema,
  venue: z.string().min(1),
  day: daySchema,
  price: usdSchema,
  depth_usd: usdSchema.nullable(),
  source: z.string().min(1),
  updated_at: z.number().int(),
})

/** `token_supply_daily`: per chain, rewritten each hour, final at day end. */
export const tokenSupplyDailyRowSchema = z.object({
  asset: bridgedAssetSchema,
  chain: crossChainSchema,
  day: daySchema,
  total_supply: rawAmountSchema,
  /** The NTT manager's balance on the locking (hub) chain; null elsewhere. */
  locked: rawAmountSchema.nullable(),
  circulating: rawAmountSchema,
  decimals: z.number().int().min(0).max(36),
  block: z.string().nullable(),
  updated_at: z.number().int(),
})

/** `pool_daily`: one pool's depth, volume and APR split for a UTC day. */
export const poolDailyRowSchema = z.object({
  pool_id: z.string().min(1),
  day: daySchema,
  tvl_usd: usdSchema.nullable(),
  volume_24h_usd: usdSchema.nullable(),
  apr_fees: percentSchema.nullable(),
  apr_rewards: percentSchema.nullable(),
  apr_merkl: percentSchema.nullable(),
  apr_gauge: percentSchema.nullable(),
  /** JSON {field: source} for the figures present. */
  sources: z.string(),
  /** JSON {field: reason} for the figures absent. */
  unavailable: z.string(),
  updated_at: z.number().int(),
})

/** `bridge_route_totals`: Wormholescan's all-time totals per route, daily. */
export const bridgeRouteTotalsRowSchema = z.object({
  asset: bridgedAssetSchema,
  from_chain: z.string().min(1),
  to_chain: z.string().min(1),
  day: daySchema,
  transfers_total: z.number().int().nonnegative(),
  notional_usd_total: usdSchema,
  updated_at: z.number().int(),
})

/** `bridge_daily`: transfers and USD per day across every route. */
export const bridgeDailyRowSchema = z.object({
  asset: bridgedAssetSchema,
  day: daySchema,
  transfers: z.number().int().nonnegative(),
  notional_usd: usdSchema,
  updated_at: z.number().int(),
})

// ---------------------------------------------------------------------------
// /internal/scan/crosschain/prices

export const scanVenueQuoteSchema = z.object({
  venue: z.string(),
  /** "Curve MUSD/2pool". */
  label: z.string(),
  chain: crossChainSchema,
  pool: z.string(),
  url: z.url(),
  price_usd: usdSchema,
  /** The pool's two sides in USD at the time of reading. */
  depth_usd: usdSchema.nullable(),
  /** "30-minute TWAP", "get_dy x 2pool virtual price". */
  method: z.string(),
  read_at: unixSecondsSchema,
  block: z.string().nullable(),
  /** Read more than 10 minutes ago: not used in the headline. */
  stale: z.boolean(),
})
export type ScanVenueQuote = z.infer<typeof scanVenueQuoteSchema>

export const scanHeadlineBasisSchema = z.enum([
  /** Liquidity-weighted median of the fresh venue quotes. */
  "venues",
  /** CoinGecko's aggregate (MUSD's fallback, MEZO's primary). */
  "coingecko",
  /** MEZO's thin Aerodrome pool on Base (its fallback). */
  "aerodrome-cl",
])

export const scanAssetPriceSchema = z.object({
  asset: bridgedAssetSchema,
  price_usd: usdSchema.nullable(),
  basis: scanHeadlineBasisSchema.nullable(),
  /** "Liquidity-weighted median of 3 venues", "CoinGecko". */
  basis_label: z.string().nullable(),
  read_at: unixSecondsSchema.nullable(),
  /** The headline is older than 10 minutes. */
  stale: z.boolean(),
  venues: z.array(scanVenueQuoteSchema),
  /** Widest gap between fresh venue quotes, basis points. */
  spread_bps: z.number().int().nonnegative().nullable(),
  /** Fresh venues differ by more than 50 basis points. */
  diverged: z.boolean(),
  unavailable: unavailableSchema,
})
export type ScanAssetPrice = z.infer<typeof scanAssetPriceSchema>

export const coingeckoAttributionSchema = z.object({
  text: z.string(),
  url: z.url(),
})

export const scanCrossChainPricesSchema = z.object({
  data: z.object({ musd: scanAssetPriceSchema, mezo: scanAssetPriceSchema }),
  /**
   * CoinGecko's credit line. Kept for clients that read it; Matchbox's
   * plan needs no attribution and its surfaces do not show it.
   */
  attribution: z.object({ coingecko: coingeckoAttributionSchema }),
})
export type ScanCrossChainPrices = z.infer<typeof scanCrossChainPricesSchema>

/** `/internal/scan/crosschain/prices/history`: daily closes for a peg chart. */
export const scanPriceHistorySchema = z.object({
  asset: bridgedAssetSchema,
  days: z.array(
    z.object({
      day: daySchema,
      /** The headline's close; null on a day with no headline. */
      price_usd: usdSchema.nullable(),
      /** Each venue's close by venue id. */
      venues: z.record(z.string(), usdSchema),
    }),
  ),
})

// ---------------------------------------------------------------------------
// /internal/scan/crosschain/supply

export const scanChainSupplySchema = z.object({
  chain: crossChainSchema,
  token: addressSchema,
  total_supply: rawAmountSchema,
  /** Held by the hub's NTT manager for the other chains; null off the hub. */
  locked: rawAmountSchema.nullable(),
  circulating: rawAmountSchema,
  day: daySchema,
  updated_at: unixSecondsSchema,
})

export const scanAssetSupplySchema = z.object({
  asset: bridgedAssetSchema,
  decimals: z.number().int(),
  /** Sum of every chain's circulating supply; null when a chain is missing. */
  circulating: rawAmountSchema.nullable(),
  chains: z.array(scanChainSupplySchema),
  /** Circulating by chain per day, oldest first. */
  history: z.array(
    z.object({
      day: daySchema,
      chains: z.record(z.string(), rawAmountSchema),
    }),
  ),
  unavailable: unavailableSchema,
})

export const scanCrossChainSupplySchema = z.object({
  data: z.object({ musd: scanAssetSupplySchema, mezo: scanAssetSupplySchema }),
})

// ---------------------------------------------------------------------------
// /internal/scan/crosschain/pools

export const scanPoolAprSchema = z.object({
  /** Swap fees (or a vault's savings rate) to liquidity providers. */
  fees: percentSchema.nullable(),
  /** The venue's own rewards (CRV, AERO, Tigris MEZO emissions). */
  rewards: percentSchema.nullable(),
  /** Merkl campaigns (veMEZO on Mezo for MUSD pools). */
  merkl: percentSchema.nullable(),
  /** MEZO a Matchbox gauge sends to the pool. */
  gauge: percentSchema.nullable(),
  /** Sum of the parts present; null when none is. */
  total: percentSchema.nullable(),
})

export const scanCrossChainPoolSchema = z.object({
  id: z.string(),
  chain: crossChainSchema,
  venue: z.string(),
  pair: z.string(),
  kind: z.string().nullable(),
  pool: z.string(),
  url: z.url(),
  legacy: z.boolean(),
  /** The day of these figures; null before the first snapshot. */
  day: daySchema.nullable(),
  tvl_usd: usdSchema.nullable(),
  volume_24h_usd: usdSchema.nullable(),
  /** Sum of the last 7 days' 24h volumes; null with fewer than 7. */
  volume_7d_usd: usdSchema.nullable(),
  apr: scanPoolAprSchema,
  /** Mean total APR over the last 7 days; null with fewer than 7. */
  apr_7d: percentSchema.nullable(),
  /** Field → where it came from ("defillama", "geckoterminal", ...). */
  sources: z.record(z.string(), z.string()),
  /** The Matchbox gauge that funds this pool, if any. */
  gauge: z
    .object({
      address: addressSchema,
      name: z.string().nullable(),
      /**
       * "metadata": a ThirdPartyVoter gauge whose creation string names the
       * pool; "curated": the owner's mezo_gauge_destinations link; "pool":
       * a Tigris pool gauge on Mezo (Pro's gauge documents).
       */
      matched_by: z.enum(["metadata", "curated", "pool"]),
    })
    .nullable(),
  unavailable: unavailableSchema,
})
export type ScanCrossChainPool = z.infer<typeof scanCrossChainPoolSchema>

export const scanCrossChainPoolsSchema = z.object({
  data: z.array(scanCrossChainPoolSchema),
})

// ---------------------------------------------------------------------------
// /internal/scan/crosschain/bridge-flows

export const scanBridgeRouteSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** All-time transfers and USD on this route (Wormholescan). */
  transfers_total: z.number().int().nonnegative(),
  notional_usd_total: usdSchema,
  /**
   * Per day: the change in the all-time totals since the previous
   * snapshot day. The first stored day has no prior day and is left out.
   */
  daily: z.array(
    z.object({
      day: daySchema,
      transfers: z.number().int(),
      notional_usd: z.string(),
    }),
  ),
})

export const scanBridgeFlowsSchema = z.object({
  asset: bridgedAssetSchema,
  routes: z.array(scanBridgeRouteSchema),
  /** Every route together, per day, as Wormholescan counts it. */
  daily: z.array(
    z.object({
      day: daySchema,
      transfers: z.number().int().nonnegative(),
      notional_usd: usdSchema,
    }),
  ),
  as_of: unixSecondsSchema.nullable(),
  unavailable: unavailableSchema,
})
export type ScanBridgeFlows = z.infer<typeof scanBridgeFlowsSchema>
