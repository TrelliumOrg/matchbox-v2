import { z } from "zod"

// CoinGecko `simple/price`: the market price of MEZO (and MUSD's fallback).
// Most MEZO trading is on exchanges, which CoinGecko aggregates; the DEX
// pools are thin.
//
// Limits (docs.coingecko.com, read 12 Nov 2026): keyless calls share an
// IP-based pool of about 5 calls a minute; a Demo key allows 100 a minute
// and 10,000 a month (header `x-cg-demo-api-key`, same host); a paid key
// uses pro-api.coingecko.com with `x-cg-pro-api-key`. Data refreshes about
// once a minute, so reading more often gains nothing. Matchbox's plan needs
// no attribution, and no Matchbox surface shows one.

export type CoinGeckoPlan = "demo" | "pro"

export type CoinGeckoConfig = {
  /** Demo or paid key; null calls the keyless public API. */
  apiKey: string | null
  plan: CoinGeckoPlan
}

export const keylessCoinGecko: CoinGeckoConfig = { apiKey: null, plan: "demo" }

/** CoinGecko ids, checked against each coin's contract addresses. */
export const coingeckoIds = {
  /** MEZO: 0x7b7c…0001 on Mezo, 0x8e4c…848b on Ethereum and Base. */
  mezo: "mezo",
  /** MUSD: 0xdd46…f186 on Mezo, Ethereum and Base. */
  musd: "mezo-usd",
} as const

/**
 * Still sent as `crosschain/prices` `attribution` for clients that read
 * it; Matchbox's own surfaces no longer show it.
 */
export const coingeckoAttribution = {
  text: "Data provided by CoinGecko",
  url: "https://www.coingecko.com",
} as const

/** A quote older than this is not published as a price. */
export const maxCoinGeckoAgeSeconds = 30 * 60

const publicBase = "https://api.coingecko.com/api/v3"
const proBase = "https://pro-api.coingecko.com/api/v3"

/** The request for `ids`, with the key in a header (never the URL). */
export function simplePriceRequest(
  ids: readonly string[],
  config: CoinGeckoConfig,
): { url: string; headers: Record<string, string> } {
  const base =
    config.apiKey !== null && config.plan === "pro" ? proBase : publicBase
  const query = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd",
    include_24hr_vol: "true",
    include_market_cap: "true",
    include_last_updated_at: "true",
  })
  const headers: Record<string, string> = { accept: "application/json" }
  if (config.apiKey !== null) {
    headers[config.plan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] =
      config.apiKey
  }
  return { url: `${base}/simple/price?${query}`, headers }
}

/**
 * The exact decimal text of a JSON number. CoinGecko sends prices as JSON
 * numbers; `String` gives the shortest text that reads back as the same
 * number (what CoinGecko wrote), and this expands its exponent form
 * ("4.5e-7") without any float arithmetic. Null for negatives and
 * non-finite values.
 */
export function decimalFromNumber(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value))
  if (match === null) return null
  const whole = match[1] ?? "0"
  const fraction = match[2] ?? ""
  const exponent = Number.parseInt(match[3] ?? "0", 10)
  const digits = whole + fraction
  const point = whole.length + exponent
  let text: string
  if (point <= 0) text = `0.${"0".repeat(-point)}${digits}`
  else if (point >= digits.length) {
    text = digits + "0".repeat(point - digits.length)
  } else text = `${digits.slice(0, point)}.${digits.slice(point)}`
  const [int = "0", frac = ""] = text.split(".")
  const intPart = int.replace(/^0+(?=\d)/, "")
  const fracPart = frac.replace(/0+$/, "")
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart
}

const quoteSchema = z.object({
  usd: z.number(),
  usd_24h_vol: z.number().nullish(),
  usd_market_cap: z.number().nullish(),
  last_updated_at: z.number().int().nullish(),
})

export type CoinGeckoQuote = {
  usd: string
  /** 24h volume across CoinGecko's tracked venues, USD. */
  volume24hUsd: string | null
  marketCapUsd: string | null
  /** When CoinGecko last updated the quote, unix seconds. */
  updatedAt: number | null
}

/** The quote for `id` in a `simple/price` body; null when absent or bad. */
export function parseSimplePrice(
  body: unknown,
  id: string,
): CoinGeckoQuote | null {
  if (typeof body !== "object" || body === null) return null
  const parsed = quoteSchema.safeParse(Reflect.get(body, id))
  if (!parsed.success) return null
  const usd = decimalFromNumber(parsed.data.usd)
  if (usd === null || /^0(\.0*)?$/.test(usd)) return null
  const optional = (value: number | null | undefined) =>
    value === null || value === undefined ? null : decimalFromNumber(value)
  return {
    usd,
    volume24hUsd: optional(parsed.data.usd_24h_vol),
    marketCapUsd: optional(parsed.data.usd_market_cap),
    updatedAt: parsed.data.last_updated_at ?? null,
  }
}

/** A non-OK answer, carrying only the status (never the URL or key). */
export class CoinGeckoError extends Error {
  override name = "CoinGeckoError"
  constructor(readonly status: number) {
    super(
      status === 429
        ? "CoinGecko rate limit (429)"
        : `CoinGecko HTTP ${status}`,
    )
  }
}

/** Quotes by id; ids CoinGecko does not answer for are left out. */
export async function fetchSimplePrices(
  ids: readonly string[],
  config: CoinGeckoConfig,
  timeoutMs: number,
): Promise<Map<string, CoinGeckoQuote>> {
  const request = simplePriceRequest(ids, config)
  const response = await fetch(request.url, {
    headers: request.headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new CoinGeckoError(response.status)
  const body: unknown = await response.json()
  const quotes = new Map<string, CoinGeckoQuote>()
  for (const id of ids) {
    const quote = parseSimplePrice(body, id)
    if (quote !== null) quotes.set(id, quote)
  }
  return quotes
}
