import { CONTRACTS } from "@matchbox/chain"
import type {
  GaugeDetails,
  PoolKind,
  Prices,
  TokenAmount,
  TokenRef,
} from "@matchbox/contracts/read-models"
import { veLockState } from "@matchbox/domain"
import type { Logger } from "@matchbox/logger"
import {
  type Abi,
  type ContractFunctionParameters,
  getAddress,
  type PublicClient,
  parseAbi,
} from "viem"
import { z } from "zod"
import { btcTokenRef, fromRaw, sumUsd, usdValue } from "./money"
import { tokenRegistry } from "./token-registry"

// Each gauge kind's metadata, read from the chain once per gauge publish:
// veBTC lock owners, validator beneficiaries, pool reserves, staked share,
// fees and MEZO emission APR, the sMUSD savings rate, and where MEZO gauges
// send their MEZO (RemoteGaugeBeneficiary on Mezo bridges it over Wormhole
// NTT to a GaugeAllocator). Facts the chain does not hold come from the
// owner's `mezo_gauge_destinations` table in MARKET_DB.

const secondsPerYear = 31_536_000
const smusdAddress = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
const musdAddress = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
/** About seven days of Mezo blocks (3.85 s each): the savings-rate window. */
const savingsWindowBlocks = 157_000n

/** Every view the details read: gauges, pools, vaults, beneficiaries. */
const readAbi: Abi = parseAbi([
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function rewardsBeneficiary() view returns (address)",
  "function ownerOf(uint256) view returns (address)",
  "function getReserves() view returns (uint256, uint256, uint256)",
  "function factory() view returns (address)",
  "function stable() view returns (bool)",
  "function liquidity() view returns (uint128)",
  "function stakedLiquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
  "function getFee(address, bool) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function yieldIndex() view returns (uint256)",
  "function destinationChainId() view returns (uint16)",
  "function allocator() view returns (address)",
])

/** Wormhole chain ids MEZO gauges may bridge to. */
const wormholeChains: Readonly<Record<number, string>> = {
  2: "Ethereum",
  4: "BNB Chain",
  5: "Polygon",
  23: "Arbitrum",
  24: "Optimism",
  30: "Base",
}

/** What the publish knows about each gauge before chain reads. */
export type GaugeDetailsRequest =
  | {
      kind: "vebtc"
      gauge: string
      tokenId: string | null
      beneficiary: string | null
      vebtcWeight: string | null
      boost: string | null
      optimalVotes: string | null
      /** Raw locked BTC (18 decimals); null when unread. */
      locked: bigint | null
      /** `locked(tokenId)`; null when unread. */
      lock: { amount: bigint; end: bigint; isPermanent: boolean } | null
      /**
       * BoostVoter kills a gauge when its veBTC token is burned, so a killed
       * gauge whose lock cannot be read has nothing locked any more.
       */
      killed: boolean
    }
  | {
      kind: "validator"
      gauge: string
      operator: string | null
      moniker: string | null
    }
  | {
      kind: "pool"
      gauge: string
      pool: string
      poolKind: PoolKind | null
      tokens: TokenRef[]
      tickSpacing: number | null
    }
  | {
      kind: "mezo"
      gauge: string
      metadata: string | null
    }

export type GaugeDetailsReader = (
  requests: readonly GaugeDetailsRequest[],
  prices: Prices | null,
  nowSeconds: number,
) => Promise<Map<string, GaugeDetails>>

/** The owner's facts about a MEZO gauge (`mezo_gauge_destinations`). */
export type CuratedDestination = {
  chain: string | null
  protocol: string | null
  destination: string | null
  url: string | null
}

const curatedRowSchema = z.object({
  gauge_address: z.string(),
  chain: z.string().nullable(),
  protocol: z.string().nullable(),
  destination: z.string().nullable(),
  url: z.string().nullable(),
})

