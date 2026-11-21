import * as CoinStack from "@matchbox/ui/coin-stack"
import type { ReactNode } from "react"
import type { TokenAmount } from "../data/view-models"
import { formatTokenWithSymbol, formatUsd } from "../lib/format"

/**
 * Token coins under a USD figure: a stack whose hover popover breaks the
 * total down by token, or a static stack for incentive tokens.
 */

export function Coins({
  tokens,
  size = 18,
  surface,
  label,
  chevron = false,
}: {
  tokens: readonly TokenAmount[]
  size?: 18 | 28
  surface?: string
  label: string
  chevron?: boolean
}): ReactNode {
  if (tokens.length === 0) return null
  return (
    <CoinStack.Root
      coins={tokens.map((token) => ({ ticker: token.symbol }))}
      size={size}
      chevron={chevron}
      label={label}
      {...(surface === undefined ? {} : { surface })}
      breakdown={tokens.map((token) => ({
        ticker: token.symbol,
        amount: formatTokenWithSymbol(token.amount, token.symbol),
        ...(token.usd === null ? {} : { usd: formatUsd(token.usd, "cents") }),
      }))}
    />
  )
}

/** A static coin stack for symbols only (incentive tokens on cards). */
export function CoinMarks({
  symbols,
  surface,
}: {
  symbols: readonly string[]
  surface?: string
}): ReactNode {
  if (symbols.length === 0) return null
  return (
    <CoinStack.Root
      coins={symbols.map((ticker) => ({ ticker }))}
      size={18}
      label={symbols.join(", ")}
      {...(surface === undefined ? {} : { surface })}
    />
  )
}

/**
 * A gauge's incentives on screen (`formatIncentives` in words): the
 * dollars, "Unpriced", or the dollars with "+ 1 unpriced" in smaller
 * secondary text that wraps as one piece, beside the dollars or under
 * them (`stacked`, for a row's narrow value column).
 */
export function Incentives({
  usd,
  priced,
  unpriced,
  stacked = false,
}: {
  usd: string
  priced: boolean
  unpriced: number
  stacked?: boolean
}): ReactNode {
  if (unpriced === 0) return formatUsd(usd, "cents")
  if (!priced) return "Unpriced"
  return (
    <span>
      {formatUsd(usd, "cents")}{" "}
      <span
        className={`${stacked ? "block " : ""}text-[0.8em] font-medium whitespace-nowrap text-sec`}
      >
        + {unpriced} unpriced
      </span>
    </span>
  )
}
