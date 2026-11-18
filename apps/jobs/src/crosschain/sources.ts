import {
  type CoinGeckoConfig,
  decimalFromNumber,
} from "@matchbox/api/market/coingecko"
import { z } from "zod"

// Public APIs, each answer checked against a schema. Numbers sent as JSON
// numbers become exact decimal strings (decimalFromNumber), never float
// arithmetic. Limits (12 Nov 2026): GeckoTerminal keyless about 30 calls a
// minute per IP and 30 pools a call (a Worker's shared egress IPs are often
// over it: HTTP 429); CoinGecko's keyed onchain endpoint serves the same
// pool data within the key's own limits; DefiLlama, Curve, Merkl and
// Wormholescan publish no limit for this use. One hourly run makes about
// 12 calls.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export class SourceError extends Error {
  override name = "SourceError"
  constructor(
    readonly source: string,
    readonly status: number | null,
    reason: string,
  ) {
    super(`${source}: ${reason}`)
  }
}

/**
 * A source's JSON. A failure's message names the source and the HTTP status
 * only: never the URL or a header, which may carry a key.
 */
async function getJson(
  fetcher: Fetcher,
  source: string,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = { accept: "application/json" },
): Promise<unknown> {
  const response = await fetcher(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new SourceError(source, response.status, `HTTP ${response.status}`)
  }
  return response.json()
}

function parse<T>(schema: z.ZodType<T>, body: unknown, source: string): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new SourceError(source, null, "Unexpected response shape")
  }
  return parsed.data
}

const decimalText = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
  .nullable()

const unsignedText = /^[0-9]+(\.[0-9]+)?$/

/** A JSON number as exact decimal text; null for null or negative. */
function numberText(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : decimalFromNumber(value)
}

/** Signed percent text from a JSON number (an APY may be negative). */
function signedText(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value < 0) {
    const magnitude = decimalFromNumber(-value)
    return magnitude === null ? null : `-${magnitude}`
  }
  return decimalFromNumber(value)
}

// -- Pool depth: GeckoTerminal, and CoinGecko's keyed onchain endpoint ------

// Both answer with GeckoTerminal's data in one JSON:API shape (CoinGecko's
// `MultiPoolAddressData`, docs.coingecko.com "Multiple Pools Data by Pool
// Addresses", read 12 Nov 2026): `data[].attributes` with `address`,
// `reserve_in_usd` and `volume_usd.h24` as decimal strings. Up to 30
// addresses a call on both; unknown addresses are left out of the answer.
const geckoPoolsSchema = z.object({
  data: z.array(
    z.object({
      attributes: z.object({
        address: z.string(),
        reserve_in_usd: decimalText.optional(),
        volume_usd: z.object({ h24: decimalText.optional() }),
      }),
    }),
  ),
})

/** Where a pool's depth came from (a `pool_daily.sources` value). */
export type PoolDepthSource = "coingecko" | "geckoterminal"

export type GeckoPool = {
  tvlUsd: string | null
  volume24hUsd: string | null
  source: PoolDepthSource
}

/** Addresses a pools/multi call takes. */
const poolsPerCall = 30

function poolsFrom(
  body: unknown,
  source: PoolDepthSource,
  label: string,
  into: Map<string, GeckoPool>,
): void {
  for (const pool of parse(geckoPoolsSchema, body, label).data) {
    into.set(pool.attributes.address.toLowerCase(), {
      tvlUsd: pool.attributes.reserve_in_usd ?? null,
      volume24hUsd: pool.attributes.volume_usd.h24 ?? null,
      source,
    })
  }
}

/**
 * TVL and 24h volume by lower-case address (or v4 pool id), keyless.
 * Not its token prices: GeckoTerminal's Mezo token prices are unreliable.
 */
