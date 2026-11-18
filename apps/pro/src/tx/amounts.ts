import { formatUnits, parseUnits } from "viem"
import { formatToken, formatUsd } from "../lib/format"

/**
 * Amounts in a transaction sheet: typed decimal strings to base units and
 * back with viem's string arithmetic, USD through bigint micro-dollars. No
 * floats anywhere.
 */

/** "6000.5" to base units; null for an empty or zero amount. */
export function parseAmount(input: string, decimals: number): bigint | null {
  if (!/^\d*(\.\d*)?$/.test(input) || input === "" || input === ".") return null
  const amount = parseUnits(input, decimals)
  return amount > 0n ? amount : null
}

/** Base units to a whole-unit decimal string ("6000.5"). */
export function toDecimal(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals)
}

/** "6,000.00" for MEZO, "0.1000" for BTC. */
export function amountLabel(
  amount: bigint,
  decimals: number,
  symbol: string,
): string {
  return formatToken(toDecimal(amount, decimals), symbol)
}

function toMicro(usd: string): bigint {
  const [int = "0", fraction = ""] = usd.split(".")
  return (
    BigInt(int || "0") * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  )
}

function fromMicro(micro: bigint): string {
  const whole = micro / 1_000_000n
  const rest = (micro % 1_000_000n).toString().padStart(6, "0")
  return `${whole}.${rest}`
}

/** The USD value of `amount` at `priceUsd`, as a decimal string. */
export function usdValue(
  amount: bigint,
  decimals: number,
  priceUsd: string | null,
): string | null {
  if (priceUsd === null) return null
  return fromMicro((amount * toMicro(priceUsd)) / 10n ** BigInt(decimals))
}

/** "About $0.01": a fee never reads as free. */
export function feeLabel(gasWei: bigint, btcUsd: string | null): string | null {
  const usd = usdValue(gasWei, 18, btcUsd)
  if (usd === null) return null
  const cents = toMicro(usd)
  return cents < 10_000n ? "Under $0.01" : `About ${formatUsd(usd, "cents")}`
}
