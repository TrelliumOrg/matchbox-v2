import type { GaugeCard, GaugeRef } from "@matchbox/contracts/read-models"
import { epochIndexFor, epochStartForIndex } from "@matchbox/domain/epoch"
import {
  addressAvatar,
  formatBtc,
  formatCompact,
  formatDay,
  formatDecimal,
  formatUsd,
  groupThousands,
  parseDecimal,
  shortAddress,
  unitsToDecimal,
} from "@matchbox/domain/format"
import { poolTypeLabel } from "@matchbox/domain/pool-type"
import type { Section } from "../explorer"
import type { ScanRead } from "./read.server"
import { formatTokenAmount, tokenLookup } from "./tokens"

/**
 * Formatting shared by the Voting and Locks pages (gauges, epochs, locks),
 * on the server: votes in their escrow unit, token maps as text, shares as
 * basis points from bigint, gauge identities for rows. Never floats for
 * money: chart heights are the only numbers that leave as floats.
 */

export type GaugeKind = "vebtc" | "mezo" | "validator" | "pool"
export type VoteUnit = "veMEZO" | "veBTC"

/** A read as a page section: a missing list has nothing honest to show. */
export function scanSection<In, Out>(
  read: ScanRead<In>,
  map: (data: In) => Out,
): Section<Out> {
  if (read.status === "ok") {
    return {
      status: "ok",
      data: map(read.data),
      ...(read.skipped > 0 ? { skipped: read.skipped } : {}),
      ...(read.restarted === true ? { restarted: true } : {}),
    }
  }
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

/** A read that did not answer, as its section's failed state. */
export function failedSection(
  read: ScanRead<unknown>,
): Exclude<Section<never>, { status: "ok" }> {
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

// -- voter sources -------------------------------------------------------

const sourceKinds: Record<string, GaugeKind> = {
  BOOST_VOTER: "vebtc",
  THIRD_PARTY_VOTER: "mezo",
  VALIDATORS_VOTER: "validator",
  POOLS_VOTER: "pool",
}

/** The gauge kind a voter source votes for; null for an unknown source. */
export function kindOfSource(source: string): GaugeKind | null {
  return sourceKinds[source] ?? null
}

/** veMEZO votes veBTC and MEZO gauges; veBTC votes validators and pools. */
export function unitOfKind(kind: GaugeKind): VoteUnit {
  return kind === "vebtc" || kind === "mezo" ? "veMEZO" : "veBTC"
}

/** Sources in the order pages list them (gauge types first class). */
export const sourceOrder = [
  "BOOST_VOTER",
  "THIRD_PARTY_VOTER",
  "VALIDATORS_VOTER",
  "POOLS_VOTER",
] as const

// -- amounts --------------------------------------------------------------

/** "5,880,000 veMEZO", "88.1000 veBTC" from 18-decimal base units. */
export function votesText(units: string | bigint, unit: VoteUnit): string {
  const value = typeof units === "bigint" ? units : BigInt(units)
  if (unit === "veMEZO") {
    return `${groupThousands(value / 10n ** 18n)} veMEZO`
  }
  return formatBtc(unitsToDecimal(value.toString(), 18), "veBTC").text
}

/** "5.88M veMEZO", "88.1000 veBTC": compact for dense places. */
export function votesShort(units: string | bigint, unit: VoteUnit): string {
  const value = typeof units === "bigint" ? units : BigInt(units)
  if (unit === "veMEZO") return `${formatCompact(value / 10n ** 18n)} veMEZO`
  return votesText(value, unit)
}

/** A decimal string ("5880000", "88.1") as 18-decimal base units. */
export function decimalUnits(decimal: string): bigint {
  const { negative, int, fraction } = parseDecimal(decimal)
  const units = int * 10n ** 18n + BigInt(fraction.padEnd(18, "0").slice(0, 18))
  return negative ? -units : units
}

/** Whole-unit votes from a directory card ("5880000") in its unit. */
export function cardVotes(card: GaugeCard): string {
  return votesText(decimalUnits(card.votes), card.votesUnit)
}

/**
 * Token amounts from a {token: base units} map, the largest amount in
 * whole tokens first (compared exactly, in base units scaled to the same
 * decimals), each formatted with the token's decimals. A token whose
 * decimals Scan does not know is named by address, with no amount, after
 * the others.
 */
export function tokenMapTexts(map: Readonly<Record<string, string>>): string[] {
  const lookup = tokenLookup()
  const entries = Object.entries(map)
    .filter(([, amount]) => amount !== "0")
    .map(([token, amount]) => ({
      token,
      units: BigInt(amount),
      info: lookup(token),
    }))
  entries.sort((a, b) => {
    if (a.info === null || b.info === null) {
      if (a.info !== b.info) return a.info === null ? 1 : -1
      return a.token < b.token ? -1 : 1
    }
    // a / 10^da against b / 10^db, as a * 10^db against b * 10^da.
    const left = a.units * 10n ** BigInt(b.info.decimals)
    const right = b.units * 10n ** BigInt(a.info.decimals)
    if (left !== right) return left > right ? -1 : 1
    return a.info.symbol < b.info.symbol ? -1 : 1
  })
  return entries.map(
    ({ token, units, info }) =>
      formatTokenAmount(units.toString(), info) ??
      `Token ${shortAddress(token)}`,
  )
}

/**
 * Stats for up to `room` texts under one label, the last saying how many
 * more there are ("10.00 MUSD, +2 more") rather than dropping them.
 */
export function moreStats(
  texts: readonly string[],
  label: string,
  room: number,
): { label: string; value: string }[] {
  if (room <= 0 || texts.length === 0) return []
  const shown = texts.slice(0, room)
  const rest = texts.length - shown.length
  return shown.map((value, index) => ({
    label,
    value:
      rest > 0 && index === shown.length - 1
        ? `${value}, +${rest} more`
        : value,
  }))
}

/** A USD total and the tokens it sums (a card's or an epoch's incentives). */
type Priced = {
  usd: string
  tokens: readonly { usd: string | null }[]
}

/** Whether any token in `breakdown` has no price: its USD is a floor. */
export function hasUnpriced(breakdown: Priced): boolean {
  return breakdown.tokens.some((token) => token.usd === null)
}

/**
 * A breakdown's USD as text: "$1,180.00"; "$120.00 + unpriced" when a
 * token has no price (the total leaves it out); "Unpriced" when none has
 * one. Never "$0.00" for tokens that are there.
 */
export function usdText(breakdown: Priced): string {
  if (!hasUnpriced(breakdown)) return formatUsd(breakdown.usd)
  const priced = breakdown.tokens.some((token) => token.usd !== null)
  return priced ? `${formatUsd(breakdown.usd)} + unpriced` : "Unpriced"
}

/** Part over whole in basis points, from bigint; 0 for an empty whole. */
export function shareBps(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0
  return Number((part * 10_000n) / whole)
}

/** Basis points as "10.2%". */
export function percentText(bps: number): string {
  const tenths = Math.round(bps / 10)
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`
}

/** A signed change of `now` against `before` as "+4.2%", null without one. */
export function changeText(now: bigint, before: bigint): string | null {
  if (before <= 0n) return null
  const bps = Number(((now - before) * 10_000n) / before)
  const tenths = Math.round(Math.abs(bps) / 10)
  return `${bps < 0 ? "-" : "+"}${Math.floor(tenths / 10)}.${tenths % 10}%`
}

/** "1,903,044 MEZO" from 18-decimal base units, whole MEZO. */
export function mezoWhole(units: string | bigint): string {
  const value = typeof units === "bigint" ? units : BigInt(units)
  return `${groupThousands(value / 10n ** 18n)} MEZO`
}

/** A display height for a chart bar: whole units of 18-decimal amounts. */
export function chartValue(units: string | bigint): number {
  const value = typeof units === "bigint" ? units : BigInt(units)
  return Number(value / 10n ** 14n) / 10_000
}

/** A whole decimal for display ("2.56"), "2.56%" for percents. */
export function percentDecimal(decimal: string): string {
  return `${formatDecimal(decimal, 2)}%`
}

// -- epochs ---------------------------------------------------------------

export type EpochSpan = {
  number: number
  start: number
  end: number
  /** "Thu 5 Nov to Thu 12 Nov". */
  dates: string
}

export function epochSpan(start: number): EpochSpan {
  const number = epochIndexFor(start)
  const end = epochStartForIndex(number + 1)
  return {
    number,
    start,
    end,
    dates: `${formatDay(start)} to ${formatDay(end)}`,
  }
}

// -- gauges ---------------------------------------------------------------

export type GaugePictureView =
  | { kind: "image"; url: string }
  | { kind: "initials"; initials: string; hue: number }
  | { kind: "pair"; tickers: [string, string] }

export type GaugeIdentity = {
  address: string
  /** Profile name, pool symbol, moniker or "veBTC #604": untrusted. */
  name: string | null
  kind: GaugeKind | null
  /** The boosted veBTC lock's id (veBTC gauges). */
  tokenId: string | null
  picture: GaugePictureView
  /** The gauge's brand colour (#RRGGBB, data), for split bars. */
  color: string | null
  /**
   * Pool gauges: which pool of the pair ("Volatile", "Stable", "CL200"),
   * from `@matchbox/domain/pool-type`, shared with Pro. Null otherwise.
   */
  poolLabel: string | null
}

export function gaugeIdentity(ref: GaugeRef): GaugeIdentity {
  const avatar = addressAvatar(ref.address)
  const picture: GaugePictureView =
    ref.picture.type === "image"
      ? { kind: "image", url: ref.picture.url }
      : ref.picture.type === "pair"
        ? {
            kind: "pair",
            tickers: [
              ref.picture.tokens[0].symbol,
              ref.picture.tokens[1].symbol,
            ],
          }
        : { kind: "initials", initials: ref.picture.text, hue: avatar.hue }
  return {
    address: ref.address.toLowerCase(),
    name: ref.name,
    kind: ref.kind,
    // "#7" beside the name, unless the name already is "veBTC #604".
    tokenId:
      ref.kind === "vebtc" &&
      ref.vebtcTokenId !== null &&
      !ref.name.endsWith(`#${ref.vebtcTokenId}`)
        ? ref.vebtcTokenId
        : null,
    picture,
    color: ref.color,
    poolLabel:
      ref.kind === "pool"
        ? poolTypeLabel({
            poolType: ref.poolType,
            tickSpacing: ref.tickSpacing,
          })
        : null,
  }
}

/** A gauge we hold no document for: its short address and initials. */
export function unknownGauge(
  address: string,
  kind: GaugeKind | null,
): GaugeIdentity {
  const avatar = addressAvatar(address)
  return {
    address: address.toLowerCase(),
    name: null,
    kind,
    tokenId: null,
    picture: { kind: "initials", initials: avatar.initials, hue: avatar.hue },
    color: null,
    poolLabel: null,
  }
}

/** Gauge identities by address from Pro's directory, when it was read. */
export function gaugeIndex(
  cards: readonly GaugeCard[] | null,
): ReadonlyMap<string, GaugeIdentity> {
  const index = new Map<string, GaugeIdentity>()
  for (const card of cards ?? []) {
    const identity = gaugeIdentity(card.gauge)
    index.set(identity.address, identity)
  }
  return index
}
