import { z } from "zod"
import {
  amountSchema,
  blockNumberSchema,
  signedAmountSchema,
  unixSecondsSchema,
} from "./primitives"

// Fast-moving state that never touches Neon: prices (jobs, KV) and the chain
// head (BlockHub).

export const livePriceSourceSchema = z.enum([
  /** Chainlink-style `latestRoundData` BTC/USD feed on Mezo. */
  "mezo-oracle",
  /** Aerodrome Slipstream MEZO pool `slot0` on Base (MEZO's fallback). */
  "aerodrome-cl",
  /** CoinGecko `simple/price` (MEZO's primary source). */
  "coingecko",
])

export const tokenPriceSchema = z.object({
  usd: amountSchema,
  /** Percent change against the price 24h earlier; null without history. */
  change24h: signedAmountSchema.nullable(),
  source: livePriceSourceSchema,
  /** When the price was read. */
  updatedAt: unixSecondsSchema,
})

export type TokenPrice = z.infer<typeof tokenPriceSchema>

export const pricesSchema = z.object({
  btc: tokenPriceSchema.nullable(),
  mezo: tokenPriceSchema.nullable(),
})

export type Prices = z.infer<typeof pricesSchema>

export const pricesResponseSchema = z.object({ data: pricesSchema })

export type PricesResponse = z.infer<typeof pricesResponseSchema>

export const chainHeadSchema = z.object({
  block: blockNumberSchema,
  /** Block timestamp, unix seconds. */
  timestamp: unixSecondsSchema,
})

export type ChainHead = z.infer<typeof chainHeadSchema>

/** Messages BlockHub sends over `/internal/heads`. */
export const headMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("head"), ...chainHeadSchema.shape }),
  /** The upstream RPC has failed for a while; fall back to polling. */
  z.object({ type: z.literal("stale"), since: unixSecondsSchema }),
])

export type HeadMessage = z.infer<typeof headMessageSchema>
