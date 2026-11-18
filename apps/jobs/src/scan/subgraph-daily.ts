import { z } from "zod"
import type { DailyPoint } from "./aggregates"
import {
  earnPoolsDaySchema,
  earnPoolsPoints,
  earnPoolsUrl,
  type FetchLike,
} from "./earn-pools"
import { dayOf, dayStart } from "./transform"

// The once-a-day reads of Mezo's public Goldsky subgraphs (shared with
// Mezo's own dapp; one request per source per day). Every answer carries
// the subgraph's `_meta.block.timestamp`: a day is only accepted once the
// subgraph has indexed past its end, so a lagging subgraph is retried on a
// later run instead of being recorded short.

const goldsky =
  "https://api.goldsky.com/api/public/project_cm6ks2x8um4aj01uj8nwg1f6r/subgraphs"

export const subgraphSources = [
  "dex",
  "fees",
  "bridge-in",
  "bridge-out",
] as const
export type SubgraphSource = (typeof subgraphSources)[number]

const integer = z.string().regex(/^[0-9]+$/)
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase())
const metaSchema = z.object({
  block: z.object({ timestamp: z.number().int().nonnegative() }),
})

const vebtc = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"

/** Rows per list; a list this long may be cut short. */
export const pageLimit = 1000

export type SubgraphDays = {
  /** Points per finished day (YYYY-MM-DD). */
  days: Map<string, DailyPoint[]>
  /**
   * The newest day that is complete in this answer: the subgraph has
   * indexed past its end, and no list came back full (a full page of
   * 1,000 may have cut a later day short, so days from the last returned
   * one on are left for a later read).
   */
  indexedThrough: string
  /** True when a full page limited indexedThrough. */
  truncated: boolean
  /** Pools and their tokens seen in the answer (dex only). */
  pools: {
    pool: string
    token0: string
    token1: string
    kind: "basic" | "cl"
  }[]
}

async function graphql(
  fetcher: FetchLike,
  url: string,
  query: string,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  })
  if (!response.ok) throw new Error(`Subgraph answered ${response.status}`)
  const body = z
    .object({ data: z.unknown().optional(), errors: z.unknown().optional() })
    .parse(await response.json())
  if (body.errors !== undefined || body.data === undefined) {
    throw new Error(
      `Subgraph errors: ${JSON.stringify(body.errors).slice(0, 200)}`,
    )
  }
  return body.data
}

/** The day before the one the subgraph is indexing now. */
function finishedThrough(indexedSeconds: number): string {
  return dayOf(dayStart(dayOf(indexedSeconds)) - 86_400)
}

function push(map: Map<string, DailyPoint[]>, day: string, point: DailyPoint) {
  const list = map.get(day) ?? []
  const existing = list.find(
    (item) =>
      item.metric === point.metric && item.dimension === point.dimension,
  )
  if (existing === undefined) list.push({ ...point })
  else existing.value += point.value
  map.set(day, list)
}

/**
 * Points for the days in [fromDay, toDay] from one source, keeping only
 * days the subgraph has indexed to the end of. One request.
 */