export async function geckoTerminalPools(
  fetcher: Fetcher,
  network: string,
  addresses: readonly string[],
  timeoutMs = 10_000,
): Promise<Map<string, GeckoPool>> {
  const pools = new Map<string, GeckoPool>()
  for (let start = 0; start < addresses.length; start += poolsPerCall) {
    const chunk = addresses.slice(start, start + poolsPerCall)
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/multi/${chunk.join(",")}`
    poolsFrom(
      await getJson(fetcher, "geckoterminal", url, timeoutMs),
      "geckoterminal",
      "geckoterminal",
      pools,
    )
  }
  return pools
}

/** A CoinGecko config that has a key. */
export type KeyedCoinGecko = CoinGeckoConfig & { apiKey: string }

/**
 * The keyed onchain request: Demo keys on api.coingecko.com with
 * `x-cg-demo-api-key`, paid keys on pro-api.coingecko.com with
 * `x-cg-pro-api-key`. The key is in a header, never the URL.
 */
export function onchainPoolsRequest(
  network: string,
  addresses: readonly string[],
  config: KeyedCoinGecko,
): { url: string; headers: Record<string, string> } {
  const host =
    config.plan === "pro" ? "pro-api.coingecko.com" : "api.coingecko.com"
  return {
    url: `https://${host}/api/v3/onchain/networks/${network}/pools/multi/${addresses.join(",")}`,
    headers: {
      accept: "application/json",
      [config.plan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]:
        config.apiKey,
    },
  }
}

/** Keyed calls left this run; each call takes one before it is made. */
export type CallAllowance = { remaining: number }

/**
 * TVL and 24h volume from CoinGecko's keyed onchain endpoint, by lower-case
 * address. Throws a SourceError ("coingecko-onchain: ...") on any failure,
 * and before a call the allowance has no room for.
 */
export async function coingeckoOnchainPools(
  fetcher: Fetcher,
  network: string,
  addresses: readonly string[],
  config: KeyedCoinGecko,
  allowance: CallAllowance,
  timeoutMs = 10_000,
): Promise<Map<string, GeckoPool>> {
  const pools = new Map<string, GeckoPool>()
  for (let start = 0; start < addresses.length; start += poolsPerCall) {
    if (allowance.remaining <= 0) {
      throw new SourceError(
        "coingecko-onchain",
        null,
        "Per-run call cap reached",
      )
    }
    allowance.remaining -= 1
    const request = onchainPoolsRequest(
      network,
      addresses.slice(start, start + poolsPerCall),
      config,
    )
    poolsFrom(
      await getJson(
        fetcher,
        "coingecko-onchain",
        request.url,
        timeoutMs,
        request.headers,
      ),
      "coingecko",
      "coingecko-onchain",
      pools,
    )
  }
  return pools
}

// -- DefiLlama yields -------------------------------------------------------

const llamaChartSchema = z.object({
  status: z.literal("success"),
  data: z.array(
    z.object({
      timestamp: z.string(),
      tvlUsd: z.number().nullable(),
      apyBase: z.number().nullable(),
      apyReward: z.number().nullable(),
    }),
  ),
})

export type LlamaPoint = {
  at: string
  tvlUsd: string | null
  /** Percent a year, as DefiLlama computes it. */
  apyBase: string | null
  apyReward: string | null
}

/** The newest point of a DefiLlama yields pool's chart. */
export async function defillamaLatest(
  fetcher: Fetcher,
  pool: string,
  timeoutMs = 10_000,
): Promise<LlamaPoint | null> {
  const body = parse(
    llamaChartSchema,
    await getJson(
      fetcher,
      "defillama",
      `https://yields.llama.fi/chart/${pool}`,
      timeoutMs,
    ),
    "defillama",
  )
  const last = body.data[body.data.length - 1]
  if (last === undefined) return null
  return {
    at: last.timestamp,
    tvlUsd: numberText(last.tvlUsd),
    apyBase: signedText(last.apyBase),
    apyReward: signedText(last.apyReward),
  }
}

// -- Curve ------------------------------------------------------------------

const curveVolumesSchema = z.object({
  data: z.object({
    pools: z.array(
      z.object({
        address: z.string(),
        volumeUSD: z.number().nullish(),
      }),
    ),
  }),
})

/** Curve's own 24h volume per pool (GeckoTerminal undercounts metapools). */
export async function curveVolumes(
  fetcher: Fetcher,
  network: string,
  timeoutMs = 15_000,
): Promise<Map<string, string | null>> {
  const body = parse(
    curveVolumesSchema,
    await getJson(
      fetcher,
      "curve",
      `https://api.curve.finance/v1/getVolumes/${network}`,
      timeoutMs,
    ),
    "curve",
  )
  return new Map(
    body.data.pools.map((pool) => [
      pool.address.toLowerCase(),
      numberText(pool.volumeUSD),
    ]),
  )
}

// -- Merkl ------------------------------------------------------------------

