import {
  type ScanMetricDefinition,
  type ScanSeriesSplit,
  scanMetricDefinition,
  scanMetricNotes,
  scanMetricRecomputed,
  scanSeriesMaxDays,
  scanSeriesSplitSchema,
} from "@matchbox/contracts/scan"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import { tokenRegistry } from "../read-models/token-registry"
import { queryOf, type ScanContext } from "./context"
import { tokenDecimals } from "./market-decimals"
import { scanQueries } from "./queries"

// Mezo's markets over time (Matchscan batch 2): every dimension of a
// metric over a range (`/series/split`'s reader), and `/markets`, which
// answers everything Network's TVL and DEX volume panels need in one
// call instead of six.

/** Rows a split reads at most (whole days only). */
export const splitRows = 6_000
/** Longest range of a pool-token metric a split serves. */
export const splitPoolTokenDays = 7

const daySchema = z.iso.date()
const dayMs = 86_400_000
const splitRowSchema = z.object({
  dimension: z.string(),
  day: daySchema,
  value: z.string().regex(/^(0|-?[1-9][0-9]*)$/),
  partial: z.union([z.literal(0), z.literal(1)]).default(0),
})
const priceRowSchema = z.object({
  day: daySchema,
  price: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
})

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * One metric split by dimension over [from, to], newest first so the row
 * limit cuts the oldest days: past it the range starts the day after the
 * cut and says `truncated`. Points are partial as `/series` marks them.
 */
export async function readSplitRange(
  scan: ScanContext,
  metric: string,
  definition: ScanMetricDefinition,
  from: string,
  to: string,
): Promise<{ data: ScanSeriesSplit; settled: boolean }> {
  const [rows, dirtyDays] = await Promise.all([
    scan.rows(scanQueries.dailySplitRange, [metric, from, to, splitRows + 1]),
    scan.dirty("day"),
  ])
  const parsed = rows.map((row) => splitRowSchema.parse(row)).reverse()
  const truncated = parsed.length > splitRows
  const firstWhole = truncated ? (parsed[0]?.day ?? to) : null
  const kept =
    firstWhole === null ? parsed : parsed.filter((row) => row.day > firstWhole)
  const servedFrom =
    firstWhole === null
      ? from
      : dayOf(Date.parse(`${firstWhole}T00:00:00Z`) + dayMs)
  const today = dayOf(scan.nowMs())
  // A day still to recompute changes only what the copy step writes.
  const recomputed = scanMetricRecomputed(metric)
  const byDimension = new Map<
    string,
    { day: string; value: string; partial: boolean }[]
  >()
  for (const row of kept) {
    const list = byDimension.get(row.dimension) ?? []
    list.push({
      day: row.day,
      value: row.value,
      partial:
        row.partial === 1 ||
        row.day >= today ||
        (recomputed && dirtyDays.has(row.day)),
    })
    byDimension.set(row.dimension, list)
  }
  const series = [...byDimension.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dimension, points]) => {
      const token =
        definition.dimension === "token"
          ? /^0x[0-9a-f]{40}$/.test(dimension)
            ? dimension
            : null
          : (dimension.split(":")[1] ?? null)
      const registered = token === null ? undefined : tokenRegistry.get(token)
      return {
        dimension,
        token:
          token === null
            ? null
            : { address: token, symbol: registered?.token.symbol ?? null },
        resolvedDecimals:
          definition.decimals === "token"
            ? token === null
              ? null
              : tokenDecimals(undefined, token)
            : definition.decimals,
        points,
      }
    })
  return {
    settled:
      !truncated &&
      series.every((each) => each.points.every((point) => !point.partial)),
    data: {
      metric,
      from: servedFrom,
      to,
      truncated,
      note: scanMetricNotes[metric] ?? null,
      unit: definition.unit,
      decimals: definition.decimals,
      kind: definition.kind,
      signed: definition.signed,
      series,
    },
  }
}

/** The registry's definition of a metric this module reads. */
function definitionOf(metric: string): ScanMetricDefinition {
  const definition = scanMetricDefinition(metric)
  if (definition === null) throw new Error(`Unregistered metric ${metric}`)
  return definition
}

/** Days of a flow `/markets` always reads (a 30-day figure needs 30). */
const volumeMinDays = 31
/** Days of each pool's volume in `/markets` reads (the last whole day). */
const poolDays = 3
/**
 * The last days `/markets` reads on every miss; the days before them are
 * read apart and kept a day once settled (`settledSchema`), as `/series`
 * keeps a settled range.
 */
const recentDays = 3

const priceSchema = priceRowSchema.extend({ partial: z.boolean() })
type PriceRow = z.infer<typeof priceSchema>

/** Network's settled days: what a new data version cannot change. */
const settledSchema = z.object({
  balances: scanSeriesSplitSchema.nullable(),
  volume: scanSeriesSplitSchema,
  btc: z.array(priceSchema),
  mezo: z.array(priceSchema),
})

