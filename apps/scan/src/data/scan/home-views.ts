import type { GaugeCard } from "@matchbox/contracts/read-models"
import type {
  ScanBorrowTotalsResponse,
  ScanValidatorRow,
} from "@matchbox/contracts/scan"
import {
  formatBtc,
  formatDecimal,
  groupThousands,
  unitsToDecimal,
} from "@matchbox/domain/format"
import { wholeMusd } from "./borrow-views"
import { compactUsd, usdValue } from "./network-views"
import { dayLabel, pointLabel } from "./series-views"
import {
  cardVotes,
  decimalUnits,
  type GaugeIdentity,
  gaugeIdentity,
  percentDecimal,
  usdText,
} from "./voting-views"

/**
 * Home's tiles and "Epoch gauges" (`cP_-xnZA8I`) from the answers they are
 * read from, on the server. Amounts stay bigint until they are text; the
 * sparklines are the only floats (heights from 0 to 1). A tile whose
 * answer is missing is left out by the caller, never shown as zero.
 */

export type HomeTile = {
  id:
    | "borrowed"
    | "collateral"
    | "positions"
    | "vebtc"
    | "validators"
    | "incentives"
  label: string
  value: string
  detail: string | null
  /** A second figure on the right of the detail line. */
  aside: { label: string; value: string } | null
  /** Heights from 0 (lowest) to 1 (highest), oldest first; null to draw none. */
  spark: (number | null)[] | null
  /**
   * Each day of `spark` as the sparkline reads it out on hover, touch or
   * focus: its day and exact value, as `value` writes it. Null for a gap.
   */
  sparkDays: ({ label: string; text: string } | null)[] | null
}

/**
 * Daily levels as sparkline heights: each over the window's range, with a
 * flat line in the middle when every value is the same. Null with fewer
 * than two values. Gaps (null) stay gaps.
 */
export function sparkline(
  values: readonly (bigint | null)[],
): (number | null)[] | null {
  const known = values.filter((value): value is bigint => value !== null)
  if (known.length < 2) return null
  let low = known[0] ?? 0n
  let high = low
  for (const value of known) {
    if (value < low) low = value
    if (value > high) high = value
  }
  const span = high - low
  return values.map((value) => {
    if (value === null) return null
    if (span === 0n) return 0.5
    // Thousandths, from bigint, then a height.
    return Number(((value - low) * 1000n) / span) / 1000
  })
}

/** "97.2%" from a 1e18-scaled fraction (1e18 is 100%). */
function shareText(wad: string): string {
  return `${formatDecimal(unitsToDecimal(wad, 16), 1)}%`
}

/**
 * Borrowed: MUSD owed across troves, Enclaves and MUSD markets, in MUSD
 * (nothing prices MUSD, so never in dollars), with Enclaves' share and
 * the 30 day history. Null when the answer has no total (a venue could
 * not be read): never a partial sum.
 */
export function borrowedTile(
  answer: ScanBorrowTotalsResponse,
): HomeTile | null {
  const { data } = answer
  if (data.total === null) return null
  const points = data.history.status === "ok" ? data.history.data.points : []
  const history = points.map((point) =>
    point.total === null ? null : BigInt(point.total),
  )
  return {
    id: "borrowed",
    label: "Borrowed",
    // The same rounding as the Borrow page's tile, so the two agree.
    value: wholeMusd(data.total, data.unit.decimals),
    detail:
      data.enclaves_share === null
        ? null
        : `${shareText(data.enclaves_share)} Enclaves`,
    aside: null,
    spark: sparkline(history),
    sparkDays: points.map((point) =>
      point.total === null
        ? null
        : {
            label: pointLabel(point),
            text: wholeMusd(point.total, data.unit.decimals),
          },
    ),
  }
}

/**
 * The validators in the set now: every row whose pool has not left, with
 * the blocks they proposed on the API's latest counted day.
 */
