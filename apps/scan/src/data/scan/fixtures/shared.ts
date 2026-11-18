import { CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import { fixtureHead } from "../../blockscout/fixtures"

/** Shared pieces of the /internal/scan fixtures. */

export type FixtureScenario =
  | "normal"
  | "disabled"
  | "limited"
  | "filling"
  | "delayed"
  | "partial"

export type FixtureAnswer = { status: number; body: unknown }

export type FixtureRoute = {
  /**
   * Matched against the lower-cased path after /internal/scan/, or the
   * path as sent when `exact` (a base58 Bitcoin address is case-sensitive).
   */
  pattern: RegExp
  exact?: boolean
  /** Null for a 404. */
  answer: (
    match: RegExpExecArray,
    query: URLSearchParams,
    scenario: FixtureScenario,
  ) => FixtureAnswer | null
}

export const ok = (body: unknown): FixtureAnswer => ({ status: 200, body })

/** Epoch 0 starts Thu 11 Dec 2025 00:00 UTC; one epoch is a week. */
export const epochZero = 1_765_411_200
export const week = 604_800
export const epochStart = (number: number): number => epochZero + number * week

/** The fixtures' "now": the recorded Blockscout head, Mon 9 Nov 2026. */
export const fixtureNow = fixtureHead.timestamp
export const currentEpoch = 47
export const fixtureAsOf = fixtureNow - 600

export const vebtc = CONTRACTS.mainnet.veBTC.toLowerCase()
export const vemezo = CONTRACTS.mainnet.veMEZO.toLowerCase()
export const mezoToken = CONTRACTS.mainnet.mezoToken.toLowerCase()
export const btcToken = "0x7b7c000000000000000000000000000000000000"
export const musdToken = MUSD_CONTRACTS.mainnet.musd.toLowerCase()
export const musdcToken = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"

/** `0x` + `tail` left-padded to an address. */
export const fakeAddress = (tail: string): string =>
  `0x${tail.padStart(40, "0")}`
export const fakeHash = (tail: string): string => `0x${tail.padStart(64, "0")}`

const pageCursor = /^fx([0-9]{1,6})$/

/**
 * A page of `items` the way the API pages: `limit` (1 to 100, default 25)
 * and an opaque cursor. Null for a bad limit or cursor (the API's 400).
 */
export function page<T>(
  items: readonly T[],
  query: URLSearchParams,
): { data: T[]; nextCursor: string | null } | null {
  const limitText = query.get("limit")
  const limit = limitText === null ? 25 : Number(limitText)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null
  const cursor = query.get("cursor")
  let offset = 0
  if (cursor !== null) {
    const match = pageCursor.exec(cursor)
    if (match === null) return null
    offset = Number(match[1])
  }
  const data = items.slice(offset, offset + limit)
  const next = offset + limit
  return {
    data,
    nextCursor:
      next < items.length ? `fx${String(next).padStart(4, "0")}` : null,
  }
}

export const badRequest: FixtureAnswer = {
  status: 400,
  body: { error: { code: "invalid_request", message: "Invalid request" } },
}

/** A page answer, or the API's 400 for a bad limit or cursor. */
export function pageAnswer<T>(
  items: readonly T[],
  query: URLSearchParams,
  extra: Record<string, unknown> = {},
  skipped = 0,
): FixtureAnswer {
  const result = page(items, query)
  if (result === null) return badRequest
  // Every page answers meta.skipped (rows dropped for failing their
  // schema); an aggregate's meta (in extra) carries it already.
  return ok({ ...result, meta: { skipped }, ...extra })
}

/** `meta` for an aggregate answer in a scenario. */
export function aggregateMeta(scenario: FixtureScenario, complete = true) {
  return {
    complete: scenario === "filling" ? false : complete,
    asOf: fixtureAsOf,
    // The API's fill status beside each answer (aggregatesComplete,
    // historyFilled, stale): ignored by today's schema, required by the
    // status contract the API is adding.
    aggregatesComplete: scenario !== "filling",
    historyFilled: true,
    stale: false,
    skipped: 0,
  }
}

/** A base-unit amount from a decimal string, for readable fixtures. */
export function units(decimal: string, decimals = 18): string {
  const [whole = "0", fraction = ""] = decimal.split(".")
  const digits = `${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`
  return BigInt(digits).toString()
}
