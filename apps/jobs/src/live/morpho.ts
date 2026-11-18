import {
  ADAPTIVE_CURVE_IRM_ABI,
  BORROW_CONTRACTS,
  MORPHO_BLUE_ABI,
  MORPHO_BLUE_DEPLOY_BLOCK,
  MORPHO_BLUE_EVENTS_ABI,
  MORPHO_ORACLE_ABI,
} from "@matchbox/chain"
import type { Logger } from "@matchbox/logger"
import {
  type AbiEvent,
  type Address,
  erc20Abi,
  getAddress,
  type Hex,
  isHex,
  type PublicClient,
} from "viem"
import { z } from "zod"

// Morpho Blue on Mezo: market totals and every account's position, read
// with Multicall3 at one block. Accounts are discovered from Supply, Borrow
// and SupplyCollateral logs and markets from CreateMarket logs, in one
// log scan of a bounded number of 10,000-block windows per run, so the
// first scan from deployment spreads over a few runs.

const morpho = BORROW_CONTRACTS.mainnet.morphoBlue
const logWindow = 10_000n
const event = (name: string) =>
  MORPHO_BLUE_EVENTS_ABI.filter(
    (item) => item.type === "event" && item.name === name,
  )
const accountEvents = [
  ...event("Supply"),
  ...event("Borrow"),
  ...event("SupplyCollateral"),
]
const createMarketEvents = event("CreateMarket")

export type MorphoMarketState = {
  marketId: Hex
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
  totalSupplyAssets: bigint
  totalSupplyShares: bigint
  totalBorrowAssets: bigint
  totalBorrowShares: bigint
  lastUpdate: bigint
  fee: bigint
  borrowRate: bigint | null
  oraclePrice: bigint | null
}

export type MorphoPositionState = {
  marketId: Hex
  account: Address
  supplyShares: bigint
  borrowShares: bigint
  collateral: bigint
}

export type MorphoRead = {
  markets: MorphoMarketState[]
  positions: MorphoPositionState[]
}

/** A market from its CreateMarket log. */
export type DiscoveredMarket = {
  marketId: Hex
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
  createdBlock: bigint
}

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const addressText = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const createMarketArgsSchema = z.object({
  id: hex32,
  marketParams: z.object({
    loanToken: addressText,
    collateralToken: addressText,
    oracle: addressText,
    irm: addressText,
    lltv: z.bigint(),
  }),
})

/** A CreateMarket log's market, or null for any other log. */
export function marketFromLog(log: {
  eventName?: string
  args: unknown
  blockNumber: bigint | null
}): DiscoveredMarket | null {
  if (log.eventName !== "CreateMarket" || log.blockNumber === null) return null
  const parsed = createMarketArgsSchema.safeParse(log.args)
  if (!parsed.success) return null
  const { id, marketParams } = parsed.data
  const marketId = id.toLowerCase()
  if (!isHex(marketId)) return null
  return {
    marketId,
    loanToken: getAddress(marketParams.loanToken),
    collateralToken: getAddress(marketParams.collateralToken),
    oracle: getAddress(marketParams.oracle),
    irm: getAddress(marketParams.irm),
    lltv: marketParams.lltv,
    createdBlock: log.blockNumber,
  }
}

type ScannedLog = {
  eventName?: string
  args: unknown
  blockNumber: bigint | null
}

/** Morpho logs of `events` in [fromBlock, toBlock], `windows` at most. */
async function scanLogs(
  client: PublicClient,
  events: readonly AbiEvent[],
  fromBlock: bigint,
  toBlock: bigint,
  windows: number,
): Promise<{ logs: ScannedLog[]; scannedTo: bigint }> {
  const logs: ScannedLog[] = []
  let start =
    fromBlock < MORPHO_BLUE_DEPLOY_BLOCK ? MORPHO_BLUE_DEPLOY_BLOCK : fromBlock
  let scannedTo = start - 1n
  for (let index = 0; index < windows && start <= toBlock; index += 1) {
    const end =
      start + logWindow - 1n < toBlock ? start + logWindow - 1n : toBlock
    logs.push(
      ...(await client.getLogs({
        address: morpho,
        events,
        fromBlock: start,
        toBlock: end,
      })),
    )
    scannedTo = end
    start = end + 1n
  }
  return { logs, scannedTo }
}

/**
 * New accounts and markets from logs in [fromBlock, toBlock], at most
 * `windows` windows: one getLogs per window for all four event types.
 */
export async function discoverMorphoAccounts(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
  windows: number,
): Promise<{
  accounts: Set<string>
  markets: DiscoveredMarket[]
  scannedTo: bigint
}> {
  const { logs, scannedTo } = await scanLogs(
    client,
    [...accountEvents, ...createMarketEvents],
    fromBlock,
    toBlock,
    windows,
  )
  const accounts = new Set<string>()
  const markets: DiscoveredMarket[] = []
  for (const log of logs) {
    const market = marketFromLog(log)
    if (market !== null) {
      markets.push(market)
      continue
    }
    const onBehalf = Reflect.get(Object(log.args), "onBehalf")
    if (typeof onBehalf === "string") accounts.add(onBehalf.toLowerCase())
  }
  return { accounts, markets, scannedTo }
}

/**
 * Markets created in [fromBlock, toBlock] (CreateMarket only), for the
 * one-time backfill of the blocks the account scan read before it also
 * looked for CreateMarket.
 */
