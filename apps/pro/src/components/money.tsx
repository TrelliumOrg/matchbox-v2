import { AnimatedNumber } from "@matchbox/motion"
import type { ReactNode } from "react"
import { formatUsd, tokenPlaces } from "../lib/format"

/**
 * Money on screen. Figures are exact decimal strings handed to NumberFlow
 * (Intl formats strings without floating point), so digits roll on change
 * and never drift. A USD total gets a coin stack, never a text breakdown.
 */

function isNumericLiteral(value: string): value is `${number}` {
  return /^-?\d+(\.\d+)?$/.test(value)
}

/** A read-model decimal as the numeric string Intl formats exactly. */
export function numeric(value: string): `${number}` {
  return isNumericLiteral(value) ? value : "0"
}

const usdCents = {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const

const usdWhole = {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
} as const

/** `countUp` (a session key) makes it a headline that counts up once. */
export function Usd({
  value,
  style = "auto",
  countUp,
}: {
  value: string
  style?: "auto" | "cents" | "whole"
  countUp?: string
}): ReactNode {
  const whole =
    style === "whole" ||
    (style === "auto" && formatUsd(value, "auto").indexOf(".") === -1)
  return (
    <AnimatedNumber
      value={numeric(value)}
      format={whole ? usdWhole : usdCents}
      countUp={countUp}
    />
  )
}

export function TokenFigure({
  value,
  symbol,
}: {
  value: string
  symbol: string
}): ReactNode {
  const places = tokenPlaces(symbol, value)
  return (
    <AnimatedNumber
      value={numeric(value)}
      format={{ minimumFractionDigits: places, maximumFractionDigits: places }}
    />
  )
}

/** "41.26k", "5.88M" with rolling digits. */
export function Compact({ value }: { value: number }): ReactNode {
  return (
    <AnimatedNumber
      value={value}
      format={{ notation: "compact", maximumFractionDigits: 2 }}
    />
  )
}
