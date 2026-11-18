import type { ReactNode } from "react"
import { Tip } from "../floating/floating"
import { type BtcUnit, formatBtc } from "./format"

/**
 * A BTC or veBTC amount as text (see `formatBtc`); below 0.000001 it reads
 * "<0.000001 veBTC" and shows the exact value on hover and focus.
 */
export function Btc({
  value,
  unit = "BTC",
  className,
}: {
  value: string
  unit?: BtcUnit
  className?: string
}): ReactNode {
  const { text, exact } = formatBtc(value, unit)
  if (exact === null) return <span className={className}>{text}</span>
  return (
    <Tip
      content={exact}
      trigger={(props) => (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the exact value must be reachable by keyboard
        <span {...props} tabIndex={0} className={className}>
          {text}
        </span>
      )}
    />
  )
}

Btc.displayName = "Btc"