/** Venue and pool from ThirdPartyGaugeCreated metadata. */
export function destinationFromMetadata(metadata: string | null): {
  protocol: string | null
  destination: string | null
} {
  const remote = /^remote-gauge-(.+?)(?:-[0-9a-f]{8})?$/.exec(metadata ?? "")
  if (remote === null) return { protocol: null, destination: null }
  const parts = (remote[1] ?? "").split("-")
  const venue = parts.shift() ?? ""
  const version = /^v[0-9]+$/.test(parts[0] ?? "") ? parts.shift() : undefined
  const protocol = `${venue.charAt(0).toUpperCase()}${venue.slice(1)}${
    version === undefined ? "" : ` ${version}`
  }`
  const tokens: string[] = []
  const tail: string[] = []
  for (const part of parts) {
    const fee = /^fee([0-9]+)$/.exec(part)
    const cl = /^cl([0-9]+)$/.exec(part)
    if (fee !== null) tail.push(`${Number(fee[1]) / 10_000}%`)
    else if (cl !== null) tail.push(`CL${cl[1]}`)
    else if (/^[0-9]+pool$/.test(part)) tail.push(part)
    else tokens.push(part.toUpperCase())
  }
  const destination = [tokens.join("/"), ...tail].filter(Boolean).join(" ")
  return { protocol, destination: destination.length > 0 ? destination : null }
}

