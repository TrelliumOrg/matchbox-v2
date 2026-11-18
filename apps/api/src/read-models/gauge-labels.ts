import type { Gauge } from "@matchbox/contracts/market"
import { type TokenRef, tokenRefSchema } from "@matchbox/contracts/read-models"
import type { Logger } from "@matchbox/logger"
import {
  decodeEventLog,
  getAddress,
  type Hex,
  isHex,
  type PublicClient,
  parseAbi,
} from "viem"
import { z } from "zod"
import { tokenRefFor } from "./token-registry"

// Names and pictures for gauges the voters do not describe: concentrated
// liquidity pools (CLGauge has pool(), and its pool no symbol()), classic
// pools of tokens the read models do not know, vault gauges (sMUSD) and
// ThirdPartyVoter's cross-chain gauges (named by the metadata string their
// ThirdPartyGaugeCreated event carries). Labels never change, so each gauge
// is resolved once and kept in MARKET_DB (`gauge_labels`).

export const gaugeLabelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pair"),
    poolType: z.enum(["volatile", "stable", "cl"]),
    tickSpacing: z.number().int().positive().nullable(),
    tokens: z.tuple([tokenRefSchema, tokenRefSchema]),
  }),
  z.object({ type: z.literal("vault"), token: tokenRefSchema }),
  z.object({
    type: z.literal("named"),
    name: z.string().min(1),
    /** ThirdPartyGaugeCreated metadata, verbatim. */
    metadata: z.string(),
  }),
])

export type GaugeLabel = z.infer<typeof gaugeLabelSchema>

/** Labels by gauge address for the gauges asked about. */
export type GaugeLabelReader = (
  gauges: readonly Gauge[],
) => Promise<Map<string, GaugeLabel>>

const thirdPartyVoter = "0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb"
const thirdPartyGaugeCreated = parseAbi([
  "event ThirdPartyGaugeCreated(address indexed thirdParty, address indexed gauge, string metadata)",
])
const thirdPartyTopic =
  "0x944858a9606b2ae5e9b37d333fb8f4a090c8fb4baaba9348ba783ebb2951d875"
const blockscoutLogsUrl = `https://api.explorer.mezo.org/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${thirdPartyVoter}&topic0=${thirdPartyTopic}`

const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function tickSpacing() view returns (int24)",
  "function stable() view returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
])

const venues: Readonly<Record<string, string>> = {
  aerodrome: "Aerodrome",
  velodrome: "Velodrome",
  uniswap: "Uniswap",
  curve: "Curve",
  balancer: "Balancer",
  pancakeswap: "PancakeSwap",
}

const tokenCase: Readonly<Record<string, string>> = {
  btc: "BTC",
  cbbtc: "cbBTC",
  tbtc: "tBTC",
  wbtc: "WBTC",
  eth: "ETH",
  weth: "WETH",
  mezo: "MEZO",
  musd: "MUSD",
  usdc: "USDC",
  usdt: "USDT",
}

function titleWord(word: string): string {
  if (word.length <= 3) return word.toUpperCase()
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * A display name from ThirdPartyGaugeCreated metadata:
 * "remote-gauge-aerodrome-mezo-musd-cl200-ef458a32" → "Aerodrome MEZO/MUSD
 * CL200", "remote-gauge-uniswap-v4-usdc-musd-fee100-…" → "Uniswap v4
 * USDC/MUSD 0.01%", "snf-community" → "SNF Community". Free text that
 * already reads as a name ("Mezo Technical") is kept.
 */
export function crossChainName(metadata: string): string {
  const text = metadata.trim()
  if (/[A-Z\s]/.test(text) || !/^[a-z0-9-]+$/.test(text)) return text
  const remote = /^remote-gauge-(.+?)(?:-[0-9a-f]{8})?$/.exec(text)
  if (remote === null) return text.split("-").map(titleWord).join(" ")
  const parts = (remote[1] ?? "").split("-")
  const venueKey = parts.shift() ?? ""
  const words = [venues[venueKey] ?? titleWord(venueKey)]
  if (/^v[0-9]+$/.test(parts[0] ?? "")) words.push(parts.shift() ?? "")
  const tokens: string[] = []
  const tail: string[] = []
  for (const part of parts) {
    const fee = /^fee([0-9]+)$/.exec(part)
    const cl = /^cl([0-9]+)$/.exec(part)
    if (fee !== null) tail.push(`${Number(fee[1]) / 10_000}%`)
    else if (cl !== null) tail.push(`CL${cl[1]}`)
    else if (/^[0-9]+pool$/.test(part)) tail.push(part)
    else if (tail.length === 0) {
      tokens.push(tokenCase[part] ?? part.toUpperCase())
    } else tail.push(part)
  }
  if (tokens.length > 0) words.push(tokens.join("/"))
  return [...words, ...tail].join(" ")
}

const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && isHex(value),
  "Expected hex",
)

