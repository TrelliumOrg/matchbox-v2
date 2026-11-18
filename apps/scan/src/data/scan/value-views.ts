import { formatCompact, parseDecimal } from "@matchbox/domain/format"
import { compactUsd } from "./network-views"
import { decimalUsd, scaled, type Usd, usdDecimal } from "./pricing"
import type { SeriesView } from "./series.server"
import { percentText, shareBps } from "./voting-views"

/**
 * Tokens' value panels (`PnId7WLIDs`): what the tokens on Mezo are worth
 * now, and the dollar tokens over time. Arithmetic on the token list's
 * own figures (`/tokens`: supply at the latest close, in USD where the
 * API prices the token) and the supply series, exact in bigint. A token
 * the list does not price is named as not counted, never added as $0.
 */

/** A token's supply and its USD now, as the list prices it. */
export type ValuedToken = {
  symbol: string
  ticker: string
  /** Whole units, a decimal string. */
  amount: string
  /** USD now; null when the token is not priced. */
  usd: string | null
}

export type ValuePart = {
  label: string
  ticker: string | null
  /** "1,946.80 BTC" compact. */
  amount: string | null
  value: string
  share: string
  bps: number
}

export type ValueView = {
  figure: string
  /** Largest first; the smallest folded into "Other" past `room`. */
  parts: ValuePart[]
  /** Symbols with a supply but no price: not in the figure. */
  uncounted: string[]
}

/** "412.6M MEZO": a compact whole amount. */
function amountText(decimal: string, symbol: string): string {
  const { int } = parseDecimal(decimal)
  if (int >= 1_000n) return `${formatCompact(int)} ${symbol}`
  return `${decimal.replace(/(\.\d{0,4})\d*$/, "$1")} ${symbol}`
}

/** What the priced tokens on Mezo are worth now, by token. */
export function valueOnMezo(
  tokens: readonly ValuedToken[],
  room = 5,
): ValueView | null {
  const priced = tokens
    .filter(
      (token): token is ValuedToken & { usd: string } => token.usd !== null,
    )
    .map((token) => ({ ...token, value: scaled(token.usd) }))
    .filter((token) => token.value > 0n)
    .sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1))
  if (priced.length === 0) return null
  const total = priced.reduce((sum, token) => sum + token.value, 0n)
  const shown = priced.length > room ? priced.slice(0, room - 1) : priced
  const rest = priced.slice(shown.length)
  const part = (
    label: string,
    ticker: string | null,
    amount: string | null,
    value: Usd,
  ): ValuePart => {
    const bps = shareBps(value, total)
    return {
      label,
      ticker,
      amount,
      value: compactUsd(usdDecimal(value)),
      share: percentText(bps),
      bps,
    }
  }
  const parts = shown.map((token) =>
    part(
      token.symbol,
      token.ticker,
      amountText(token.amount, token.symbol),
      token.value,
    ),
  )
  if (rest.length > 0) {
    parts.push(
      part(
        `${rest.length} more`,
        null,
        null,
        rest.reduce((sum, token) => sum + token.value, 0n),
      ),
    )
  }
  return {
    figure: compactUsd(usdDecimal(total)),
    parts,
    uncounted: tokens
      .filter((token) => token.usd === null && scaled(token.amount) > 0n)
      .map((token) => token.symbol),
  }
}

/** A dollar token's supply series and its price now. */
export type DollarSeries = {
  symbol: string
  price: string
  view: SeriesView | null
}

/**
 * The dollar tokens' supply on Mezo each day at today's prices, as one
 * USD series: only days every token has a close for, so no day is drawn
 * smaller for a token missing from it. Null while any series did not read.
 */
export function dollarsOverTime(
  parts: readonly DollarSeries[],
): SeriesView | null {
  if (parts.length === 0 || parts.some((part) => part.view === null)) {
    return null
  }
  const days = new Map<string, { usd: Usd; count: number; partial: boolean }>()
  for (const part of parts) {
    for (const point of part.view?.points ?? []) {
      const entry = days.get(point.day) ?? { usd: 0n, count: 0, partial: false }
      entry.usd += decimalUsd(point.decimal, part.price)
      entry.count += 1
      entry.partial ||= point.partial
      days.set(point.day, entry)
    }
  }
  const points = [...days.entries()]
    .filter(([, entry]) => entry.count === parts.length)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, entry]) => {
      const decimal = usdDecimal(entry.usd)
      return {
        day,
        value: Number(entry.usd / 10n ** 16n) / 100,
        text: decimal,
        decimal,
        partial: entry.partial,
      }
    })
  const firsts = parts
    .map((part) => part.view?.firstDay ?? null)
    .filter((day): day is string => day !== null)
    .sort()
  const last = points.at(-1)
  return {
    metric: "stablecoins.usd",
    kind: "level",
    unit: "amount",
    points,
    latest:
      last === undefined ? null : { text: last.text, partial: last.partial },
    // Every token's series must reach a day for it to be drawn.
    firstDay: firsts.at(-1) ?? null,
    endsOn: null,
  }
}