const merklSchema = z.array(
  z.object({
    chainId: z.number().int(),
    type: z.string(),
    identifier: z.string(),
    name: z.string(),
    apr: z.number().nullish(),
    rewardsRecord: z
      .object({
        breakdowns: z.array(
          z.object({ token: z.object({ symbol: z.string() }) }),
        ),
      })
      .nullish(),
  }),
)

export type MerklOpportunity = {
  chainId: number
  type: string
  /** Lower case. */
  identifier: string
  name: string
  apr: string | null
  rewardTokens: string[]
}

/** Live Merkl opportunities matching `search` (filter by identifier). */
export async function merklOpportunities(
  fetcher: Fetcher,
  search: string,
  timeoutMs = 15_000,
): Promise<MerklOpportunity[]> {
  const body = parse(
    merklSchema,
    await getJson(
      fetcher,
      "merkl",
      `https://api.merkl.xyz/v4/opportunities?search=${encodeURIComponent(search)}&status=LIVE`,
      timeoutMs,
    ),
    "merkl",
  )
  return body.map((item) => ({
    chainId: item.chainId,
    type: item.type,
    identifier: item.identifier.toLowerCase(),
    name: item.name,
    apr: signedText(item.apr),
    rewardTokens: [
      ...new Set(
        (item.rewardsRecord?.breakdowns ?? []).map(
          (breakdown) => breakdown.token.symbol,
        ),
      ),
    ],
  }))
}

// -- Wormholescan -----------------------------------------------------------

const wormholescan = "https://api.wormholescan.io/api/v1/native-token-transfer"

const activitySchema = z.array(
  z.object({
    emitterChain: z.number().int(),
    destinationChain: z.number().int(),
    value: z.string(),
  }),
)

export type RouteTotal = {
  /** Wormhole chain ids. */
  from: number
  to: number
  transfers: number
  notionalUsd: string
}

/** All-time transfers and USD per route. */
export async function wormholeRouteTotals(
  fetcher: Fetcher,
  symbol: string,
  timeoutMs = 10_000,
): Promise<RouteTotal[]> {
  const query = (by: "tx" | "notional") =>
    getJson(
      fetcher,
      "wormholescan",
      `${wormholescan}/activity?symbol=${symbol}&by=${by}`,
      timeoutMs,
    ).then((body) => parse(activitySchema, body, "wormholescan"))
  const [byTx, byNotional] = await Promise.all([query("tx"), query("notional")])
  const key = (row: { emitterChain: number; destinationChain: number }) =>
    `${row.emitterChain}>${row.destinationChain}`
  const notional = new Map(byNotional.map((row) => [key(row), row.value]))
  return byTx.flatMap((row) => {
    const usd = notional.get(key(row)) ?? null
    if (!/^[0-9]+$/.test(row.value) || usd === null || !unsignedText.test(usd))
      return []
    return [
      {
        from: row.emitterChain,
        to: row.destinationChain,
        transfers: Number.parseInt(row.value, 10),
        notionalUsd: usd,
      },
    ]
  })
}

const byTimeSchema = z.array(z.object({ time: z.string(), value: z.string() }))

export type BridgeDay = { day: string; transfers: number; notionalUsd: string }

/** Transfers and USD per UTC day across every route, `fromDay` to `toDay`. */
export async function wormholeDaily(
  fetcher: Fetcher,
  symbol: string,
  fromDay: string,
  toDay: string,
  timeoutMs = 10_000,
): Promise<BridgeDay[]> {
  const query = (by: "tx" | "notional") =>
    getJson(
      fetcher,
      "wormholescan",
      `${wormholescan}/transfer-by-time?symbol=${symbol}&timeSpan=1d&by=${by}&from=${fromDay}T00:00:00Z&to=${toDay}T00:00:00Z`,
      timeoutMs,
    ).then((body) => parse(byTimeSchema, body, "wormholescan"))
  const [byTx, byNotional] = await Promise.all([query("tx"), query("notional")])
  const notional = new Map(
    byNotional.map((row) => [row.time.slice(0, 10), row.value]),
  )
  return byTx.flatMap((row) => {
    const day = row.time.slice(0, 10)
    const usd = notional.get(day) ?? null
    if (!/^[0-9]+$/.test(row.value) || usd === null || !unsignedText.test(usd))
      return []
    return [
      { day, transfers: Number.parseInt(row.value, 10), notionalUsd: usd },
    ]
  })
}