const metadataLogsSchema = z.object({
  status: z.string(),
  result: z.array(
    z.object({
      data: hexSchema,
      topics: z.array(hexSchema.nullable()),
      blockNumber: hexSchema,
    }),
  ),
})

/** Cross-chain gauge names from Blockscout's indexed logs, in creation order. */
export async function readCrossChainNames(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Map<string, { name: string; metadata: string }>> {
  const response = await fetcher(blockscoutLogsUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Blockscout answered ${response.status}`)
  const body = metadataLogsSchema.parse(await response.json())
  const created = body.result
    .map((log) => {
      const [signature, ...rest] = log.topics.flatMap((topic) =>
        topic === null ? [] : [topic],
      )
      if (signature === undefined) return null
      const decoded = decodeEventLog({
        abi: thirdPartyGaugeCreated,
        data: log.data,
        topics: [signature, ...rest],
      })
      return {
        gauge: decoded.args.gauge.toLowerCase(),
        name: crossChainName(decoded.args.metadata),
        metadata: decoded.args.metadata,
        block: Number.parseInt(log.blockNumber, 16),
      }
    })
    .flatMap((entry) => (entry === null ? [] : [entry]))
    .sort((left, right) => left.block - right.block)
  // Two gauges with one metadata string ("snf-community") get numbered.
  const seen = new Map<string, number>()
  const names = new Map<string, { name: string; metadata: string }>()
  for (const entry of created) {
    const count = (seen.get(entry.name) ?? 0) + 1
    seen.set(entry.name, count)
    names.set(entry.gauge, {
      name: count === 1 ? entry.name : `${entry.name} ${count}`,
      metadata: entry.metadata,
    })
  }
  return names
}

/** "Cross-chain 0x2ced…9a1d", for cross-chain gauges without a name. */
export function crossChainFallbackName(address: string): string {
  return `Cross-chain ${address.slice(0, 6)}…${address.slice(-4)}`
}

/** True when the pool symbol already names a pair of known tokens. */
export type KnownPair = (symbol: string | null) => boolean

/** Reads pairs and vaults behind pool gauges with one multicall round. */
async function readPoolLabels(
  client: PublicClient,
  pools: readonly { gauge: string; pool: string }[],
): Promise<Map<string, GaugeLabel>> {
  const labels = new Map<string, GaugeLabel>()
  if (pools.length === 0) return labels
  const shape = await client.multicall({
    allowFailure: true,
    contracts: pools.flatMap(({ pool }) =>
      (
        [
          "token0",
          "token1",
          "tickSpacing",
          "stable",
          "symbol",
          "decimals",
        ] as const
      ).map((functionName) => ({
        address: getAddress(pool),
        abi: pairAbi,
        functionName,
      })),
    ),
  })
  const at = (index: number) => {
    const result = shape[index]
    return result?.status === "success" ? result.result : null
  }
  const tokenAddresses = new Set<string>()
  pools.forEach((_, index) => {
    const token0 = at(index * 6)
    const token1 = at(index * 6 + 1)
    if (typeof token0 === "string") tokenAddresses.add(token0.toLowerCase())
    if (typeof token1 === "string") tokenAddresses.add(token1.toLowerCase())
  })
  const tokens = [...tokenAddresses]
  const meta = await client.multicall({
    allowFailure: true,
    contracts: tokens.flatMap((token) =>
      (["symbol", "decimals"] as const).map((functionName) => ({
        address: getAddress(token),
        abi: pairAbi,
        functionName,
      })),
    ),
  })
  const refs = new Map<string, TokenRef>()
  tokens.forEach((token, index) => {
    const symbol = meta[index * 2]
    const decimals = meta[index * 2 + 1]
    const ref = tokenRefFor(
      token,
      symbol?.status === "success" && typeof symbol.result === "string"
        ? symbol.result
        : null,
      decimals?.status === "success" && typeof decimals.result === "number"
        ? decimals.result
        : null,
    )
    if (ref !== null) refs.set(token, ref)
  })
  pools.forEach(({ gauge, pool }, index) => {
    const token0 = at(index * 6)
    const token1 = at(index * 6 + 1)
    const tickSpacing = at(index * 6 + 2)
    const stable = at(index * 6 + 3)
    const symbol = at(index * 6 + 4)
    const decimals = at(index * 6 + 5)
    if (typeof token0 === "string" && typeof token1 === "string") {
      const first = refs.get(token0.toLowerCase())
      const second = refs.get(token1.toLowerCase())
      if (first === undefined || second === undefined) return
      const isCl = typeof tickSpacing === "number"
      labels.set(gauge, {
        type: "pair",
        poolType: isCl ? "cl" : stable === true ? "stable" : "volatile",
        tickSpacing: isCl && tickSpacing > 0 ? tickSpacing : null,
        tokens: [first, second],
      })
      return
    }
    // No pair: a single-token vault (sMUSD) staked in the gauge.
    const token = tokenRefFor(
      pool,
      typeof symbol === "string" ? symbol : null,
      typeof decimals === "number" ? decimals : null,
    )
    if (token !== null) labels.set(gauge, { type: "vault", token })
  })
  return labels
}

const labelRowSchema = z.object({
  gauge_address: z.string(),
  label: z.string(),
})

export type GaugeLabelDeps = {
  /** MARKET_DB. */
  db: D1Database
  network: string
  client: PublicClient
  fetcher: (url: string, init: RequestInit) => Promise<Response>
  knownPair: KnownPair
  logger: Logger
}

async function readStoredLabels(
  db: D1Database,
  network: string,
): Promise<Map<string, GaugeLabel>> {
  const result = await db
    .prepare("SELECT gauge_address, label FROM gauge_labels WHERE network = ?")
    .bind(network)
    .all()
  const labels = new Map<string, GaugeLabel>()
  for (const raw of result.results) {
    const row = labelRowSchema.safeParse(raw)
    if (!row.success) continue
    let json: unknown
    try {
      json = JSON.parse(row.data.label)
    } catch {
      continue
    }
    const label = gaugeLabelSchema.safeParse(json)
    if (label.success) labels.set(row.data.gauge_address, label.data)
  }
  return labels
}

/**
 * Stored labels plus any new ones resolved now (one write per new gauge).
 * A failed chain or Blockscout read leaves those gauges for the next run.
 */
export function createGaugeLabelReader(deps: GaugeLabelDeps): GaugeLabelReader {
  return async function readLabels(gauges) {
    const labels = await readStoredLabels(deps.db, deps.network).catch(
      (error: unknown) => {
        deps.logger.warn({ message: "Gauge labels unavailable", error })
        return null
      },
    )
    if (labels === null) return new Map()
    const pools = gauges.flatMap((gauge) =>
      gauge.voter === "pools" &&
      !labels.has(gauge.gaugeAddress) &&
      !deps.knownPair(gauge.poolSymbol)
        ? [{ gauge: gauge.gaugeAddress, pool: gauge.poolAddress }]
        : [],
    )
    const unnamed = gauges.filter(
      (gauge) =>
        gauge.voter === "third-party" && !labels.has(gauge.gaugeAddress),
    )
    const fresh = new Map<string, GaugeLabel>()
    if (pools.length > 0) {
      try {
        for (const [gauge, label] of await readPoolLabels(deps.client, pools)) {
          fresh.set(gauge, label)
        }
      } catch (error) {
        deps.logger.warn({ message: "Pool gauge labels failed", error })
      }
    }
    if (unnamed.length > 0) {
      try {
        const names = await readCrossChainNames(deps.fetcher)
        for (const gauge of unnamed) {
          const named = names.get(gauge.gaugeAddress)
          if (named !== undefined) {
            fresh.set(gauge.gaugeAddress, { type: "named", ...named })
          }
        }
      } catch (error) {
        deps.logger.warn({ message: "Cross-chain gauge names failed", error })
      }
    }
    if (fresh.size > 0) {
      const now = Math.floor(Date.now() / 1000)
      await deps.db
        .batch(
          [...fresh].map(([gauge, label]) =>
            deps.db
              .prepare(
                "INSERT OR IGNORE INTO gauge_labels (network, gauge_address, label, created_at) VALUES (?, ?, ?, ?)",
              )
              .bind(deps.network, gauge, JSON.stringify(label), now),
          ),
        )
        .catch((error: unknown) => {
          deps.logger.warn({ message: "Gauge label write failed", error })
        })
      for (const [gauge, label] of fresh) labels.set(gauge, label)
    }
    return labels
  }
}
