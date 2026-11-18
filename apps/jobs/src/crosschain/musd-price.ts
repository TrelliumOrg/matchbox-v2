import {
  type CoinGeckoConfig,
  coingeckoIds,
  fetchSimplePrices,
  maxCoinGeckoAgeSeconds,
} from "@matchbox/api/market/coingecko"
import {
  aeroMusdUsdc,
  type CrossChain,
  clPoolAbi,
  curveMetapoolAbi,
  curveMusd2pool,
  type MusdVenueId,
  musdPriceVenues,
  tigrisMusdcMusd,
} from "@matchbox/chain"
import {
  curveMetapoolUsd,
  meanTick,
  spreadBps,
  sqrtRatioAtTick,
  token0PerToken1,
  usdOfRaw,
  WAD,
  wadToDecimal,
  weightedMedian,
} from "@matchbox/domain/market-price"
import type { Logger } from "@matchbox/logger"
import { erc20Abi, type PublicClient } from "viem"
import { isPriceCloseMinute } from "../scan/closing"
import {
  runBatch,
  type SqlStatement,
  upsertStatements,
} from "../scan/statements"
import { dayOf } from "../scan/transform"
import type { CrossChainClients } from "./rpc"
import { marketPriceDailySpec, marketQuoteSpec, type QuoteRow } from "./specs"

// MUSD's market price, every minute: a quote from each deep venue (Curve
// MUSD/2pool on Ethereum, Aerodrome MUSD/USDC on Base, Tigris mUSDC/MUSD on
// Mezo), the liquidity-weighted median of the quotes read this minute as
// the headline, CoinGecko's `mezo-usd` only when no venue answered. USDC
// and the 2pool's coins are taken at $1 (mUSDC is fully backed bridged
// USDC). Quotes and the headline go to `market_quotes`; at the hourly close
// minutes each also goes to `market_price_daily` for the peg chart.

/** Venues further apart than this are flagged. */
export const divergenceBps = 50n
/** The concentrated-liquidity venues' TWAP window. */
export const twapSeconds = 1_800

export type VenueId = MusdVenueId

export type VenueQuote = {
  venue: VenueId
  chain: CrossChain
  /** USD per MUSD, WAD. */
  price: bigint
  /** The pool's two sides in USD, WAD. */
  depth: bigint
  method: string
  block: bigint | null
}

export const venues = musdPriceVenues

/**
 * Curve: get_dy(MUSD → 2pool LP, 1 MUSD) times the 2pool's virtual price.
 * Depth: the MUSD balance plus the LP balance at the virtual price.
 */
export async function readCurveQuote(
  client: PublicClient,
): Promise<VenueQuote> {
  const block = await client.getBlockNumber()
  const pool = { address: curveMusd2pool.pool, abi: curveMetapoolAbi } as const
  const [dy, musd, lp, virtualPrice] = await Promise.all([
    client.readContract({
      ...pool,
      functionName: "get_dy",
      args: [0n, 1n, WAD],
      blockNumber: block,
    }),
    client.readContract({
      ...pool,
      functionName: "balances",
      args: [0n],
      blockNumber: block,
    }),
    client.readContract({
      ...pool,
      functionName: "balances",
      args: [1n],
      blockNumber: block,
    }),
    client.readContract({
      address: curveMusd2pool.basePool,
      abi: curveMetapoolAbi,
      functionName: "get_virtual_price",
      blockNumber: block,
    }),
  ])
  const price = curveMetapoolUsd(dy, virtualPrice)
  return {
    venue: "curve-musd-2pool",
    chain: "ethereum",
    price,
    depth: usdOfRaw(musd, 18, price) + usdOfRaw(lp, 18, virtualPrice),
    method: "get_dy x 2pool virtual price",
    block,
  }
}

/**
 * A concentrated pool whose token0 is a 6-decimal dollar (USDC, mUSDC) and
 * token1 MUSD: the 30-minute TWAP from `observe()`, MUSD in the dollar
 * token. Depth: both balances, the dollar side at $1.
 */
