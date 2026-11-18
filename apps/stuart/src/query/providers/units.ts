// Exact conversions between the read models' whole-unit decimal strings
// ("6413.04" MEZO, "212.48" USD, "4.4" boost) and the bigint base units
// Stuart's tools compute with. No floats anywhere.

const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/

export class UnitConversionError extends Error {}

/**
 * Whole units → base units (`"6413.04"`, 18 → 6413040000000000000000n).
 * Throws when the value is not a non-negative decimal or carries non-zero
 * digits beyond `decimals` (the read model would then be wrong, and a
 * silently truncated amount would be worse).
 */
export function wholeToBaseUnits(value: string, decimals: number): bigint {
  const match = DECIMAL.exec(value.trim())
  if (match === null) {
    throw new UnitConversionError(`Not a decimal amount: ${value}`)
  }
  const whole = match[1] ?? "0"
  const fraction = match[2] ?? ""
  const kept = fraction.slice(0, decimals)
  if (/[1-9]/.test(fraction.slice(decimals))) {
    throw new UnitConversionError(`More than ${decimals} decimals in ${value}`)
  }
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(kept.padEnd(decimals, "0") || "0")
  )
}

/** Base units → whole-unit decimal string without trailing zeros. */
export function baseUnitsToWhole(amount: bigint, decimals: number): string {
  const negative = amount < 0n
  const absolute = negative ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = absolute / base
  const fraction = (absolute % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
  const text = fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`
  return negative ? `-${text}` : text
}

/**
 * USD in whole units → micro-USD, rounding half up past the sixth decimal
 * (micro-USD is Stuart's money unit; read models round USD to cents).
 */
export function usdToMicro(value: string): bigint {
  const match = DECIMAL.exec(value.trim())
  if (match === null) {
    throw new UnitConversionError(`Not a USD amount: ${value}`)
  }
  const whole = BigInt(match[1] ?? "0")
  const fraction = match[2] ?? ""
  const micro = BigInt(fraction.slice(0, 6).padEnd(6, "0") || "0")
  const roundUp = (fraction.charAt(6) || "0") >= "5" ? 1n : 0n
  return whole * 1_000_000n + micro + roundUp
}

/** Micro-USD → the history shapes' USD string (up to 6 decimals). */
export function microToUsd(micro: bigint): string {
  return baseUnitsToWhole(micro, 6)
}
