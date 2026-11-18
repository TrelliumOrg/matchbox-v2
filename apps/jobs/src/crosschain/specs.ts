import type { UpsertSpec } from "../scan/statements"

// Upserts for the cross-chain tables (scan-migrations 0006). Each rewrites
// a row only when a value changed, so a re-run writes nothing. These rows
// are not "served" aggregates: they never bump scan_status.data_version
// (MUSD quotes change every minute and would retire every Scan cache); the
// API keys its cross-chain caches on time slots instead.

export type QuoteRow = {
  asset: "musd" | "mezo"
  venue: string
  chain: string | null
  price: string
  depth_usd: string | null
  method: string
  source: string
  block: string | null
  read_at: number
  detail: string | null
}

export const marketQuoteSpec: UpsertSpec = {
  table: "market_quotes",
  columns: [
    "asset",
    "venue",
    "chain",
    "price",
    "depth_usd",
    "method",
    "source",
    "block",
    "read_at",
    "detail",
  ],
  key: ["asset", "venue"],
  update: [
    "chain",
    "price",
    "depth_usd",
    "method",
    "source",
    "block",
    "read_at",
    "detail",
  ],
}

export const marketPriceDailySpec: UpsertSpec = {
  table: "market_price_daily",
  columns: [
    "asset",
    "venue",
    "day",
    "price",
    "depth_usd",
    "source",
    "updated_at",
  ],
  key: ["asset", "venue", "day"],
  update: ["price", "depth_usd", "source", "updated_at"],
}

export const tokenSupplySpec: UpsertSpec = {
  table: "token_supply_daily",
  columns: [
    "asset",
    "chain",
    "day",
    "total_supply",
    "locked",
    "circulating",
    "decimals",
    "block",
    "updated_at",
  ],
  key: ["asset", "chain", "day"],
  update: [
    "total_supply",
    "locked",
    "circulating",
    "decimals",
    "block",
    "updated_at",
  ],
}

export const poolDailySpec: UpsertSpec = {
  table: "pool_daily",
  columns: [
    "pool_id",
    "day",
    "tvl_usd",
    "volume_24h_usd",
    "apr_fees",
    "apr_rewards",
    "apr_merkl",
    "apr_gauge",
    "sources",
    "unavailable",
    "updated_at",
  ],
  key: ["pool_id", "day"],
  update: [
    "tvl_usd",
    "volume_24h_usd",
    "apr_fees",
    "apr_rewards",
    "apr_merkl",
    "apr_gauge",
    "sources",
    "unavailable",
    "updated_at",
  ],
}

export const bridgeRouteTotalsSpec: UpsertSpec = {
  table: "bridge_route_totals",
  columns: [
    "asset",
    "from_chain",
    "to_chain",
    "day",
    "transfers_total",
    "notional_usd_total",
    "updated_at",
  ],
  key: ["asset", "from_chain", "to_chain", "day"],
  update: ["transfers_total", "notional_usd_total", "updated_at"],
}

export const bridgeDailySpec: UpsertSpec = {
  table: "bridge_daily",
  columns: ["asset", "day", "transfers", "notional_usd", "updated_at"],
  key: ["asset", "day"],
  update: ["transfers", "notional_usd", "updated_at"],
}
