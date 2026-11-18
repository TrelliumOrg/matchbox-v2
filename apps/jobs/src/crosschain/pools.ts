import {
  type CrossChain,
  type CrossChainPool,
  crossChainPools,
  crossChains,
} from "@matchbox/chain"
import { feeAprPercent } from "@matchbox/domain/market-price"
import type { Logger } from "@matchbox/logger"
import { maxKeyedPoolCallsPerRun } from "../coingecko-budget"
import type { JsonRow } from "../scan/statements"
import {
  coingeckoOnchainPools,
  curveVolumes,
  defillamaLatest,
  type Fetcher,
  type GeckoPool,
  geckoTerminalPools,
  type KeyedCoinGecko,
  type LlamaPoint,
  type MerklOpportunity,
  merklOpportunities,
} from "./sources"

// A daily snapshot of every tracked pool: depth and 24h volume, and APR
// split into fees, the venue's own rewards, Merkl campaigns and the
// Matchbox gauge's MEZO. Rewritten each hour, so today's row is current
// and earlier rows are the day's last reading; a week of rows gives the
// 7-day figures. Each figure says where it came from; an absent one says
// why (never 0).
//
// Sources by venue:
// - TVL and volume: GeckoTerminal's data, through CoinGecko's keyed onchain
//   endpoint when this run may use the key, else (or when that fails)
//   GeckoTerminal's keyless API; Curve's volume from Curve's API
//   (GeckoTerminal misses swaps routed through the metapool's base pool);
//   sMUSD's TVL from DefiLlama.
// - Fees: DefiLlama's apyBase where it tracks the pool (Curve, Uniswap v4
//   USDC/MUSD, sMUSD's savings rate); otherwise an estimate from 24h volume
//   × fee on a fixed-fee pool. Aerodrome: not available.
// - Rewards: DefiLlama's apyReward (CRV on Curve). Tigris MEZO emissions
//   are added by the API from Pro's gauge documents.
// - Merkl: live opportunities whose identifier is the pool (filtered by
//   chain id and address, never by symbol), the direct-LP one.
// - Gauge: the MEZO a Matchbox gauge sends is not yet an APR (see README).

export type PoolInputs = {
  gecko: Map<CrossChain, Map<string, GeckoPool>>
  curve: Map<string, string | null> | null
  llama: Map<string, LlamaPoint | null>
  merkl: MerklOpportunity[] | null
  /**
   * Sources that failed this run, by name. `depth:{chain}`: neither depth
   * source answered for that chain, so its pools are left out.
   */
  failed: Set<string>
}

const aeroApr = "Aerodrome's new gauges revert on rewardRate; APR not available"

/** The Merkl APR for holding this pool's position directly. */
function merklApr(
  pool: CrossChainPool,
  merkl: readonly MerklOpportunity[],
): { apr: string; tokens: string[] } | null {
  if (pool.merklIdentifier === null) return null
  const chainId = crossChains[pool.chain].chainId
  const matching = merkl.filter(
    (item) =>
      item.chainId === chainId &&
      item.identifier === pool.merklIdentifier?.toLowerCase() &&
      item.type !== "CONVEX" &&
      item.apr !== null,
  )
  const best = matching[0]
  return best === undefined || best.apr === null
    ? null
    : { apr: best.apr, tokens: best.rewardTokens }
}

