/**
 * BTC and veBTC amounts, from exact decimal strings (never floats):
 * 4 decimals normally ("250.1660 veBTC", "0.8000 veBTC"); small amounts
 * keep 3 significant figures so a tiny lock never rounds to zero
 * ("0.000228 veBTC", "0.0000102 veBTC"); below 0.000001 the text is
 * "<0.000001 veBTC" and `exact` carries the full value for a tooltip.
 */

export type BtcUnit = "BTC" | "veBTC"

export type FormattedBtc = {
  text: string
  /** The exact value, only when the text could not show it. */
  exact: string | null
}

const floor = 6

function split(value: string): {
  negative: boolean
  int: string
  fraction: string
} {
  const trimmed = value.trim()
  const negative = trimmed.startsWith("-")
  const body = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed
  if (!/^\d*(\.\d*)?$/.test(body) || body === "" || body === ".") {
    throw new Error(`Not a decimal amount: ${value}`)
  }
  const [int = "", fraction = ""] = body.split(".")
  return { negative, int: int.replace(/^0+(?=\d)/, "") || "0", fraction }
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/** Rounds half up to `places` decimals, exactly. */
function round(
  int: string,
  fraction: string,
  places: number,
): { int: string; fraction: string } {
  const digits = `${int}${fraction.padEnd(places + 1, "0").slice(0, places + 1)}`
  let scaled = BigInt(digits.slice(0, -1) || "0")
  if (Number(digits.at(-1)) >= 5) scaled += 1n
  const text = scaled.toString().padStart(places + 1, "0")
  return {
    int: text.slice(0, text.length - places) || "0",
    fraction: places === 0 ? "" : text.slice(text.length - places),
  }
}

/** The figure alone, for callers that print the unit themselves. */
export function formatBtcFigure(value: string): FormattedBtc {
  const { text, exact } = formatBtc(value, "BTC")
  return {
    text: text.replace(/ BTC$/, ""),
    exact: exact === null ? null : exact.replace(/ BTC$/, ""),
  }
}

export function formatBtc(value: string, unit: BtcUnit = "BTC"): FormattedBtc {
  const { negative, int, fraction } = split(value)
  const sign = negative ? "-" : ""
  const isZero = int === "0" && !/[1-9]/.test(fraction)
  if (isZero) return { text: `0.0000 ${unit}`, exact: null }
  if (int === "0") {
    const lead = fraction.search(/[1-9]/)
    // Below 0.000001: a floor, the exact value goes in the tooltip.
    if (lead >= floor) {
      return {
        text: `${sign === "-" ? "-" : ""}<0.000001 ${unit}`,
        exact: `${sign}0.${fraction.replace(/0+$/, "")} ${unit}`,
      }
    }
    let places = Math.max(4, lead + 3)
    let rounded = round(int, fraction, places)
    // Rounding up can carry into a bigger digit (0.000099996 to 0.0001000):
    // keep 3 significant figures of the rounded value.
    const carried = rounded.int === "0" ? rounded.fraction.search(/[1-9]/) : -1
    if (carried >= 0 && carried < lead) {
      places = Math.max(4, carried + 3)
      rounded = round(int, fraction, places)
    }
    return {
      text: `${sign}${group(rounded.int)}.${rounded.fraction} ${unit}`,
      exact: null,
    }
  }
  const rounded = round(int, fraction, 4)
  return {
    text: `${sign}${group(rounded.int)}.${rounded.fraction} ${unit}`,
    exact: null,
  }
}

/** An 18-decimal integer (wei) as a decimal string. */
export function fromWei(wei: string | bigint): string {
  const value = typeof wei === "bigint" ? wei : BigInt(wei)
  const negative = value < 0n
  const abs = (negative ? -value : value).toString().padStart(19, "0")
  return `${negative ? "-" : ""}${abs.slice(0, -18)}.${abs.slice(-18)}`
}
