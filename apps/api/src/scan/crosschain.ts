import {
  bridgedAssets,
  type CrossChainPool,
  crossChainPools,
  musdPriceVenues,
  poolOfGaugeMetadata,
} from "@matchbox/chain"
import type { Prices } from "@matchbox/contracts/read-models"
import {
  bridgeDailyRowSchema,
  bridgedAssetSchema,
  bridgeRouteTotalsRowSchema,
  marketQuoteRowSchema,
  poolDailyRowSchema,
  type ScanAssetPrice,
  type ScanBridgedAsset,
  type ScanBridgeFlows,
  type ScanCrossChainPool,
  type ScanVenueQuote,
  tokenSupplyDailyRowSchema,
} from "@matchbox/contracts/scan"
import {
  meanDecimals,
  signedDecimalToWad,
  sumDecimals,
  wadToSignedDecimal,
} from "@matchbox/domain/market-price"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiEnv } from "../context"
import { coingeckoAttribution } from "../market/coingecko"
import { readReadModel } from "../read-models/store"
import { queryOf, type ScanContext } from "./context"
import { scanQueries } from "./queries"

// /internal/scan/crosschain/*: MUSD and MEZO beyond Mezo, from the tables
// the jobs Worker fills (apps/jobs/src/crosschain, scan-migrations 0006).
// These rows never bump scan_status.data_version (MUSD's quotes move every
// minute), so each route's cache key is a time slot instead: a minute for
// prices, five minutes for the rest. A figure nobody can give is null with
// the reason in `unavailable`, never 0.

/** A reading older than this is stale (never used as the headline). */
export const staleAfterSeconds = 10 * 60
const divergenceBps = 50

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)
const daysBefore = (seconds: number, days: number) =>
  day(seconds - days * 86_400)

function rowsOf<T>(schema: z.ZodType<T>, rows: readonly unknown[]): T[] {
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}