export async function readSubgraphDays(
  fetcher: FetchLike,
  source: SubgraphSource,
  fromDay: string,
  toDay: string,
): Promise<SubgraphDays> {
  const from = dayStart(fromDay)
  const to = dayStart(toDay) + 86_400
  const days = new Map<string, DailyPoint[]>()
  const pools: SubgraphDays["pools"] = []
  let indexed = 0
  /** The earliest last-row time (seconds) of any list that came back full. */
  let cut: number | null = null
  function full(list: readonly unknown[], lastSeconds: number | null) {
    if (list.length < pageLimit || lastSeconds === null) return
    cut = cut === null ? lastSeconds : Math.min(cut, lastSeconds)
  }
  const micros = (value: string | undefined) =>
    value === undefined ? null : Number.parseInt(value.slice(0, -6) || "0", 10)
  if (source === "dex") {
    const filter = `interval: day, first: 1000, orderBy: timestamp, orderDirection: asc, where: { timestamp_gte: "${from}000000", timestamp_lt: "${to}000000" }`
    const pool = "pool { id token0 { id } token1 { id } }"
    const ref = "first: 1000) { id token0 { id } token1 { id } }"
    const data = z
      .object({
        _meta: metaSchema,
        pools: z.array(
          z.object({
            id: address,
            token0: z.object({ id: address }),
            token1: z.object({ id: address }),
          }),
        ),
        clpools: z.array(
          z.object({
            id: address,
            token0: z.object({ id: address }),
            token1: z.object({ id: address }),
          }),
        ),
      })
      .and(earnPoolsDaySchema.shape.data)
      .parse(
        await graphql(
          fetcher,
          earnPoolsUrl,
          `{
  _meta { block { timestamp } }
  pools(${ref}
  clpools(${ref}
  poolVolumes(${filter}) { timestamp ${pool} totalVolume0 totalVolume1 }
  feesStats_collection(${filter}) { timestamp ${pool} totalFees0 totalFees1 }
  clpoolVolumes(${filter}) { timestamp ${pool} totalVolume0 totalVolume1 }
  clfeeStats_collection(${filter}) { timestamp ${pool} totalFees0 totalFees1 }
}`,
        ),
      )
    indexed = data._meta.block.timestamp
    for (const list of [
      data.poolVolumes,
      data.feesStats_collection,
      data.clpoolVolumes,
      data.clfeeStats_collection,
    ]) {
      full(list, micros(list.at(-1)?.timestamp))
    }
    for (const [seconds, points] of earnPoolsPoints({ data })) {
      for (const point of points) push(days, dayOf(seconds), point)
    }
    for (const row of data.pools) {
      pools.push({
        pool: row.id,
        token0: row.token0.id,
        token1: row.token1.id,
        kind: "basic",
      })
    }
    for (const row of data.clpools) {
      pools.push({
        pool: row.id,
        token0: row.token0.id,
        token1: row.token1.id,
        kind: "cl",
      })
    }
  } else if (source === "fees") {
    const data = z
      .object({
        _meta: metaSchema,
        distributedRewards_collection: z.array(
          z.object({ timestamp: integer, amount: integer, token: address }),
        ),
      })
      .parse(
        await graphql(
          fetcher,
          `${goldsky}/earn-locks-mezo/v2/gn`,
          `{ _meta { block { timestamp } }
  distributedRewards_collection(first: 1000, orderBy: timestamp, orderDirection: asc, where: { timestamp_gte: "${from}000000", timestamp_lt: "${to}000000" }) { timestamp amount token } }`,
        ),
      )
    indexed = data._meta.block.timestamp
    full(
      data.distributedRewards_collection,
      micros(data.distributedRewards_collection.at(-1)?.timestamp),
    )
    for (const row of data.distributedRewards_collection) {
      const seconds = Number.parseInt(row.timestamp.slice(0, -6) || "0", 10)
      push(days, dayOf(seconds), {
        metric:
          row.token === vebtc
            ? "fees.chain_vebtc"
            : "emissions.rebase_distributed",
        dimension: "",
        value: BigInt(row.amount),
      })
    }
  } else {
    const inbound = source === "bridge-in"
    const entity = inbound ? "assetsLockeds" : "assetsUnlockeds"
    const data = z
      .object({
        _meta: metaSchema,
        rows: z.array(
          z.object({
            amount: integer,
            token: address,
            timestamp_: integer,
            chain: z.string().optional(),
          }),
        ),
      })
      .parse(
        await graphql(
          fetcher,
          `${goldsky}/${inbound ? "mezo-bridge-mainnet" : "mezo-bridge-out-mezo"}/v1/gn`,
          `{ _meta { block { timestamp } }
  rows: ${entity}(first: 1000, orderBy: timestamp_, orderDirection: asc, where: { timestamp__gte: "${from}", timestamp__lt: "${to}" }) { amount token timestamp_ ${inbound ? "" : "chain"} } }`,
        ),
      )
    indexed = data._meta.block.timestamp
    const lastRow = data.rows.at(-1)
    full(
      data.rows,
      lastRow === undefined ? null : Number.parseInt(lastRow.timestamp_, 10),
    )
    for (const row of data.rows) {
      const day = dayOf(Number.parseInt(row.timestamp_, 10))
      const dimension = inbound
        ? row.token
        : `${row.token}:${row.chain === "1" ? "bitcoin" : "ethereum"}`
      const metric = inbound ? "bridge.in" : "bridge.out"
      push(days, day, { metric, dimension, value: BigInt(row.amount) })
      push(days, day, { metric: `${metric}_count`, dimension, value: 1n })
    }
  }
  const indexedDay = finishedThrough(indexed)
  const cutAt: number | null = cut
  // The day of the last row of a full page may continue on the next page.
  const cutDay = cutAt === null ? null : dayOf(dayStart(dayOf(cutAt)) - 86_400)
  const through = cutDay !== null && cutDay < indexedDay ? cutDay : indexedDay
  for (const day of [...days.keys()]) {
    if (day > through) days.delete(day)
  }
  return { days, indexedThrough: through, truncated: cutDay !== null, pools }
}