export function poolRow(
  pool: CrossChainPool,
  inputs: PoolInputs,
  day: string,
  nowSeconds: number,
): JsonRow {
  const sources: Record<string, string> = {}
  const unavailable: Record<string, string> = {}
  const gecko = inputs.gecko.get(pool.chain)?.get(pool.address.toLowerCase())
  const llama =
    pool.defillamaPool === null
      ? null
      : (inputs.llama.get(pool.defillamaPool) ?? null)

  let tvl: string | null = gecko?.tvlUsd ?? null
  if (tvl !== null && gecko !== undefined) sources.tvl_usd = gecko.source
  else if (llama?.tvlUsd != null) {
    tvl = llama.tvlUsd
    sources.tvl_usd = "defillama"
  } else unavailable.tvl_usd = "No source lists this pool's TVL"

  let volume: string | null = null
  if (pool.venue === "curve") {
    volume = inputs.curve?.get(pool.address.toLowerCase()) ?? null
    if (volume !== null) sources.volume_24h_usd = "curve"
  } else if (pool.venue === "mezo-savings") {
    unavailable.volume_24h_usd = "A savings vault has no swap volume"
  } else {
    volume = gecko?.volume24hUsd ?? null
    if (volume !== null && gecko !== undefined) {
      sources.volume_24h_usd = gecko.source
    }
  }
  if (volume === null && unavailable.volume_24h_usd === undefined) {
    unavailable.volume_24h_usd = "Volume source unavailable this run"
  }

  let fees: string | null = null
  let rewards: string | null = null
  let merkl: string | null = null
  if (pool.venue === "aerodrome") {
    unavailable.apr_fees = aeroApr
    unavailable.apr_rewards = aeroApr
  } else {
    if (llama?.apyBase != null) {
      fees = llama.apyBase
      sources.apr_fees =
        pool.venue === "mezo-savings" ? "defillama (savings rate)" : "defillama"
    } else if (pool.feeBps !== null && volume !== null && tvl !== null) {
      fees = feeAprPercent(volume, pool.feeBps, tvl)
      if (fees !== null) {
        sources.apr_fees = "estimate: 24h volume x fee / TVL"
      }
    }
    if (fees === null) {
      unavailable.apr_fees =
        pool.feeBps === null
          ? "Fee rate not tracked for this pool"
          : "No volume or TVL to estimate from"
    }
    if (llama?.apyReward != null) {
      rewards = llama.apyReward
      sources.apr_rewards = "defillama"
    } else if (pool.venue === "tigris") {
      unavailable.apr_rewards = "Added by the API from Pro's gauge documents"
    } else {
      unavailable.apr_rewards = "No venue rewards reported"
    }
  }
  if (inputs.merkl === null) {
    unavailable.apr_merkl = "Merkl unavailable this run"
  } else {
    const found = merklApr(pool, inputs.merkl)
    if (found === null) unavailable.apr_merkl = "No live Merkl campaign"
    else {
      merkl = found.apr
      sources.apr_merkl = `merkl (${found.tokens.join(", ") || "rewards"})`
    }
  }
  unavailable.apr_gauge =
    "The MEZO a Matchbox gauge sends is not converted to an APR yet"

  return {
    pool_id: pool.id,
    day,
    tvl_usd: tvl,
    volume_24h_usd: volume,
    apr_fees: fees,
    apr_rewards: rewards,
    apr_merkl: merkl,
    apr_gauge: null,
    sources: JSON.stringify(sources),
    unavailable: JSON.stringify(unavailable),
    updated_at: nowSeconds,
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "Unknown error"
}

/** A failure's reason with the key cut out, should any message carry it. */
function redacted(reason: string, key: string | null): string {
  return key === null || key.length === 0
    ? reason
    : reason.split(key).join("[key]")
}

export type PoolInputOptions = {
  /**
   * CoinGecko with a key, when this run may spend keyed calls on pool
   * depth (README "CoinGecko call budget"); null reads GeckoTerminal only.
   */
  keyed?: KeyedCoinGecko | null
  /** Keyed calls this run may make. */
  maxKeyedCalls?: number
}

/**
 * Pool depth for one chain: CoinGecko's keyed onchain endpoint first when
 * allowed, then GeckoTerminal keyless. Null when neither answered.
 */
async function depthFor(
  fetcher: Fetcher,
  logger: Logger,
  chain: CrossChain,
  network: string,
  addresses: readonly string[],
  keyed: KeyedCoinGecko | null,
  allowance: { remaining: number },
): Promise<Map<string, GeckoPool> | null> {
  if (keyed !== null) {
    try {
      return await coingeckoOnchainPools(
        fetcher,
        network,
        addresses,
        keyed,
        allowance,
      )
    } catch (error) {
      logger.warn({
        message: "Pool depth read failed; trying GeckoTerminal keyless",
        chain,
        source: "coingecko-onchain",
        reason: redacted(reasonOf(error), keyed.apiKey),
      })
    }
  }
  try {
    return await geckoTerminalPools(fetcher, network, addresses)
  } catch (error) {
    logger.warn({
      message: "Pool depth read failed",
      chain,
      source: "geckoterminal",
      reason: redacted(reasonOf(error), keyed?.apiKey ?? null),
    })
    return null
  }
}

/**
 * Fetches every source, each failure isolated: at most 3 keyed CoinGecko
 * calls (one a chain), then about 9 keyless ones.
 */
export async function fetchPoolInputs(
  fetcher: Fetcher,
  logger: Logger,
  options: PoolInputOptions = {},
): Promise<PoolInputs> {
  const keyed = options.keyed ?? null
  const allowance = {
    remaining: Math.min(
      options.maxKeyedCalls ?? maxKeyedPoolCallsPerRun,
      maxKeyedPoolCallsPerRun,
    ),
  }
  const failed = new Set<string>()
  const byChain = new Map<CrossChain, string[]>()
  for (const pool of crossChainPools) {
    if (pool.venue === "mezo-savings") continue
    const list = byChain.get(pool.chain) ?? []
    list.push(pool.address.toLowerCase())
    byChain.set(pool.chain, list)
  }
  const gecko = new Map<CrossChain, Map<string, GeckoPool>>()
  for (const [chain, addresses] of byChain) {
    const network = crossChains[chain].geckoterminalNetwork
    if (network === null) continue
    const depth = await depthFor(
      fetcher,
      logger,
      chain,
      network,
      addresses,
      keyed,
      allowance,
    )
    if (depth === null) failed.add(`depth:${chain}`)
    else gecko.set(chain, depth)
  }
  const llama = new Map<string, LlamaPoint | null>()
  for (const pool of crossChainPools) {
    if (pool.defillamaPool === null) continue
    try {
      llama.set(
        pool.defillamaPool,
        await defillamaLatest(fetcher, pool.defillamaPool),
      )
    } catch (error) {
      failed.add(`defillama:${pool.id}`)
      logger.warn({
        message: "DefiLlama read failed",
        pool: pool.id,
        reason: reasonOf(error),
      })
    }
  }
  let curve: Map<string, string | null> | null = null
  try {
    curve = await curveVolumes(fetcher, "ethereum")
  } catch (error) {
    failed.add("curve")
    logger.warn({ message: "Curve read failed", reason: reasonOf(error) })
  }
  let merkl: MerklOpportunity[] | null = null
  try {
    merkl = await merklOpportunities(fetcher, "MUSD")
  } catch (error) {
    failed.add("merkl")
    logger.warn({ message: "Merkl read failed", reason: reasonOf(error) })
  }
  return { gecko, curve, llama, merkl, failed }
}

/** Chains whose pools get a depth read: one keyed call each. */
export function poolDepthChains(): CrossChain[] {
  return [
    ...new Set(
      crossChainPools
        .filter(
          (pool) =>
            pool.venue !== "mezo-savings" &&
            crossChains[pool.chain].geckoterminalNetwork !== null,
        )
        .map((pool) => pool.chain),
    ),
  ]
}

/**
 * Rows for the pools whose depth source answered. A pool whose source
 * failed this run is left out, so today's earlier reading stands rather
 * than being overwritten with nulls.
 */
export function poolRows(
  inputs: PoolInputs,
  day: string,
  nowSeconds: number,
): JsonRow[] {
  return crossChainPools
    .filter((pool) =>
      pool.venue === "mezo-savings"
        ? !inputs.failed.has(`defillama:${pool.id}`)
        : !inputs.failed.has(`depth:${pool.chain}`),
    )
    .map((pool) => poolRow(pool, inputs, day, nowSeconds))
}