export async function discoverMorphoMarkets(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
  windows: number,
): Promise<{ markets: DiscoveredMarket[]; scannedTo: bigint }> {
  const { logs, scannedTo } = await scanLogs(
    client,
    createMarketEvents,
    fromBlock,
    toBlock,
    windows,
  )
  return {
    markets: logs.flatMap((log) => {
      const market = marketFromLog(log)
      return market === null ? [] : [market]
    }),
    scannedTo,
  }
}

/** ERC-20 decimals() of each token at `blockNumber`; null when unreadable. */
export async function readTokenDecimals(
  client: PublicClient,
  tokens: readonly Address[],
  blockNumber: bigint,
): Promise<Map<string, number | null>> {
  const unique = [...new Set(tokens.map((token) => getAddress(token)))]
  if (unique.length === 0) return new Map()
  const results = await client.multicall({
    blockNumber,
    allowFailure: true,
    contracts: unique.map((address) => ({
      address,
      abi: erc20Abi,
      functionName: "decimals" as const,
    })),
  })
  return new Map(
    unique.map((token, index) => {
      const result = results[index]
      return [
        token.toLowerCase(),
        result?.status === "success" ? result.result : null,
      ]
    }),
  )
}

/**
 * Every given market's totals, rate and oracle price, and the accounts'
 * positions in each, at `blockNumber`: four multicalls whatever the number
 * of markets. A market whose state cannot be read is left out (logged).
 */
export async function readMorpho(
  client: PublicClient,
  marketIds: readonly Hex[],
  accounts: readonly string[],
  blockNumber: bigint,
  logger: Logger,
): Promise<MorphoRead> {
  const base = { address: morpho, abi: MORPHO_BLUE_ABI } as const
  const [states, params] = await Promise.all([
    client.multicall({
      blockNumber,
      allowFailure: true,
      contracts: marketIds.map((id) => ({
        ...base,
        functionName: "market" as const,
        args: [id] as const,
      })),
    }),
    client.multicall({
      blockNumber,
      allowFailure: true,
      contracts: marketIds.map((id) => ({
        ...base,
        functionName: "idToMarketParams" as const,
        args: [id] as const,
      })),
    }),
  ])
  type Read = Omit<MorphoMarketState, "borrowRate" | "oraclePrice">
  const read: Read[] = []
  for (const [index, marketId] of marketIds.entries()) {
    const state = states[index]
    const param = params[index]
    if (state?.status !== "success" || param?.status !== "success") {
      logger.warn({ message: "Morpho market unreadable; skipped", marketId })
      continue
    }
    const [loanToken, collateralToken, oracle, irm, lltv] = param.result
    const [
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    ] = state.result
    read.push({
      marketId,
      loanToken,
      collateralToken,
      oracle,
      irm,
      lltv,
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    })
  }
  // Rates and oracle prices of every market in one multicall.
  const extras = await client.multicall({
    blockNumber,
    allowFailure: true,
    contracts: read.flatMap((market) => [
      {
        address: market.irm,
        abi: ADAPTIVE_CURVE_IRM_ABI,
        functionName: "borrowRateView" as const,
        args: [
          {
            loanToken: market.loanToken,
            collateralToken: market.collateralToken,
            oracle: market.oracle,
            irm: market.irm,
            lltv: market.lltv,
          },
          {
            totalSupplyAssets: market.totalSupplyAssets,
            totalSupplyShares: market.totalSupplyShares,
            totalBorrowAssets: market.totalBorrowAssets,
            totalBorrowShares: market.totalBorrowShares,
            lastUpdate: market.lastUpdate,
            fee: market.fee,
          },
        ] as const,
      },
      {
        address: market.oracle,
        abi: MORPHO_ORACLE_ABI,
        functionName: "price" as const,
      },
    ]),
  })
  const markets: MorphoMarketState[] = read.map((market, index) => {
    const rate = extras[index * 2]
    const price = extras[index * 2 + 1]
    if (rate?.status !== "success") {
      logger.warn({
        message: "Morpho borrow rate unavailable",
        marketId: market.marketId,
      })
    }
    if (price?.status !== "success") {
      logger.warn({
        message: "Morpho oracle unavailable",
        marketId: market.marketId,
      })
    }
    return {
      ...market,
      borrowRate:
        rate?.status === "success" && typeof rate.result === "bigint"
          ? rate.result
          : null,
      oraclePrice:
        price?.status === "success" && typeof price.result === "bigint"
          ? price.result
          : null,
    }
  })
  const pairs = marketIds.flatMap((marketId) =>
    accounts.map((account) => ({ marketId, account })),
  )
  const results = await client.multicall({
    blockNumber,
    allowFailure: true,
    contracts: pairs.map((pair) => ({
      ...base,
      functionName: "position" as const,
      args: [pair.marketId, getAddress(pair.account)] as const,
    })),
  })
  const positions: MorphoPositionState[] = []
  for (const [index, pair] of pairs.entries()) {
    const result = results[index]
    if (result?.status !== "success") continue
    const [supplyShares, borrowShares, collateral] = result.result
    if (supplyShares === 0n && borrowShares === 0n && collateral === 0n) {
      continue
    }
    positions.push({
      marketId: pair.marketId,
      account: getAddress(pair.account),
      supplyShares,
      borrowShares,
      collateral,
    })
  }
  return { markets, positions }
}