export async function readClQuote(
  client: PublicClient,
  venue: "aero-musd-usdc" | "tigris-musdc-musd",
): Promise<VenueQuote> {
  const spec =
    venue === "aero-musd-usdc"
      ? { pool: aeroMusdUsdc.pool, dollar: aeroMusdUsdc.usdc }
      : { pool: tigrisMusdcMusd.pool, dollar: tigrisMusdcMusd.musdc }
  const musd = aeroMusdUsdc.musd
  const block = await client.getBlockNumber()
  const [[tickCumulatives], dollarBalance, musdBalance] = await Promise.all([
    client.readContract({
      address: spec.pool as `0x${string}`,
      abi: clPoolAbi,
      functionName: "observe",
      args: [[twapSeconds, 0]],
      blockNumber: block,
    }),
    client.readContract({
      address: spec.dollar as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [spec.pool as `0x${string}`],
      blockNumber: block,
    }),
    client.readContract({
      address: musd,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [spec.pool as `0x${string}`],
      blockNumber: block,
    }),
  ])
  const older = tickCumulatives[0]
  const newer = tickCumulatives[1]
  if (older === undefined || newer === undefined) {
    throw new Error("observe() returned too few points")
  }
  const tick = meanTick([older, newer], twapSeconds)
  const price = token0PerToken1(sqrtRatioAtTick(tick), 6, 18)
  return {
    venue,
    chain: venues[venue].chain,
    price,
    depth: usdOfRaw(dollarBalance, 6, WAD) + usdOfRaw(musdBalance, 18, price),
    method: "30-minute TWAP",
    block,
  }
}

/** A reading we refuse: far from any plausible MUSD price. */
function plausible(price: bigint): boolean {
  return price > WAD / 2n && price < (WAD * 3n) / 2n
}

export type Headline = {
  price: bigint
  /** "venues" or "coingecko". */
  source: "venues" | "coingecko"
  spreadBps: bigint | null
  diverged: boolean
  venuesUsed: VenueId[]
  depth: bigint | null
}

/**
 * The liquidity-weighted median of this minute's quotes, with the spread
 * and the divergence flag; null without a quote.
 */
export function headlineOf(quotes: readonly VenueQuote[]): Headline | null {
  const price = weightedMedian(
    quotes.map((quote) => ({ price: quote.price, weight: quote.depth })),
  )
  if (price === null) return null
  const spread = spreadBps(quotes.map((quote) => quote.price))
  return {
    price,
    source: "venues",
    spreadBps: quotes.length > 1 ? spread : null,
    diverged: spread > divergenceBps,
    venuesUsed: quotes.map((quote) => quote.venue),
    depth: quotes.reduce((sum, quote) => sum + quote.depth, 0n),
  }
}

export type MusdPriceDeps = {
  db: D1Database
  clients: Pick<CrossChainClients, "ethereum" | "base" | "mezo">
  coingecko: CoinGeckoConfig
  fetchCoinGecko?: typeof fetchSimplePrices
  nowSeconds: number
  logger: Logger
}

export type MusdPriceResult = {
  quotes: VenueQuote[]
  failed: { venue: VenueId; reason: string }[]
  headline: Headline | null
  rows: number
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    const short = Reflect.get(error, "shortMessage")
    return (typeof short === "string" ? short : error.message).slice(0, 200)
  }
  return "Unknown error"
}

/** CoinGecko's MUSD quote as a WAD, or null. */
async function coingeckoMusd(deps: MusdPriceDeps): Promise<bigint | null> {
  try {
    const quotes = await (deps.fetchCoinGecko ?? fetchSimplePrices)(
      [coingeckoIds.musd],
      deps.coingecko,
      8_000,
    )
    const quote = quotes.get(coingeckoIds.musd)
    if (quote === undefined) return null
    if (
      quote.updatedAt !== null &&
      deps.nowSeconds - quote.updatedAt > maxCoinGeckoAgeSeconds
    ) {
      return null
    }
    const [whole = "0", fraction = ""] = quote.usd.split(".")
    const price =
      BigInt(whole) * WAD + BigInt(fraction.slice(0, 18).padEnd(18, "0"))
    return plausible(price) ? price : null
  } catch (error) {
    deps.logger.warn({
      message: "MUSD CoinGecko fallback failed",
      reason: reasonOf(error),
    })
    return null
  }
}

