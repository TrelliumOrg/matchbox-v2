import { formatBtc, formatBtcFigure } from "./btc"

type Decimal = { negative: boolean; int: bigint; fraction: string }

export function parseDecimal(value: string): Decimal {
  const trimmed = value.trim()
  const negative = trimmed.startsWith("-")
  const body = negative ? trimmed.slice(1) : trimmed
  const [int = "0", fraction = ""] = body.split(".")
  return { negative, int: BigInt(int === "" ? "0" : int), fraction }
}

/** Rounds half up to `places` decimals, returning integer and fraction digits. */
export function roundDecimal(
  value: Decimal,
  places: number,
): { int: bigint; fraction: string } {
  const digits = value.fraction.padEnd(places + 1, "0")
  const kept = digits.slice(0, places)
  const next = Number.parseInt(digits.charAt(places), 10)
  const scale = 10n ** BigInt(places)
  let scaled = value.int * scale + (kept === "" ? 0n : BigInt(kept))
  if (next >= 5) scaled += 1n
  const int = scaled / scale
  const fraction =
    places === 0 ? "" : (scaled % scale).toString().padStart(places, "0")
  return { int, fraction }
}

export function groupThousands(int: bigint): string {
  return int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/** "1234.5" with 2 places: "1,234.50". */
export function formatDecimal(value: string, places: number): string {
  const parsed = parseDecimal(value)
  const { int, fraction } = roundDecimal(parsed, places)
  const sign =
    parsed.negative && (int > 0n || /[1-9]/.test(fraction)) ? "-" : ""
  return `${sign}${groupThousands(int)}${places > 0 ? `.${fraction}` : ""}`
}

export type UsdStyle = "auto" | "cents" | "whole"

/** Whether a positive amount rounds to zero at `places` decimals. */
function hidesBelow(parsed: Decimal, places: number) {
  if (parsed.negative || parsed.int > 0n) return false
  if (!/[1-9]/.test(parsed.fraction)) return false
  const rounded = roundDecimal(parsed, places)
  return rounded.int === 0n && !/[1-9]/.test(rounded.fraction)
}

/** The smallest step at `places` decimals: "1", "0.01". */
function smallestStep(places: number): string {
  return places === 0 ? "1" : `0.${"0".repeat(places - 1)}1`
}

/**
 * USD with a dollar sign. "auto" keeps cents under $10,000 and drops them
 * above ($86.42, $1,240.00, $89,854). A positive amount too small for the
 * places shown reads "<$1" or "<$0.01", never "$0".
 */
export function formatUsd(value: string, style: UsdStyle = "auto"): string {
  const parsed = parseDecimal(value)
  const places =
    style === "cents"
      ? 2
      : style === "whole"
        ? 0
        : parsed.int >= 10_000n
          ? 0
          : 2
  if (hidesBelow(parsed, places)) return `<$${smallestStep(places)}`
  const body = formatDecimal(parsed.negative ? value.slice(1) : value, places)
  return `${parsed.negative ? "-" : ""}$${body}`
}

/** "+$654.60" for money in. */
export function formatSignedUsd(
  value: string,
  style: UsdStyle = "auto",
): string {
  return value.startsWith("-")
    ? formatUsd(value, style)
    : `+${formatUsd(value, style)}`
}

/** Decimals per token: BTC 4 to 6, MEZO and stablecoins 2. */
export function tokenPlaces(symbol: string, value: string): number {
  if (symbol === "BTC" || symbol.endsWith("BTC")) {
    return parseDecimal(value).int === 0n &&
      /^0{2,}/.test(parseDecimal(value).fraction)
      ? 6
      : 4
  }
  return 2
}

/**
 * BTC-like amounts follow @matchbox/ui's rule (4 decimals, 3 significant
 * figures when small). Others keep their places; a positive amount too
 * small for them reads "<0.01", never "0.00".
 */
export function formatToken(value: string, symbol: string): string {
  if (symbol === "BTC" || symbol.endsWith("BTC")) {
    return formatBtcFigure(value).text
  }
  const places = tokenPlaces(symbol, value)
  if (hidesBelow(parseDecimal(value), places)) return `<${smallestStep(places)}`
  return formatDecimal(value, places)
}

/** veBTC weights: "250.1660 veBTC", "0.000228 veBTC", never raw 18-decimal strings. */
export function formatVeBtc(value: string): string {
  return formatBtc(value, "veBTC").text
}

export function formatTokenWithSymbol(value: string, symbol: string): string {
  return `${formatToken(value, symbol)} ${symbol}`
}

/** Token prices: "$105,710", "$1.00", "$0.184". */
export function formatPrice(usd: string): string {
  const whole = parseDecimal(usd).int
  if (whole >= 1000n) return `$${formatDecimal(usd, 0)}`
  if (whole >= 1n) return `$${formatDecimal(usd, 2)}`
  // MEZO trades under a cent: 4 decimals ($0.0042).
  return `$${formatDecimal(usd, 4)}`
}