/** A split's older and newer reads as one, oldest day first. */
export function mergeSplits(
  older: ScanSeriesSplit,
  newer: ScanSeriesSplit,
): ScanSeriesSplit {
  const byDimension = new Map<string, ScanSeriesSplit["series"][number]>()
  for (const series of [...older.series, ...newer.series]) {
    const kept = byDimension.get(series.dimension)
    if (kept === undefined) {
      byDimension.set(series.dimension, {
        ...series,
        points: [...series.points],
      })
    } else {
      kept.points.push(...series.points)
    }
  }
  return {
    ...newer,
    from: older.from,
    truncated: older.truncated,
    series: [...byDimension.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, series]) => series),
  }
}

export function registerScanMarkets(app: Hono<ApiEnv>, scan: ScanContext) {
  const split = (metric: string, from: string, to: string) =>
    readSplitRange(scan, metric, definitionOf(metric), from, to)
  const prices = async (
    token: "btc" | "mezo",
    from: string,
    to: string,
  ): Promise<PriceRow[]> => {
    const today = dayOf(scan.nowMs())
    const rows = await scan.rows(scanQueries.priceRange, [token, from, to])
    return rows.map((row) => {
      const point = priceRowSchema.parse(row)
      return { ...point, partial: point.day >= today }
    })
  }

  /**
   * The days before the last three: kept under a version-free key once
   * every point in them is whole and the copy has passed them (as
   * `/series`' settled ranges), so a miss on a new data version reads the
   * last three days, not the whole period, again.
   */
  async function settledDays(
    c: ApiContext,
    input: {
      days: number
      /** Null when the period has no balances before the last days. */
      balancesFrom: string | null
      volumeFrom: string
      to: string
    },
  ): Promise<{ data: z.infer<typeof settledSchema>; settled: boolean }> {
    const resource = `/internal/scan/markets/settled?days=${input.days}&to=${input.to}`
    const kept = await scan.responder.peekFinal(resource)
    if (kept !== null) {
      const parsed = settledSchema.safeParse(JSON.parse(kept))
      if (parsed.success) return { data: parsed.data, settled: true }
    }
    const [balances, volume, btc, mezo, run] = await Promise.all([
      input.balancesFrom === null
        ? null
        : split("pool.token_balance", input.balancesFrom, input.to),
      split("dex.token_volume_in", input.volumeFrom, input.to),
      prices("btc", input.volumeFrom, input.to),
      prices("mezo", input.volumeFrom, input.to),
      scan.runVersion(),
    ])
    const data = {
      balances: balances?.data ?? null,
      volume: volume.data,
      btc,
      mezo,
    }
    const copied = run.status?.copied_through ?? null
    const settled =
      (balances?.settled ?? true) &&
      volume.settled &&
      copied !== null &&
      !run.stale &&
      input.to < dayOf((copied - 86_400) * 1000)
    if (settled) await scan.responder.keepFinal(c, resource, data)
    return { data, settled }
  }

  /**
   * Network's markets in one call: every pool's balances per token
   * (pool.token_balance) over `days`, their swap volume per token
   * (dex.token_volume_in) over at least 31 days, each pool's volume in
   * over the last three days (dex.volume_in, for the day's pools), and
   * BTC's and MEZO's daily closes over the longer range, all to today.
   * Keyed by the aggregate version and a 30-minute slot, as `/series`
   * outside its settled ranges; the days before the last three are read
   * apart and kept a day once settled (`settledDays`).
   */
  app.get("/internal/scan/markets", (c) => {
    const params = queryOf(c, {
      days: z.coerce.number().int().min(1).max(scanSeriesMaxDays),
    })
    return (async () => {
      const url = new URL(c.req.url)
      const version = `r${await scan.aggregateVersion()}-s${Math.floor(scan.nowSeconds() / 1_800)}`
      return scan.responder.serve(c, {
        cacheClass: "run",
        resource: `${url.pathname}${url.search}`,
        version,
        caller: callerOf(c),
        render: async () => {
          const now = scan.nowMs()
          const to = dayOf(now)
          const back = (days: number) => dayOf(now - (days - 1) * dayMs)
          const volumeDays = Math.max(params.days, volumeMinDays)
          const recent = back(recentDays)
          const balancesFrom = back(params.days)
          const hasOlder = balancesFrom < recent
          const [older, balances, volume, pools, btc, mezo] = await Promise.all(
            [
              settledDays(c, {
                days: params.days,
                balancesFrom: hasOlder ? balancesFrom : null,
                volumeFrom: back(volumeDays),
                to: back(recentDays + 1),
              }),
              split("pool.token_balance", hasOlder ? recent : balancesFrom, to),
              split("dex.token_volume_in", recent, to),
              split("dex.volume_in", back(poolDays), to),
              prices("btc", recent, to),
              prices("mezo", recent, to),
            ],
          )
          // Complete: no point of any part can still change.
          const settled =
            older.settled && balances.settled && volume.settled && pools.settled
          return {
            body: {
              data: {
                days: params.days,
                balances:
                  older.data.balances === null
                    ? balances.data
                    : mergeSplits(older.data.balances, balances.data),
                volume: mergeSplits(older.data.volume, volume.data),
                pools: pools.data,
                prices: {
                  btc: [...older.data.btc, ...btc],
                  mezo: [...older.data.mezo, ...mezo],
                },
              },
              meta: await scan.aggregateMeta(settled),
            },
          }
        },
      })
    })()
  })
}