/** Reads every venue; never throws for one venue's failure. */
export async function readMusdQuotes(
  clients: MusdPriceDeps["clients"],
): Promise<{ quotes: VenueQuote[]; failed: MusdPriceResult["failed"] }> {
  const reads: [VenueId, () => Promise<VenueQuote>][] = [
    ["curve-musd-2pool", () => readCurveQuote(clients.ethereum)],
    ["aero-musd-usdc", () => readClQuote(clients.base, "aero-musd-usdc")],
    ["tigris-musdc-musd", () => readClQuote(clients.mezo, "tigris-musdc-musd")],
  ]
  const settled = await Promise.allSettled(reads.map(([, read]) => read()))
  const quotes: VenueQuote[] = []
  const failed: MusdPriceResult["failed"] = []
  settled.forEach((result, index) => {
    const venue = reads[index]?.[0]
    if (venue === undefined) return
    if (result.status === "rejected") {
      failed.push({ venue, reason: reasonOf(result.reason) })
    } else if (!plausible(result.value.price)) {
      failed.push({ venue, reason: `Implausible price ${result.value.price}` })
    } else quotes.push(result.value)
  })
  return { quotes, failed }
}

function quoteRow(quote: VenueQuote, readAt: number): QuoteRow {
  return {
    asset: "musd",
    venue: quote.venue,
    chain: quote.chain,
    price: wadToDecimal(quote.price),
    depth_usd: wadToDecimal(quote.depth),
    method: quote.method,
    source: quote.venue,
    block: quote.block === null ? null : quote.block.toString(),
    read_at: readAt,
    detail: null,
  }
}

function headlineRow(headline: Headline, readAt: number): QuoteRow {
  return {
    asset: "musd",
    venue: "headline",
    chain: null,
    price: wadToDecimal(headline.price),
    depth_usd: headline.depth === null ? null : wadToDecimal(headline.depth),
    method:
      headline.source === "venues"
        ? "liquidity-weighted median"
        : "coingecko simple/price",
    source: headline.source,
    block: null,
    read_at: readAt,
    detail: JSON.stringify({
      spread_bps:
        headline.spreadBps === null ? null : Number(headline.spreadBps),
      diverged: headline.diverged,
      venues: headline.venuesUsed,
    }),
  }
}

/** Builds the statements for one minute's readings. */
export function musdPriceStatements(
  quotes: readonly VenueQuote[],
  headline: Headline | null,
  nowSeconds: number,
): SqlStatement[] {
  const rows = [
    ...quotes.map((quote) => quoteRow(quote, nowSeconds)),
    ...(headline === null ? [] : [headlineRow(headline, nowSeconds)]),
  ]
  const statements = upsertStatements(marketQuoteSpec, rows)
  if (isPriceCloseMinute(nowSeconds)) {
    // 00:00 closes the day that just ended.
    const minuteOfDay = Math.floor((nowSeconds % 86_400) / 60)
    const day = dayOf(minuteOfDay === 0 ? nowSeconds - 60 : nowSeconds)
    statements.push(
      ...upsertStatements(
        marketPriceDailySpec,
        rows.map((row) => ({
          asset: row.asset,
          venue: row.venue,
          day,
          price: row.price,
          depth_usd: row.depth_usd,
          source: row.source,
          updated_at: nowSeconds,
        })),
      ),
    )
  }
  return statements
}

/** One minute's MUSD reading, written to SCAN_DB. */
export async function runMusdPrice(
  deps: MusdPriceDeps,
): Promise<MusdPriceResult> {
  const { quotes, failed } = await readMusdQuotes(deps.clients)
  let headline = headlineOf(quotes)
  if (headline === null) {
    const fallback = await coingeckoMusd(deps)
    headline =
      fallback === null
        ? null
        : {
            price: fallback,
            source: "coingecko",
            spreadBps: null,
            diverged: false,
            venuesUsed: [],
            depth: null,
          }
  }
  if (failed.length > 0) {
    deps.logger.warn({ message: "MUSD venue quotes failed", failed })
  }
  if (headline?.diverged === true) {
    deps.logger.warn({
      message: "MUSD venues diverge",
      spreadBps: Number(headline.spreadBps ?? 0n),
    })
  }
  const rows = await runBatch(
    deps.db,
    musdPriceStatements(quotes, headline, deps.nowSeconds),
  )
  return { quotes, failed, headline, rows }
}
