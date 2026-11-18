import type { ReferencePrices } from "@matchbox/api/market/prices"
import {
  pricesKvKey,
  readPricesFromKv,
} from "@matchbox/api/read-models/prices-kv"
import type { PriceSource } from "@matchbox/contracts/market"
import {
  type Prices,
  pricesSchema,
  type TokenPrice,
} from "@matchbox/contracts/read-models"
import { decimalToScaledBigInt } from "@matchbox/domain"
import type { Logger } from "@matchbox/logger"

// Every minute: read BTC (Chainlink-style feed on Mezo) and MEZO (CoinGecko,
// else the Aerodrome Slipstream pool on Base), keep one D1 sample per token
// per minute for the 24h change, and publish the latest pair to KV for the
// API. A CoinGecko reading in KV younger than the refresh interval is
// reused, so CoinGecko is called about every other minute.

/** KV's free plan allows 1,000 writes a day; every other minute is 720. */
export function isKvPublishMinute(nowSeconds: number): boolean {
  return Math.floor(nowSeconds / 60) % 2 === 0
}

const day = 86_400
/** A 24h-ago sample further than this from its target is not used. */
const sampleTolerance = 2 * 3_600
/** Samples are kept this long. */
const sampleRetention = 3 * day
/** A last-known KV price older than this is dropped, not republished. */
const maxCarryOverAge = 10 * 60

type Token = "btc" | "mezo"

/** The KV name of a reference price's source. */
export function liveSource(source: PriceSource): TokenPrice["source"] | null {
  switch (source) {
    case "skip-oracle":
      return "mezo-oracle"
    case "aerodrome-cl":
    case "coingecko":
      return source
    default:
      return null
  }
}

/** Percent change, two decimals, half away from zero, without floats. */
export function percentChange(previous: string, current: string): string {
  const scale = 18
  const before = decimalToScaledBigInt(previous, scale)
  const now = decimalToScaledBigInt(current, scale)
  if (before === 0n) return "0.00"
  // Hundredths of a percent: (now - before) * 10000 / before, rounded.
  const numerator = (now - before) * 10_000n
  const negative = numerator < 0n
  const absolute = negative ? -numerator : numerator
  const rounded = (absolute * 2n + before) / (before * 2n)
  const whole = rounded / 100n
  const fraction = (rounded % 100n).toString().padStart(2, "0")
  return `${negative && rounded !== 0n ? "-" : ""}${whole}.${fraction}`
}

export type PriceJobDeps = {
  db: D1Database
  kv: KVNamespace
  /** Receives the last KV copy, whose CoinGecko reading may be reused. */
  readPrices: (previous: Prices | null) => Promise<ReferencePrices>
  nowSeconds: number
  logger: Logger
}

async function sampleNear(
  db: D1Database,
  token: Token,
  target: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT usd, sampled_at FROM price_samples
       WHERE token = ?1 AND sampled_at <= ?2
       ORDER BY sampled_at DESC LIMIT 1`,
    )
    .bind(token, target)
    .first<{ usd: string; sampled_at: number }>()
  if (row === null || target - row.sampled_at > sampleTolerance) return null
  return row.usd
}

export async function runPriceJob(deps: PriceJobDeps): Promise<Prices> {
  const minute = Math.floor(deps.nowSeconds / 60) * 60
  const previous = await readPricesFromKv(deps.kv)
  const references = await deps.readPrices(previous)
  const read = {
    btc: references.btcUsd,
    mezo: references.mezoUsd,
  } satisfies Record<Token, ReferencePrices["btcUsd"]>
  const readAt: Record<Token, number> = {
    btc: deps.nowSeconds,
    mezo: references.mezoReadAt ?? deps.nowSeconds,
  }
  const fresh: Record<Token, string | null> = {
    btc: read.btc?.usd ?? null,
    mezo: read.mezo?.usd ?? null,
  }
  const statements: D1PreparedStatement[] = []
  const prices: Prices = { btc: null, mezo: null }
  for (const token of ["btc", "mezo"] as const) {
    const usd = fresh[token]
    const source = read[token] === null ? null : liveSource(read[token].source)
    if (usd === null || source === null) {
      // Keep a recent last-known price rather than blanking the slot.
      const last = previous?.[token] ?? null
      prices[token] =
        last !== null && deps.nowSeconds - last.updatedAt <= maxCarryOverAge
          ? last
          : null
      continue
    }
    statements.push(
      deps.db
        .prepare(
          `INSERT OR REPLACE INTO price_samples (token, sampled_at, usd, source)
           VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(token, minute, usd, source),
    )
    const dayAgo = await sampleNear(deps.db, token, minute - day)
    prices[token] = {
      usd,
      change24h: dayAgo === null ? null : percentChange(dayAgo, usd),
      source,
      updatedAt: readAt[token],
    }
  }
  if (minute % 3_600 === 0) {
    statements.push(
      deps.db
        .prepare("DELETE FROM price_samples WHERE sampled_at < ?1")
        .bind(minute - sampleRetention),
    )
  }
  if (statements.length > 0) await deps.db.batch(statements)
  const validated = pricesSchema.parse(prices)
  if (isKvPublishMinute(deps.nowSeconds) || previous === null) {
    await deps.kv.put(pricesKvKey, JSON.stringify(validated))
  }
  if (fresh.btc === null || fresh.mezo === null) {
    deps.logger.warn({
      message: "Price unavailable",
      btc: fresh.btc !== null,
      mezo: fresh.mezo !== null,
    })
  }
  return validated
}

/** Historic USD price of a token at `timestamp`, from the samples. */
export async function historicPrice(
  db: D1Database,
  token: Token,
  timestamp: number,
): Promise<string | null> {
  return sampleNear(db, token, timestamp)
}