/** Percent with two decimals from a ratio scaled by 1e18. */
function percentOf(scaled: bigint): string {
  const cents = (scaled * 10_000n) / 10n ** 18n
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

function priceOf(token: TokenRef, prices: Prices | null): string | null {
  const pricing = tokenRegistry.get(token.address)?.pricing ?? null
  if (pricing === "usd") return "1"
  if (pricing === "btc") return prices?.btc?.usd ?? null
  if (pricing === "mezo") return prices?.mezo?.usd ?? null
  return null
}

function amountOf(
  token: TokenRef,
  raw: bigint,
  prices: Prices | null,
): TokenAmount {
  const amount = fromRaw(raw, token.decimals)
  const price = priceOf(token, prices)
  return { token, amount, usd: price === null ? null : usdValue(amount, price) }
}

/** USD as a 1e18-scaled integer, for ratios. */
function scaledUsd(usd: string): bigint {
  const [whole = "0", fraction = ""] = usd.split(".")
  return (
    BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0").slice(0, 18))
  )
}

export type GaugeDetailsDeps = {
  client: PublicClient
  /** MARKET_DB, for `mezo_gauge_destinations`; null skips curated facts. */
  db: D1Database | null
  network: string
  logger: Logger
}

async function readCurated(
  deps: GaugeDetailsDeps,
): Promise<Map<string, CuratedDestination>> {
  if (deps.db === null) return new Map()
  const result = await deps.db
    .prepare(
      "SELECT gauge_address, chain, protocol, destination, url FROM mezo_gauge_destinations WHERE network = ?",
    )
    .bind(deps.network)
    .all()
  const curated = new Map<string, CuratedDestination>()
  for (const raw of result.results) {
    const row = curatedRowSchema.safeParse(raw)
    if (!row.success) continue
    const url = z.url().safeParse(row.data.url)
    curated.set(row.data.gauge_address.toLowerCase(), {
      chain: row.data.chain,
      protocol: row.data.protocol,
      destination: row.data.destination,
      url: url.success ? url.data : null,
    })
  }
  return curated
}

type Call = ContractFunctionParameters

export function createGaugeDetailsReader(
  deps: GaugeDetailsDeps,
): GaugeDetailsReader {
  const vebtc = getAddress(CONTRACTS.mainnet.veBTC)
  return async function readDetails(requests, prices, nowSeconds) {
    const client = deps.client
    // Round one: everything that needs only addresses we already know.
    const calls: Call[] = []
    const slots = new Map<string, number>()
    const add = (key: string, call: Call) => {
      slots.set(key, calls.length)
      calls.push(call)
    }
    for (const request of requests) {
      const gauge = getAddress(request.gauge)
      switch (request.kind) {
        case "vebtc":
          if (request.tokenId !== null) {
            add(`${request.gauge}:owner`, {
              address: vebtc,
              abi: readAbi,
              functionName: "ownerOf",
              args: [BigInt(request.tokenId)],
            })
          }
          break
        case "validator":
          add(`${request.gauge}:beneficiary`, {
            address: gauge,
            abi: readAbi,
            functionName: "rewardsBeneficiary",
          })
          break
        case "mezo":
          add(`${request.gauge}:beneficiary`, {
            address: gauge,
            abi: readAbi,
            functionName: "rewardsBeneficiary",
          })
          break
        case "pool": {
          const pool = getAddress(request.pool)
          for (const name of ["rewardRate", "periodFinish", "totalSupply"]) {
            add(`${request.gauge}:gauge:${name}`, {
              address: gauge,
              abi: readAbi,
              functionName: name,
            })
          }
          const poolCalls =
            request.poolKind === "cl"
              ? ["liquidity", "stakedLiquidity", "fee"]
              : request.poolKind === "vault"
                ? ["totalSupply", "yieldIndex"]
                : ["getReserves", "totalSupply", "factory", "stable"]
          for (const name of poolCalls) {
            add(`${request.gauge}:pool:${name}`, {
              address: pool,
              abi: readAbi,
              functionName: name,
            })
          }
          if (request.poolKind === "cl") {
            request.tokens.forEach((token, index) => {
              add(`${request.gauge}:balance:${index}`, {
                address: getAddress(token.address),
                abi: readAbi,
                functionName: "balanceOf",
                args: [pool],
              })
            })
          }
          break
        }
      }
    }
    const [results, curated, head] = await Promise.all([
      client.multicall({ allowFailure: true, contracts: calls }),
      readCurated(deps).catch((error: unknown) => {
        deps.logger.warn({ message: "Curated MEZO gauges unavailable", error })
        return new Map<string, CuratedDestination>()
      }),
      client.getBlock().catch(() => null),
    ])
    const value = (key: string): unknown => {
      const slot = slots.get(key)
      const result = slot === undefined ? undefined : results[slot]
      return result?.status === "success" ? result.result : null
    }
    const big = (key: string): bigint | null => {
      const result = value(key)
      return typeof result === "bigint" ? result : null
    }
    const address = (key: string): string | null => {
      const result = value(key)
      return typeof result === "string" ? result.toLowerCase() : null
    }

    // Round two: classic fees, MEZO beneficiaries' destinations, and the
    // sMUSD savings index a week back.
    const second: Call[] = []
    const secondSlots = new Map<string, number>()
    const addSecond = (key: string, call: Call) => {
      secondSlots.set(key, second.length)
      second.push(call)
    }
    for (const request of requests) {
      if (
        request.kind === "pool" &&
        (request.poolKind === "vamm" || request.poolKind === "samm")
      ) {
        const factory = address(`${request.gauge}:pool:factory`)
        const stable = value(`${request.gauge}:pool:stable`)
        if (factory !== null && typeof stable === "boolean") {
          addSecond(`${request.gauge}:fee`, {
            address: getAddress(factory),
            abi: readAbi,
            functionName: "getFee",
            args: [getAddress(request.pool), stable],
          })
        }
      }
      if (request.kind === "mezo") {
        const beneficiary = address(`${request.gauge}:beneficiary`)
        if (beneficiary !== null) {
          for (const name of ["destinationChainId", "allocator"]) {
            addSecond(`${request.gauge}:${name}`, {
              address: getAddress(beneficiary),
              abi: readAbi,
              functionName: name,
            })
          }
        }
      }
    }
    const secondResults =
      second.length === 0
        ? []
        : await client
            .multicall({ allowFailure: true, contracts: second })
            .catch(() => [])
    const secondValue = (key: string): unknown => {
      const slot = secondSlots.get(key)
      const result = slot === undefined ? undefined : secondResults[slot]
      return result?.status === "success" ? result.result : null
    }
    const vaults = requests.filter(
      (request) => request.kind === "pool" && request.poolKind === "vault",
    )
    const past = new Map<string, { index: bigint; timestamp: bigint }>()
    if (
      vaults.length > 0 &&
      head !== null &&
      head.number > savingsWindowBlocks
    ) {
      try {
        const blockNumber = head.number - savingsWindowBlocks
        const [block, ...indices] = await Promise.all([
          client.getBlock({ blockNumber }),
          // A vault without yieldIndex (mlvBTC-mUSDC) must not sink the rest.
          ...vaults.map((request) =>
            request.kind === "pool"
              ? client
                  .readContract({
                    address: getAddress(request.pool),
                    abi: readAbi,
                    functionName: "yieldIndex",
                    blockNumber,
                  })
                  .catch(() => null)
              : Promise.resolve(null),
          ),
        ])
        vaults.forEach((request, index) => {
          const pastIndex = indices[index]
          if (typeof pastIndex === "bigint") {
            past.set(request.gauge, {
              index: pastIndex,
              timestamp: block.timestamp,
            })
          }
        })
      } catch (error) {
        deps.logger.warn({
          message: "Savings index history unavailable",
          error,
        })
      }
    }

    const details = new Map<string, GaugeDetails>()
    const mezoPrice = prices?.mezo?.usd ?? null
    for (const request of requests) {
      switch (request.kind) {
        case "vebtc": {
          details.set(request.gauge, {
            kind: "vebtc",
            tokenId: request.tokenId,
            owner: address(`${request.gauge}:owner`),
            beneficiary: request.beneficiary,
            lock:
              request.lock === null
                ? request.killed
                  ? { state: "withdrawn", unlocksAt: null, amount: "0" }
                  : null
                : (() => {
                    const state = veLockState(request.lock, nowSeconds)
                    return {
                      state,
                      unlocksAt:
                        state === "auto-max" || state === "withdrawn"
                          ? null
                          : Number(request.lock.end),
                      amount: fromRaw(request.lock.amount, 18),
                    }
                  })(),
            vebtcWeight: request.vebtcWeight,
            boost: request.boost,
            optimalVotes: request.optimalVotes,
            locked:
              request.locked === null
                ? null
                : amountOf(btcTokenRef, request.locked, prices),
          })
          break
        }
        case "validator":
          details.set(request.gauge, {
            kind: "validator",
            operator: request.operator,
            status: request.operator === null ? "left" : "active",
            moniker: request.moniker,
            beneficiary: address(`${request.gauge}:beneficiary`),
            votingPower: null,
            commission: null,
          })
          break
        case "mezo": {
          const fromMetadata = destinationFromMetadata(request.metadata)
          const chainId = secondValue(`${request.gauge}:destinationChainId`)
          const allocator = secondValue(`${request.gauge}:allocator`)
          const wormholeChainId = typeof chainId === "number" ? chainId : null
          const owner = curated.get(request.gauge)
          details.set(request.gauge, {
            kind: "mezo",
            chain:
              owner?.chain ??
              (wormholeChainId === null
                ? null
                : (wormholeChains[wormholeChainId] ??
                  `Wormhole chain ${wormholeChainId}`)),
            protocol: owner?.protocol ?? fromMetadata.protocol,
            wormholeChainId,
            destination: owner?.destination ?? fromMetadata.destination,
            recipient: address(`${request.gauge}:beneficiary`),
            allocator:
              typeof allocator === "string" ? allocator.toLowerCase() : null,
            bridge: wormholeChainId === null ? null : "Wormhole NTT",
            metadata: request.metadata,
            source:
              owner !== undefined
                ? "curated"
                : wormholeChainId !== null
                  ? "chain"
                  : "metadata",
            url: owner?.url ?? null,
          })
          break
        }
        case "pool": {
          const key = request.gauge
          let reserves: TokenAmount[] = []
          let staked: bigint | null = null
          let feePercent: string | null = null
          let savingsApr: string | null = null
          const gaugeSupply = big(`${key}:gauge:totalSupply`)
          if (request.poolKind === "cl") {
            reserves = request.tokens.flatMap((token, index) => {
              const raw = big(`${key}:balance:${index}`)
              return raw === null ? [] : [amountOf(token, raw, prices)]
            })
            const liquidity = big(`${key}:pool:liquidity`)
            const stakedLiquidity = big(`${key}:pool:stakedLiquidity`)
            if (
              liquidity !== null &&
              stakedLiquidity !== null &&
              liquidity > 0n
            ) {
              staked = (stakedLiquidity * 10n ** 18n) / liquidity
            }
            const fee = value(`${key}:pool:fee`)
            if (typeof fee === "number") feePercent = String(fee / 10_000)
          } else if (request.poolKind === "vault") {
            const supply = big(`${key}:pool:totalSupply`)
            const token = request.tokens[0]
            if (supply !== null && token !== undefined) {
              // sMUSD holds its MUSD principal 1:1 and pays yield apart, so
              // its supply is MUSD; other vaults count in their own token.
              const musd = tokenRegistry.get(musdAddress)?.token
              const principal =
                token.address === smusdAddress && musd !== undefined
                  ? musd
                  : token
              reserves = [amountOf(principal, supply, prices)]
              if (gaugeSupply !== null && supply > 0n) {
                staked = (gaugeSupply * 10n ** 18n) / supply
              }
            }
            const index = big(`${key}:pool:yieldIndex`)
            const before = past.get(key)
            if (index !== null && before !== undefined && head !== null) {
              const elapsed = head.timestamp - before.timestamp
              if (elapsed > 0n && index >= before.index) {
                savingsApr = percentOf(
                  ((index - before.index) * BigInt(secondsPerYear)) / elapsed,
                )
              }
            }
          } else {
            const reserveTuple = value(`${key}:pool:getReserves`)
            if (Array.isArray(reserveTuple)) {
              reserves = request.tokens.flatMap((token, index) => {
                const raw = reserveTuple[index]
                return typeof raw === "bigint"
                  ? [amountOf(token, raw, prices)]
                  : []
              })
            }
            const supply = big(`${key}:pool:totalSupply`)
            if (gaugeSupply !== null && supply !== null && supply > 0n) {
              staked = (gaugeSupply * 10n ** 18n) / supply
            }
            const fee = secondValue(`${key}:fee`)
            if (typeof fee === "bigint") feePercent = String(Number(fee) / 100)
          }
          const priced =
            reserves.length > 0 &&
            reserves.every((reserve) => reserve.usd !== null)
          const tvlUsd = priced
            ? sumUsd(
                reserves.flatMap((reserve) =>
                  reserve.usd === null ? [] : [reserve.usd],
                ),
              )
            : null
          const rewardRate = big(`${key}:gauge:rewardRate`)
          const periodFinish = big(`${key}:gauge:periodFinish`)
          let emissionApr: string | null = null
          if (
            tvlUsd !== null &&
            staked !== null &&
            staked > 0n &&
            rewardRate !== null &&
            mezoPrice !== null &&
            periodFinish !== null &&
            periodFinish > BigInt(nowSeconds)
          ) {
            const stakedUsd = (scaledUsd(tvlUsd) * staked) / 10n ** 18n
            if (stakedUsd > 0n) {
              const yearlyUsd =
                (rewardRate * BigInt(secondsPerYear) * scaledUsd(mezoPrice)) /
                10n ** 18n
              emissionApr = percentOf((yearlyUsd * 10n ** 18n) / stakedUsd)
            }
          }
          details.set(key, {
            kind: "pool",
            poolKind: request.poolKind,
            pool: request.pool,
            tvlUsd,
            emissionApr,
            tokens: request.tokens,
            tickSpacing: request.tickSpacing,
            feePercent,
            reserves,
            stakedPercent: staked === null ? null : percentOf(staked),
            savingsApr,
          })
          break
        }
      }
    }
    return details
  }
}
