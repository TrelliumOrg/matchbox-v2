import { formatDecimal } from "./money"

/**
 * Base units to a decimal string: "1500000" with 6 decimals is "1.500000".
 * String and bigint arithmetic only. Base units are the integer strings
 * chains and Blockscout send (wei, token values).
 */
export function unitsToDecimal(units: string, decimals: number): string {
  const value = BigInt(units)
  const negative = value < 0n
  const digits = (negative ? -value : value).toString()
  if (decimals === 0) return `${negative ? "-" : ""}${digits}`
  const padded = digits.padStart(decimals + 1, "0")
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals)
  return `${negative ? "-" : ""}${whole}.${fraction}`
}

/**
 * A token amount for tables: grouped, rounded half up to `places`
 * ("1,500.00"). Small non-zero amounts keep three significant figures
 * rather than rounding to zero ("0.000412").
 */
export function formatUnits(
  units: string,
  decimals: number,
  places = 2,
): string {
  const decimal = unitsToDecimal(units, decimals)
  const [whole = "0", fraction = ""] = decimal.replace(/^-/, "").split(".")
  if (whole === "0" && /[1-9]/.test(fraction)) {
    const lead = fraction.search(/[1-9]/)
    if (lead >= places) {
      return formatDecimal(decimal, Math.min(decimals, lead + 3))
    }
  }
  return formatDecimal(decimal, Math.min(places, Math.max(decimals, 0)))
}

/** Gas prices and base fees, wei to gwei: "0.005 gwei". */
export function formatGwei(wei: string): string {
  const gwei = unitsToDecimal(wei, 9)
  const [whole = "0", fraction = ""] = gwei.split(".")
  const trimmed = fraction.replace(/0+$/, "").slice(0, 3)
  return `${BigInt(whole)
    .toString()
    .replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ",",
    )}${trimmed === "" ? "" : `.${trimmed}`} gwei`
}