export function validatorsTile(
  rows: readonly ScanValidatorRow[],
  counted: { day: string; total: string } | null,
): HomeTile | null {
  const active = rows.filter((row) => row.pool_status !== "left")
  if (active.length === 0) return null
  return {
    id: "validators",
    label: "Validators",
    value: groupThousands(BigInt(active.length)),
    detail:
      counted === null
        ? null
        : `${groupThousands(BigInt(counted.total))} blocks ${dayLabel(counted.day)}`,
    aside: null,
    spark: null,
    sparkDays: null,
  }
}

/** One gauge in "Epoch gauges": most incentives first. */
export type HomeGauge = {
  gauge: GaugeIdentity
  /** "112.4000 veBTC", "5.88M veMEZO". */
  votes: string
  /** "$4,210.00", "$120.00 + unpriced". */
  incentives: string
  /** "2.84% APY"; null when the directory has none. */
  apy: string | null
}

/** A USD decimal ("4210.5") as 18-decimal base units, for sums and order. */
function usdUnits(decimal: string): bigint {
  return decimalUnits(decimal)
}

/** The directory's cards with incentives, most incentives (USD) first. */
export function byIncentives(cards: readonly GaugeCard[]): GaugeCard[] {
  return cards
    .filter((card) => card.incentives.tokens.length > 0)
    .sort((a, b) => {
      const left = usdUnits(a.incentives.usd)
      const right = usdUnits(b.incentives.usd)
      if (left !== right) return left > right ? -1 : 1
      return a.gauge.address < b.gauge.address ? -1 : 1
    })
}

/** Every card's incentives in USD, summed exactly, and whether any is unpriced. */
export function incentivesTotal(cards: readonly GaugeCard[]): {
  usd: string
  tokens: { usd: string | null }[]
} {
  let sum = 0n
  const tokens: { usd: string | null }[] = []
  for (const card of cards) {
    sum += usdUnits(card.incentives.usd)
    tokens.push(...card.incentives.tokens.map((token) => ({ usd: token.usd })))
  }
  return { usd: unitsToDecimal(sum.toString(), 18), tokens }
}

export function homeGauge(card: GaugeCard): HomeGauge {
  return {
    gauge: gaugeIdentity(card.gauge),
    votes: cardVotes(card),
    incentives: usdText(card.incentives),
    apy: card.apy === null ? null : `${percentDecimal(card.apy)} APY`,
  }
}

/**
 * BTC collateral backing loans across venues, in 18-decimal units: open
 * troves' collateral, the veBTC pledged to open Enclave positions, and
 * the collateral of Morpho positions in markets whose collateral is BTC.
 * Null unless every venue was read: never a partial sum.
 */
export function collateralTile(
  parts: {
    troves: bigint | null
    enclaves: bigint | null
    markets: bigint | null
  },
  btcPrice: string | null,
): HomeTile | null {
  const { troves, enclaves, markets } = parts
  if (troves === null || enclaves === null || markets === null) return null
  const total = troves + enclaves + markets
  if (total === 0n) return null
  const decimal = unitsToDecimal(total.toString(), 18)
  return {
    id: "collateral",
    label: "BTC collateral",
    value: formatBtc(decimal).text,
    detail: btcPrice === null ? null : compactUsd(usdValue(decimal, btcPrice)),
    aside: {
      label: "Enclaves",
      value: `${formatDecimal(unitsToDecimal(((enclaves * 1000n) / total).toString(), 1), 1)}%`,
    },
    spark: null,
    sparkDays: null,
  }
}

/**
 * Open loans across venues: open troves and Enclave positions (the
 * Borrow totals' counts) and Morpho positions with debt. Null unless
 * every venue was counted whole.
 */
export function positionsTile(counts: {
  troves: number | null
  enclaves: number | null
  markets: number | null
}): HomeTile | null {
  const { troves, enclaves, markets } = counts
  if (troves === null || enclaves === null || markets === null) return null
  return {
    id: "positions",
    label: "Open positions",
    value: groupThousands(BigInt(troves + enclaves + markets)),
    detail: `${enclaves === 1 ? "1 Enclave" : `${enclaves} Enclaves`}, ${markets} Morpho`,
    aside: { label: "Troves", value: groupThousands(BigInt(troves)) },
    spark: null,
    sparkDays: null,
  }
}
