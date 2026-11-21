import type {
  ActivityRow,
  ClaimEstimate,
  ClaimTokenValue,
  ClaimValue,
} from "@matchbox/contracts/read-models"
import { z } from "zod"
import { sumUsd, usdValue } from "./money"
import type { ReadDatabase } from "./store"
import { tokenRegistry } from "./token-registry"

// What a claim was worth when it was claimed (READ_DB `token_price_daily`,
// apps/jobs/migrations/0008_claim_prices.sql). Each token of a claim is
// priced by its registry address at the price of the claim's UTC day,
// 00:00 UTC: a registry stablecoin at $1, BTC and its wrappers at BTC's
// daily price, MEZO at MEZO's. A token the registry does not price, or
// does not list, is never counted as dollars, whatever its symbol.
//
// A day is "checked" once the snapshot has asked the history for it
// (job_cursors `claim-prices-<token>`). A checked day with no row had no
// price: "No price". That happens before the token's first daily point
// (`pricedFrom`, read from the history itself), beyond the history's
// reach, or on a day CoinGecko still skips over a week after it settled.
// A day missing for less than that is not checked: it is asked for again.
// A day not checked yet is pending: the claim is valued on a later run. A
// stored "No price" for a day that later gains a price is valued again
// (`valueClaim`).

export type HistoryToken = "btc" | "mezo"

export const historyTokens: readonly HistoryToken[] = ["btc", "mezo"]

/** The `job_cursors` row that says how far a token's history is checked. */
export function claimPricesCursor(token: HistoryToken): string {
  return `claim-prices-${token}`
}

export const coverageSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Unix seconds before which a failed fetch is not tried again. */
  retryAt: z.number().int().nonnegative().optional(),
  /**
   * The token's first daily point: the earliest any answer returned.
   * Checked days before it had no price; from it on, every checked day
   * has one but a day CoinGecko skipped for over a week.
   */
  pricedFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

export type CoverageState = z.infer<typeof coverageSchema>

/** Every day from `from` to `through` (both UTC days) has been checked. */
export type Coverage = CoverageState

export type DailyPrice = { usd: string; source: "coingecko" }

export type ClaimPrices = {
  /** `${token}:${day}` to its price at 00:00 UTC that day. */
  daily: ReadonlyMap<string, DailyPrice>
  coverage: Readonly<Record<HistoryToken, Coverage | null>>
}

export const noClaimPrices: ClaimPrices = {
  daily: new Map(),
  coverage: { btc: null, mezo: null },
}

/** The UTC day of a unix-seconds time, `YYYY-MM-DD`. */
export function utcDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** 00:00 UTC of a `YYYY-MM-DD` day, unix seconds. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 1000
}

/** The day `count` days after `day` (before, when negative). */
export function addDays(day: string, count: number): string {
  return utcDay(dayStart(day) + count * 86_400)
}

function covers(coverage: Coverage | null, day: string): boolean {
  return coverage !== null && coverage.from <= day && day <= coverage.through
}

/** What the registry prices a token as, by address; null for nothing. */
function pricingOf(address: string): "usd" | HistoryToken | null {
  return tokenRegistry.get(address.toLowerCase())?.pricing ?? null
}

/** Undefined: pending. */
function tokenValue(
  prices: ClaimPrices,
  address: string,
  amount: string,
  day: string,
): ClaimTokenValue | undefined {
  const token = address.toLowerCase()
  const pricing = pricingOf(token)
  const none: ClaimTokenValue = {
    token,
    price: null,
    usd: null,
    day,
    source: null,
    pricedAs: null,
  }
  if (pricing === null) return none
  if (pricing === "usd") {
    return {
      token,
      price: "1",
      usd: usdValue(amount, "1"),
      day,
      source: "usd-peg",
      pricedAs: "usd",
    }
  }
  const found = prices.daily.get(`${pricing}:${day}`)
  if (found !== undefined) {
    return {
      token,
      price: found.usd,
      usd: usdValue(amount, found.usd),
      day,
      source: found.source,
      pricedAs: pricing,
    }
  }
  // Checked and no price that day, or before the history reaches.
  const coverage = prices.coverage[pricing]
  if (covers(coverage, day)) return none
  if (coverage !== null && day < coverage.from) return none
  return undefined
}

type ClaimRow = Extract<ActivityRow, { type: "claim" }>

/**
 * A recorded value with a "No price" token whose day has a price now: a
 * day checked before a failed answer was fixed, or asked for again. Only
 * BTC and MEZO days can gain one.
 */
function repairable(value: ClaimValue, prices: ClaimPrices): boolean {
  return value.tokens.some((token) => {
    if (token.price !== null) return false
    const pricing = pricingOf(token.token)
    return (
      (pricing === "btc" || pricing === "mezo") &&
      prices.daily.has(`${pricing}:${token.day}`)
    )
  })
}

/**
 * A claim's value when claimed, or null while some token's day is not
 * checked yet. A row that already carries one keeps it (the same object):
 * prices are never rewritten, so values are fixed once recorded. The one
 * exception is a "No price" whose day has a price now, which is valued
 * again.
 */
export function valueClaim(
  row: ClaimRow,
  prices: ClaimPrices,
): ClaimValue | null {
  if (row.atClaim !== undefined && !repairable(row.atClaim, prices)) {
    return row.atClaim
  }
  return freshValue(row, prices) ?? row.atClaim ?? null
}

function freshValue(row: ClaimRow, prices: ClaimPrices): ClaimValue | null {
  const day = utcDay(row.timestamp)
  const tokens: ClaimTokenValue[] = []
  for (const amount of row.rewards.tokens) {
    const value = tokenValue(prices, amount.token.address, amount.amount, day)
    if (value === undefined) return null
    tokens.push(value)
  }
  return {
    usd: sumUsd(
      tokens.flatMap((token) => (token.usd === null ? [] : [token.usd])),
    ),
    tokens,
  }
}

