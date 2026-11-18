import type { CoinGeckoPlan } from "@matchbox/api/market/coingecko"

// CoinGecko's monthly allowance is shared by this Worker's price job (MEZO,
// every few minutes) and its keyed pool reads (TVL and 24h volume, three
// chains). Everything here derives from COINGECKO_API_PLAN, so a Demo key is
// safe without anyone setting a number. README "CoinGecko call budget" has
// the arithmetic.

/** A Demo key's calls a month (docs.coingecko.com, 12 Nov 2026). */
export const demoMonthlyCalls = 10_000

/**
 * The share of a Demo month this Worker plans to spend. The rest is margin
 * for MUSD's CoinGecko fallback (only when every venue fails), calls
 * repeated after an error, and a person's manual runs.
 */
export const demoPlannedCalls = 9_000

/** The longest month, so the plan holds in every month. */
const minutesPerMonth = 31 * 24 * 60

/**
 * COINGECKO_REFRESH_SECONDS when unset: 90 keyless (limited per IP, not per
 * month) and with a paid key, 360 with a Demo key.
 */
export function defaultRefreshSeconds(
  plan: CoinGeckoPlan,
  hasKey: boolean,
): number {
  return hasKey && plan === "demo" ? 360 : 90
}

/** A Demo key never refreshes faster than this, whatever is configured. */
export const minDemoRefreshSeconds = 300

/** Pool reads may run every this many hours (each divides a day). */
const poolIntervals = [1, 2, 3, 4, 6, 8, 12, 24] as const

/**
 * Keyed pool calls one run may make: one a chain (each call takes up to 30
 * pools). A run that would need more reads the rest keyless.
 */
export const maxKeyedPoolCallsPerRun = 3

/** The refresh interval in force: the default, and a Demo key's floor. */
export function refreshSeconds(
  plan: CoinGeckoPlan,
  hasKey: boolean,
  configured: number | null,
): number {
  const chosen = configured ?? defaultRefreshSeconds(plan, hasKey)
  return hasKey && plan === "demo"
    ? Math.max(chosen, minDemoRefreshSeconds)
    : chosen
}

/**
 * Minutes between the price job's CoinGecko calls. The job publishes to KV
 * on even minutes only, and the next run reuses the reading from KV, so a
 * call lands on an even minute: the refresh rounded up to the next even
 * number of minutes (300 s and 360 s both give 6).
 */
export function priceCallEveryMinutes(refresh: number): number {
  return 2 * Math.max(1, Math.ceil(refresh / 120))
}

/**
 * The reuse age to pass the price reader this minute. On a KV publish
 * minute, a minute short of the cadence, so start-time jitter of a few
 * seconds cannot push a call to a later minute. On the other minutes, a
 * minute past it: their answer is not published, so a call there would be
 * spent and asked again on the next even minute.
 */
export function priceCacheMaxAgeSeconds(
  nowSeconds: number,
  refresh: number,
): number {
  const cadence = priceCallEveryMinutes(refresh) * 60
  const publishMinute = Math.floor(nowSeconds / 60) % 2 === 0
  return publishMinute ? cadence - 60 : cadence + 60
}

/** The price job's CoinGecko calls in a 31-day month. */
export function priceCallsPerMonth(refresh: number): number {
  return Math.ceil(minutesPerMonth / priceCallEveryMinutes(refresh))
}

/** Keyed pool calls in a 31-day month, reading every `hours`. */
export function poolCallsPerMonth(hours: number, chains: number): number {
  return Math.ceil((31 * 24) / hours) * chains
}

export type CoinGeckoBudget = {
  refreshSeconds: number
  priceEveryMinutes: number
  priceCallsPerMonth: number
  /**
   * Hours between keyed pool reads, or null when the keyed path is off: no
   * key, or no interval fits beside the price job.
   */
  keyedPoolsEveryHours: number | null
  keyedPoolCallsPerMonth: number
  /** Planned calls in a 31-day month; null for a paid plan (not capped). */
  plannedCallsPerMonth: number | null
}

/** What the plan allows the price job and the keyed pool reads. */
export function coingeckoBudget(input: {
  plan: CoinGeckoPlan
  hasKey: boolean
  configuredRefreshSeconds: number | null
  poolChains: number
}): CoinGeckoBudget {
  const refresh = refreshSeconds(
    input.plan,
    input.hasKey,
    input.configuredRefreshSeconds,
  )
  const price = priceCallsPerMonth(refresh)
  const base = {
    refreshSeconds: refresh,
    priceEveryMinutes: priceCallEveryMinutes(refresh),
    priceCallsPerMonth: price,
  }
  if (!input.hasKey) {
    // Keyless calls are limited per IP, not per month.
    return {
      ...base,
      keyedPoolsEveryHours: null,
      keyedPoolCallsPerMonth: 0,
      plannedCallsPerMonth: null,
    }
  }
  if (input.plan === "pro") {
    return {
      ...base,
      keyedPoolsEveryHours: 1,
      keyedPoolCallsPerMonth: poolCallsPerMonth(1, input.poolChains),
      plannedCallsPerMonth: null,
    }
  }
  const hours =
    poolIntervals.find(
      (each) =>
        price + poolCallsPerMonth(each, input.poolChains) <= demoPlannedCalls,
    ) ?? null
  const pools = hours === null ? 0 : poolCallsPerMonth(hours, input.poolChains)
  return {
    ...base,
    keyedPoolsEveryHours: hours,
    keyedPoolCallsPerMonth: pools,
    plannedCallsPerMonth: price + pools,
  }
}
