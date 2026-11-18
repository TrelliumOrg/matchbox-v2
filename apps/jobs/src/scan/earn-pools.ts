import { z } from "zod"
import type { DailyPoint } from "./aggregates"
import { rollupPoints } from "./market-rollups"

// Mezo's earn-pools subgraph (public Goldsky project, shared with Mezo's own
// dapp at 50 requests per 10 seconds): per-pool daily swap volume and fees
// for basic and CL pools. Volume counts the input side of each swap only
// (basic: amountXIn, CL: the positive amount), so it never double counts.
// Fees are what the pools charged: basic pools' Fees events, CL swap fees
// (amountIn x fee) plus flash fees. One query covers one day.

export const earnPoolsUrl =
  "https://api.goldsky.com/api/public/project_cm6ks2x8um4aj01uj8nwg1f6r/subgraphs/earn-pools-mezo/v1/gn"

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase())
const integer = z.string().regex(/^[0-9]+$/)

const poolRef = z.object({
  id: address,
  token0: z.object({ id: address }),
  token1: z.object({ id: address }),
})

const volumeRow = z.object({
  /** Microseconds. */
  timestamp: integer,
  pool: poolRef,
  totalVolume0: integer,
  totalVolume1: integer,
})

const feesRow = z.object({
  timestamp: integer,
  pool: poolRef,
  totalFees0: integer,
  totalFees1: integer,
})

export const earnPoolsDaySchema = z.object({
  data: z.object({
    poolVolumes: z.array(volumeRow),
    feesStats_collection: z.array(feesRow),
    clpoolVolumes: z.array(volumeRow),
    clfeeStats_collection: z.array(feesRow),
  }),
})

export type EarnPoolsDay = z.infer<typeof earnPoolsDaySchema>

/** The GraphQL query for the days in [fromSeconds, toSeconds). */
export function earnPoolsQuery(fromSeconds: number, toSeconds: number): string {
  const from = `${fromSeconds}000000`
  const to = `${toSeconds}000000`
  const filter = `interval: day, first: 1000, orderBy: timestamp, orderDirection: asc, where: { timestamp_gte: "${from}", timestamp_lt: "${to}" }`
  const pool = "pool { id token0 { id } token1 { id } }"
  return `{
  poolVolumes(${filter}) { timestamp ${pool} totalVolume0 totalVolume1 }
  feesStats_collection(${filter}) { timestamp ${pool} totalFees0 totalFees1 }
  clpoolVolumes(${filter}) { timestamp ${pool} totalVolume0 totalVolume1 }
  clfeeStats_collection(${filter}) { timestamp ${pool} totalFees0 totalFees1 }
}`
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>

export async function fetchEarnPools(
  fetcher: FetchLike,
  fromSeconds: number,
  toSeconds: number,
): Promise<EarnPoolsDay> {
  const response = await fetcher(earnPoolsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: earnPoolsQuery(fromSeconds, toSeconds) }),
  })
  if (!response.ok) {
    throw new Error(`earn-pools subgraph answered ${response.status}`)
  }
  return earnPoolsDaySchema.parse(await response.json())
}

/** Day (unix seconds) of an aggregation timestamp in microseconds. */
function daySeconds(micros: string): number {
  return Number.parseInt(micros.slice(0, -6) || "0", 10)
}

/**
 * Points per day: dex.volume_in and dex.fees, dimension pool:token, and
 * dex.token_volume_in, the day's volume summed per token (market-rollups).
 */
export function earnPoolsPoints(day: EarnPoolsDay): Map<number, DailyPoint[]> {
  const byDay = new Map<number, DailyPoint[]>()
  function push(seconds: number, point: DailyPoint) {
    const list = byDay.get(seconds) ?? []
    list.push(point)
    byDay.set(seconds, list)
  }
  const volumes = [...day.data.poolVolumes, ...day.data.clpoolVolumes]
  for (const row of volumes) {
    const seconds = daySeconds(row.timestamp)
    push(seconds, {
      metric: "dex.volume_in",
      dimension: `${row.pool.id}:${row.pool.token0.id}`,
      value: BigInt(row.totalVolume0),
    })
    push(seconds, {
      metric: "dex.volume_in",
      dimension: `${row.pool.id}:${row.pool.token1.id}`,
      value: BigInt(row.totalVolume1),
    })
  }
  const fees = [
    ...day.data.feesStats_collection,
    ...day.data.clfeeStats_collection,
  ]
  for (const row of fees) {
    const seconds = daySeconds(row.timestamp)
    push(seconds, {
      metric: "dex.fees",
      dimension: `${row.pool.id}:${row.pool.token0.id}`,
      value: BigInt(row.totalFees0),
    })
    push(seconds, {
      metric: "dex.fees",
      dimension: `${row.pool.id}:${row.pool.token1.id}`,
      value: BigInt(row.totalFees1),
    })
  }
  for (const list of byDay.values()) list.push(...rollupPoints(list))
  return byDay
}