function jsonRecord(text: string | null): Record<string, string> {
  if (text === null) return {}
  try {
    const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

const headlineDetailSchema = z.object({
  spread_bps: z.number().int().nonnegative().nullable(),
  diverged: z.boolean(),
  venues: z.array(z.string()),
})

// -- Prices -----------------------------------------------------------------

const venueUrls: Record<string, string> = Object.fromEntries(
  crossChainPools.map((pool) => [pool.id, pool.url]),
)

/** MUSD's answer from its `market_quotes` rows. */
export function musdPrice(
  rows: readonly unknown[],
  nowSeconds: number,
): ScanAssetPrice {
  const quotes = rowsOf(marketQuoteRowSchema, rows)
  const venues: ScanVenueQuote[] = quotes.flatMap((quote) => {
    const venue =
      quote.venue in musdPriceVenues
        ? musdPriceVenues[quote.venue as keyof typeof musdPriceVenues]
        : undefined
    if (venue === undefined) return []
    return [
      {
        venue: quote.venue,
        label: venue.label,
        chain: venue.chain,
        pool: venue.pool,
        url: venueUrls[venue.poolId] ?? "https://www.geckoterminal.com",
        price_usd: quote.price,
        depth_usd: quote.depth_usd,
        method: quote.method,
        read_at: quote.read_at,
        block: quote.block,
        stale: nowSeconds - quote.read_at > staleAfterSeconds,
      },
    ]
  })
  venues.sort((a, b) => a.venue.localeCompare(b.venue))
  const headline = quotes.find((quote) => quote.venue === "headline")
  const unavailable: Record<string, string> = {}
  if (headline === undefined) {
    unavailable.price_usd = "No MUSD reading stored yet"
    return {
      asset: "musd",
      price_usd: null,
      basis: null,
      basis_label: null,
      read_at: null,
      stale: true,
      venues,
      spread_bps: null,
      diverged: false,
      unavailable,
    }
  }
  let detail: z.infer<typeof headlineDetailSchema> | null = null
  try {
    const parsed = headlineDetailSchema.safeParse(
      JSON.parse(headline.detail ?? "null"),
    )
    detail = parsed.success ? parsed.data : null
  } catch {
    detail = null
  }
  const fromVenues = headline.source === "venues"
  if (detail?.spread_bps === null || detail === null) {
    unavailable.spread_bps = fromVenues
      ? "One venue answered"
      : "No venue answered; CoinGecko is the price"
  }
  return {
    asset: "musd",
    price_usd: headline.price,
    basis: fromVenues ? "venues" : "coingecko",
    basis_label: fromVenues
      ? `Liquidity-weighted median of ${detail?.venues.length ?? 0} venues`
      : "CoinGecko",
    read_at: headline.read_at,
    stale: nowSeconds - headline.read_at > staleAfterSeconds,
    venues,
    spread_bps: detail?.spread_bps ?? null,
    diverged:
      detail?.diverged === true || (detail?.spread_bps ?? 0) > divergenceBps,
    unavailable,
  }
}

/** MEZO's answer from the jobs Worker's KV price. */
export function mezoPrice(
  prices: Prices | null,
  nowSeconds: number,
): ScanAssetPrice {
  const mezo = prices?.mezo ?? null
  const unavailable: Record<string, string> = {
    venues:
      "MEZO trades mostly on exchanges: CoinGecko's aggregate is the price",
    spread_bps: "One source",
  }
  if (mezo === null) {
    unavailable.price_usd = "No MEZO price in the last 10 minutes"
    return {
      asset: "mezo",
      price_usd: null,
      basis: null,
      basis_label: null,
      read_at: null,
      stale: true,
      venues: [],
      spread_bps: null,
      diverged: false,
      unavailable,
    }
  }
  const coingecko = mezo.source === "coingecko"
  return {
    asset: "mezo",
    price_usd: mezo.usd,
    basis: coingecko ? "coingecko" : "aerodrome-cl",
    basis_label: coingecko
      ? "CoinGecko"
      : "Aerodrome MEZO/MUSD on Base (thin fallback)",
    read_at: mezo.updatedAt,
    stale: nowSeconds - mezo.updatedAt > staleAfterSeconds,
    venues: [],
    spread_bps: null,
    diverged: false,
    unavailable,
  }
}

// -- Supply -----------------------------------------------------------------

export function assetSupply(asset: ScanBridgedAsset, rows: readonly unknown[]) {
  const parsed = rowsOf(tokenSupplyDailyRowSchema, rows)
  const deployments = bridgedAssets[asset].deployments
  const latest = new Map<string, (typeof parsed)[number]>()
  const history = new Map<string, Record<string, string>>()
  for (const row of parsed) {
    latest.set(row.chain, row)
    const chains = history.get(row.day) ?? {}
    chains[row.chain] = row.circulating
    history.set(row.day, chains)
  }
  const unavailable: Record<string, string> = {}
  const missing = deployments.filter((d) => !latest.has(d.chain))
  for (const deployment of missing) {
    unavailable[`chains.${deployment.chain}`] = "No supply read yet"
  }
  if (missing.length > 0) {
    unavailable.circulating = "A chain's supply is missing"
  }
  const chains = deployments.flatMap((deployment) => {
    const row = latest.get(deployment.chain)
    return row === undefined
      ? []
      : [
          {
            chain: deployment.chain,
            token: deployment.token,
            total_supply: row.total_supply,
            locked: row.locked,
            circulating: row.circulating,
            day: row.day,
            updated_at: row.updated_at,
          },
        ]
  })
  return {
    asset,
    decimals: deployments[0]?.decimals ?? 18,
    circulating:
      missing.length > 0
        ? null
        : chains
            .reduce((sum, chain) => sum + BigInt(chain.circulating), 0n)
            .toString(),
    chains,
    history: [...history.entries()].map(([dayKey, byChain]) => ({
      day: dayKey,
      chains: byChain,
    })),
    unavailable,
  }
}

// -- Pools ------------------------------------------------------------------

export type GaugeLink = NonNullable<ScanCrossChainPool["gauge"]>

export type PoolExtras = {
  /** Matchbox gauges by pool id. */
  gauges: Map<string, GaugeLink>
  /** Tigris MEZO emission APR (Pro's pool gauges) by pool address. */
  emissionApr: Map<string, string>
}

export function crossChainPoolRows(
  rows: readonly unknown[],
  extras: PoolExtras,
  today: string,
): ScanCrossChainPool[] {
  const parsed = rowsOf(poolDailyRowSchema, rows)
  const byPool = new Map<string, typeof parsed>()
  for (const row of parsed) {
    const list = byPool.get(row.pool_id) ?? []
    list.push(row)
    byPool.set(row.pool_id, list)
  }
  const weekStart = day(Date.parse(`${today}T00:00:00Z`) / 1000 - 6 * 86_400)
  return crossChainPools.map((pool) => {
    const history = byPool.get(pool.id) ?? []
    const row = history[history.length - 1]
    const sources = jsonRecord(row?.sources ?? null)
    const unavailable = jsonRecord(row?.unavailable ?? null)
    let rewards = row?.apr_rewards ?? null
    const emission = extras.emissionApr.get(pool.address.toLowerCase())
    if (rewards === null && emission !== undefined) {
      rewards = emission
      sources.apr_rewards = "matchbox gauges (MEZO emissions to stakers)"
      delete unavailable.apr_rewards
    } else if (rewards === null && pool.venue === "tigris") {
      unavailable.apr_rewards = "No pool gauge emissions found"
    }
    const gauge = extras.gauges.get(pool.id) ?? null
    if (gauge === null)
      unavailable.apr_gauge = "No Matchbox gauge funds this pool"
    const parts = {
      fees: row?.apr_fees ?? null,
      rewards,
      merkl: row?.apr_merkl ?? null,
      gauge: row?.apr_gauge ?? null,
    }
    const week = history.filter((item) => item.day >= weekStart)
    const fullWeek = new Set(week.map((item) => item.day)).size >= 7
    const weekVolumes = week.map((item) => item.volume_24h_usd)
    const weekTotals = week.flatMap((item) => {
      const total = sumDecimals([
        item.apr_fees,
        item.apr_rewards,
        item.apr_merkl,
        item.apr_gauge,
      ])
      return total === null ? [] : [total]
    })
    if (!fullWeek) {
      unavailable.volume_7d_usd = "Fewer than 7 days stored"
      unavailable.apr_7d = "Fewer than 7 days stored"
    }
    if (row === undefined) unavailable.day = "No snapshot stored yet"
    return {
      id: pool.id,
      chain: pool.chain,
      venue: pool.venue,
      pair: pool.pair,
      kind: pool.kind,
      pool: pool.address,
      url: pool.url,
      legacy: pool.legacy,
      day: row?.day ?? null,
      tvl_usd: row?.tvl_usd ?? null,
      volume_24h_usd: row?.volume_24h_usd ?? null,
      volume_7d_usd:
        fullWeek && weekVolumes.every((value) => value !== null)
          ? sumDecimals(weekVolumes, 18)
          : null,
      apr: {
        ...parts,
        total: sumDecimals([
          parts.fees,
          parts.rewards,
          parts.merkl,
          parts.gauge,
        ]),
      },
      apr_7d: fullWeek ? meanDecimals(weekTotals) : null,
      sources,
      gauge,
      unavailable,
    }
  })
}

const gaugeLabelRowSchema = z.object({
  gauge_address: z.string(),
  label: z.string(),
})
const namedLabelSchema = z.object({
  type: z.literal("named"),
  name: z.string(),
  metadata: z.string(),
})
const curatedRowSchema = z.object({
  gauge_address: z.string(),
  url: z.string().nullable(),
})

/**
 * Matchbox's cross-chain gauges by the pool they fund: ThirdPartyVoter's
 * creation metadata ends with the pool address's first 8 hex digits; an
 * owner's `mezo_gauge_destinations` row whose link names the pool wins.
 */
export async function crossChainGauges(
  marketDb: D1Database,
  network: string,
): Promise<Map<string, GaugeLink>> {
  const [labels, curated] = await Promise.all([
    marketDb
      .prepare(
        "SELECT gauge_address, label FROM gauge_labels WHERE network = ?1",
      )
      .bind(network)
      .all(),
    marketDb
      .prepare(
        "SELECT gauge_address, url FROM mezo_gauge_destinations WHERE network = ?1",
      )
      .bind(network)
      .all(),
  ])
  const links = new Map<string, GaugeLink>()
  for (const row of rowsOf(gaugeLabelRowSchema, labels.results)) {
    let label: z.infer<typeof namedLabelSchema> | null = null
    try {
      const parsed = namedLabelSchema.safeParse(JSON.parse(row.label))
      label = parsed.success ? parsed.data : null
    } catch {
      label = null
    }
    const pool = label === null ? null : poolOfGaugeMetadata(label.metadata)
    if (pool === null || label === null) continue
    links.set(pool.id, {
      address: row.gauge_address.toLowerCase(),
      name: label.name,
      matched_by: "metadata",
    })
  }
  for (const row of rowsOf(curatedRowSchema, curated.results)) {
    const url = row.url?.toLowerCase() ?? ""
    const pool = crossChainPools.find(
      (item: CrossChainPool) =>
        url.length > 0 && url.includes(item.address.toLowerCase()),
    )
    if (pool === undefined) continue
    links.set(pool.id, {
      address: row.gauge_address.toLowerCase(),
      name: links.get(pool.id)?.name ?? null,
      matched_by: "curated",
    })
  }
  return links
}

// -- Bridge flows -----------------------------------------------------------

export function bridgeFlows(
  asset: ScanBridgedAsset,
  routeRows: readonly unknown[],
  dailyRows: readonly unknown[],
): ScanBridgeFlows {
  if (asset === "mezo") {
    return {
      asset,
      routes: [],
      daily: [],
      as_of: null,
      unavailable: {
        routes: "Wormholescan's NTT endpoints do not support MEZO",
        daily: "Wormholescan's NTT endpoints do not support MEZO",
      },
    }
  }
  const totals = rowsOf(bridgeRouteTotalsRowSchema, routeRows)
  const byRoute = new Map<string, typeof totals>()
  for (const row of totals) {
    const key = `${row.from_chain}>${row.to_chain}`
    const list = byRoute.get(key) ?? []
    list.push(row)
    byRoute.set(key, list)
  }
  let asOf: number | null = null
  const routes = [...byRoute.values()].flatMap((list) => {
    const last = list[list.length - 1]
    if (last === undefined) return []
    asOf = Math.max(asOf ?? 0, last.updated_at)
    const daily = list.slice(1).flatMap((row, index) => {
      const previous = list[index]
      if (previous === undefined) return []
      const consecutive =
        Date.parse(`${row.day}T00:00:00Z`) -
          Date.parse(`${previous.day}T00:00:00Z`) ===
        86_400_000
      if (!consecutive) return []
      const now = signedDecimalToWad(row.notional_usd_total) ?? 0n
      const before = signedDecimalToWad(previous.notional_usd_total) ?? 0n
      return [
        {
          day: row.day,
          transfers: row.transfers_total - previous.transfers_total,
          notional_usd: wadToSignedDecimal(now - before, 2),
        },
      ]
    })
    return [
      {
        from: last.from_chain,
        to: last.to_chain,
        transfers_total: last.transfers_total,
        notional_usd_total: last.notional_usd_total,
        daily,
      },
    ]
  })
  routes.sort((a, b) => b.transfers_total - a.transfers_total)
  const unavailable: Record<string, string> = {}
  if (routes.length === 0) unavailable.routes = "No bridge snapshot stored yet"
  else if (routes.every((route) => route.daily.length === 0)) {
    unavailable["routes.daily"] =
      "Per-route days need two consecutive daily snapshots"
  }
  return {
    asset,
    routes,
    daily: rowsOf(bridgeDailyRowSchema, dailyRows).map((row) => ({
      day: row.day,
      transfers: row.transfers,
      notional_usd: row.notional_usd,
    })),
    as_of: asOf,
    unavailable,
  }
}

// -- Routes -----------------------------------------------------------------

const daysParam = z.coerce.number().int().min(1).max(365)

export function registerScanCrossChain(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  const slot = (seconds: number) =>
    `t${Math.floor(scan.nowSeconds() / seconds)}`

  app.get("/internal/scan/crosschain/prices", (c) => {
    queryOf(c, {})
    return scan.responder.serve(c, {
      cacheClass: "live",
      resource: new URL(c.req.url).pathname,
      version: slot(60),
      caller: callerOf(c),
      render: async () => {
        const [rows, prices] = await Promise.all([
          scan.rows(scanQueries.crossChainQuotes, ["musd"]),
          scan.deps.readPrices().catch(() => null),
        ])
        const now = scan.nowSeconds()
        return {
          body: {
            data: { musd: musdPrice(rows, now), mezo: mezoPrice(prices, now) },
            attribution: { coingecko: coingeckoAttribution },
          },
        }
      },
    })
  })

  app.get("/internal/scan/crosschain/prices/history", (c) => {
    const params = queryOf(c, {
      asset: z.literal("musd").default("musd"),
      days: daysParam.default(90),
    })
    const url = new URL(c.req.url)
    return scan.responder.serve(c, {
      cacheClass: "run",
      resource: `${url.pathname}?${url.searchParams}`,
      version: slot(300),
      caller: callerOf(c),
      render: async () => {
        const rows = await scan.rows(scanQueries.crossChainPriceDays, [
          params.asset,
          daysBefore(scan.nowSeconds(), params.days - 1),
        ])
        const days = new Map<
          string,
          { price_usd: string | null; venues: Record<string, string> }
        >()
        const parsed = rowsOf(
          z.object({ venue: z.string(), day: z.string(), price: z.string() }),
          rows,
        )
        for (const row of parsed) {
          const entry = days.get(row.day) ?? { price_usd: null, venues: {} }
          if (row.venue === "headline") entry.price_usd = row.price
          else entry.venues[row.venue] = row.price
          days.set(row.day, entry)
        }
        return {
          body: {
            asset: params.asset,
            days: [...days.entries()].map(([dayKey, entry]) => ({
              day: dayKey,
              ...entry,
            })),
          },
        }
      },
    })
  })

  app.get("/internal/scan/crosschain/supply", (c) => {
    const params = queryOf(c, { days: daysParam.default(30) })
    const url = new URL(c.req.url)
    return scan.responder.serve(c, {
      cacheClass: "run",
      resource: `${url.pathname}?${url.searchParams}`,
      version: slot(300),
      caller: callerOf(c),
      render: async () => {
        const from = daysBefore(scan.nowSeconds(), params.days - 1)
        const [musd, mezo] = await Promise.all(
          (["musd", "mezo"] as const).map((asset) =>
            scan.rows(scanQueries.crossChainSupplyDays, [asset, from]),
          ),
        )
        return {
          body: {
            data: {
              musd: assetSupply("musd", musd ?? []),
              mezo: assetSupply("mezo", mezo ?? []),
            },
          },
        }
      },
    })
  })

  app.get("/internal/scan/crosschain/pools", (c) => {
    queryOf(c, {})
    return scan.responder.serve(c, {
      cacheClass: "run",
      resource: new URL(c.req.url).pathname,
      version: slot(300),
      caller: callerOf(c),
      render: async () => {
        const now = scan.nowSeconds()
        const [rows, gauges, directory] = await Promise.all([
          scan.rows(scanQueries.crossChainPoolDays, [daysBefore(now, 7)]),
          scan.deps.marketDb === undefined || scan.deps.marketDb === null
            ? Promise.resolve(new Map<string, GaugeLink>())
            : crossChainGauges(scan.deps.marketDb, scan.deps.network).catch(
                () => new Map<string, GaugeLink>(),
              ),
          scan.deps.readDb === null
            ? Promise.resolve(null)
            : readReadModel(
                scan.read(),
                scan.deps.network,
                "gauges",
                "current",
              ).catch(() => null),
        ])
        const emissionApr = new Map<string, string>()
        for (const card of directory?.data.gauges ?? []) {
          if (card.meta?.kind !== "pool") continue
          const pool = card.meta.pool.toLowerCase()
          if (card.meta.emissionApr !== null) {
            emissionApr.set(pool, card.meta.emissionApr)
          }
          const tracked = crossChainPools.find(
            (item) => item.address.toLowerCase() === pool,
          )
          if (tracked !== undefined && !gauges.has(tracked.id)) {
            gauges.set(tracked.id, {
              address: card.gauge.address.toLowerCase(),
              name: card.gauge.name,
              matched_by: "pool",
            })
          }
        }
        return {
          body: {
            data: crossChainPoolRows(rows, { gauges, emissionApr }, day(now)),
          },
        }
      },
    })
  })

  app.get("/internal/scan/crosschain/bridge-flows", (c) => {
    const params = queryOf(c, {
      asset: bridgedAssetSchema.default("musd"),
      days: daysParam.default(30),
    })
    const url = new URL(c.req.url)
    return scan.responder.serve(c, {
      cacheClass: "run",
      resource: `${url.pathname}?${url.searchParams}`,
      version: slot(300),
      caller: callerOf(c),
      render: async () => {
        // One day more than asked, so the first day has a prior snapshot.
        const from = daysBefore(scan.nowSeconds(), params.days)
        const [routes, daily] =
          params.asset === "mezo"
            ? [[], []]
            : await Promise.all([
                scan.rows(scanQueries.crossChainRouteDays, [
                  params.asset,
                  from,
                ]),
                scan.rows(scanQueries.crossChainBridgeDays, [
                  params.asset,
                  from,
                ]),
              ])
        return { body: bridgeFlows(params.asset, routes, daily) }
      },
    })
  })
}