/**
 * The row with its value when claimed, where it is known. Its estimate,
 * if it had one, goes once the value is known.
 */
export function withClaimValue(
  row: ActivityRow,
  prices: ClaimPrices,
): ActivityRow {
  if (row.type !== "claim") return row
  const value = valueClaim(row, prices)
  if (value === null || value === row.atClaim) return row
  const { estimate: _estimate, ...rest } = row
  return { ...rest, atClaim: value }
}

/**
 * A claim's estimate while its day settles: each token by registry
 * address, a stablecoin at $1, BTC and its wrappers at BTC's price, MEZO
 * at MEZO's, from `priceAt` (the best price known at the claim's time).
 * Undefined once the day could be settled, or with a value already.
 */
export function estimateClaim(
  row: ClaimRow,
  priceAt: (token: HistoryToken, timestamp: number) => string | null,
  nowSeconds: number,
): ClaimEstimate | undefined {
  if (row.atClaim !== undefined) return undefined
  const day = utcDay(row.timestamp)
  if (day <= latestSettledDay(nowSeconds)) return undefined
  const tokens = row.rewards.tokens.map((amount) => {
    const token = amount.token.address.toLowerCase()
    const pricing = pricingOf(token)
    const price =
      pricing === null
        ? null
        : pricing === "usd"
          ? "1"
          : priceAt(pricing, row.timestamp)
    return {
      token,
      price,
      usd: price === null ? null : usdValue(amount.amount, price),
    }
  })
  return {
    usd: sumUsd(
      tokens.flatMap((token) => (token.usd === null ? [] : [token.usd])),
    ),
    tokens,
    finalOn: addDays(day, settleDays),
  }
}

const priceRowSchema = z.object({
  token: z.enum(["btc", "mezo"]),
  day: z.string(),
  usd: z.string(),
  source: z.literal("coingecko"),
})

/** A missing table: READ_DB before migration 0008. */
export function isMissingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message)
}

/**
 * Every stored daily price and how far each token is checked: about 700
 * rows read for a year of two tokens. Before migration 0008 every BTC and
 * MEZO day is pending. Any other failure throws.
 */
export async function readClaimPrices(
  db: ReadDatabase,
  network: string,
): Promise<ClaimPrices> {
  let rows: unknown[]
  try {
    rows = (
      await db
        .prepare("SELECT token, day, usd, source FROM token_price_daily")
        .all()
    ).results
  } catch (error) {
    if (isMissingTable(error)) return noClaimPrices
    throw error
  }
  const daily = new Map<string, DailyPrice>()
  for (const row of rows) {
    const parsed = priceRowSchema.parse(row)
    daily.set(`${parsed.token}:${parsed.day}`, {
      usd: parsed.usd,
      source: parsed.source,
    })
  }
  const { results } = await db
    .prepare(
      `SELECT job, value FROM job_cursors
       WHERE network = ?1 AND job IN (?2, ?3)`,
    )
    .bind(network, claimPricesCursor("btc"), claimPricesCursor("mezo"))
    .all<{ job: string; value: string }>()
  const coverage: Record<HistoryToken, Coverage | null> = {
    btc: null,
    mezo: null,
  }
  for (const token of historyTokens) {
    const row = results.find((each) => each.job === claimPricesCursor(token))
    coverage[token] = row === undefined ? null : parseCoverage(row.value)
  }
  return { daily, coverage }
}

/** A stored coverage cursor; null when absent or unreadable. */
export function parseCoverage(value: string | null): CoverageState | null {
  if (value === null) return null
  try {
    const parsed = coverageSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Days a day waits before its price is stored: CoinGecko revises 2. */
export const settleDays = 3

/** The latest day whose price can be stored at `nowSeconds`. */
export function latestSettledDay(nowSeconds: number): string {
  return addDays(utcDay(nowSeconds), -settleDays)
}

/**
 * Whether a token's history is caught up: it has succeeded at least once
 * and is at most a day behind the latest settled day. Until then a claim
 * holding that token may be "not priced yet" for want of a call, not of a
 * settled day, so Earned would miss it.
 */
export function historyCaughtUp(
  prices: ClaimPrices,
  nowSeconds: number,
  token: HistoryToken,
): boolean {
  const oldest = addDays(latestSettledDay(nowSeconds), -1)
  const coverage = prices.coverage[token]
  return (
    coverage !== null &&
    coverage.through >= coverage.from &&
    coverage.through >= oldest
  )
}

/**
 * The history tokens a claim with no value yet waits on: those of its
 * tokens whose day is not checked. Empty once it has a value.
 */
export function waitingOn(row: ClaimRow, prices: ClaimPrices): HistoryToken[] {
  if (valueClaim(row, prices) !== null) return []
  const day = utcDay(row.timestamp)
  const waiting = new Set<HistoryToken>()
  for (const amount of row.rewards.tokens) {
    const pricing = pricingOf(amount.token.address)
    if (pricing !== "btc" && pricing !== "mezo") continue
    const value = tokenValue(prices, amount.token.address, amount.amount, day)
    if (value === undefined) waiting.add(pricing)
  }
  return [...waiting]
}

/**
 * A short fingerprint of the coverage, for ETags of answers that value
 * rows on the fly: a newly checked day changes what they say.
 */
export function coverageStamp(prices: ClaimPrices): string {
  return historyTokens
    .map((token) => {
      const coverage = prices.coverage[token]
      if (coverage === null) return "-"
      return `${coverage.through}${coverage.pricedFrom ?? ""}`
    })
    .join(".")
}
