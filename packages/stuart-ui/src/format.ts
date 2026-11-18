import type { TokenAmount } from "./contract"

/**
 * Display formatting for wire values. Money stays in strings and bigints:
 * never parseFloat, Number or toFixed on an amount (financial-precision).
 * Negative figures use the minus sign U+2212, never a dash.
 */

const minus = "−"

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

/** `value / 10^decimals`, rounded half up to `places`, as a bigint scaled by 10^places. */
function rescale(value: bigint, decimals: number, places: number): bigint {
  if (places >= decimals) return value * pow10(places - decimals)
  const divisor = pow10(decimals - places)
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const rounded = (magnitude + divisor / 2n) / divisor
  return negative ? -rounded : rounded
}

/** A scaled bigint as "1,234.56". */
function fixed(scaled: bigint, places: number): string {
  const negative = scaled < 0n
  const digits = (negative ? -scaled : scaled)
    .toString()
    .padStart(places + 1, "0")
  const whole = group(digits.slice(0, digits.length - places))
  const fraction = places > 0 ? `.${digits.slice(digits.length - places)}` : ""
  return `${negative ? minus : ""}${whole}${fraction}`
}

/** "-12.345000" to a bigint in micro units. */
function parseUsd6(usd6: string): bigint {
  const match = /^(-?)(\d+)\.(\d{6})$/.exec(usd6)
  if (match === null) return 0n
  const value = BigInt(`${match[2]}${match[3]}`)
  return match[1] === "-" ? -value : value
}

/**
 * USD from a 6-dp wire string: "$1,180.00", "$89,854" from 10,000 up.
 * `signed` adds "+" to positive values (deltas).
 */
export function formatUsd(
  usd6: string,
  options?: { signed?: boolean },
): string {
  const micro = parseUsd6(usd6)
  const magnitude = micro < 0n ? -micro : micro
  const places = magnitude >= 10_000_000_000n ? 0 : 2
  const body = fixed(rescale(magnitude, 6, places), places)
  if (micro < 0n) return `${minus}$${body}`
  return `${options?.signed === true && micro > 0n ? "+" : ""}$${body}`
}

/** `after - before` for two 6-dp USD strings, as a 6-dp USD string. */
export function usdDelta(after: string, before: string): string {
  const micro = parseUsd6(after) - parseUsd6(before)
  const negative = micro < 0n
  const digits = (negative ? -micro : micro).toString().padStart(7, "0")
  return `${negative ? "-" : ""}${digits.slice(0, -6)}.${digits.slice(-6)}`
}

/** Whether a 6-dp USD string is above zero. */
export function isPositiveUsd(usd6: string): boolean {
  return parseUsd6(usd6) > 0n
}

/** Decimal places per asset (matchbox-v3 Data formats). */
function placesFor(symbol: string): number {
  if (symbol === "BTC" || symbol.endsWith("BTC")) return 4
  return 2
}

/** "0.8000 BTC", "48,000.00 MEZO". */
export function formatToken(amount: TokenAmount, places?: number): string {
  const digits = places ?? placesFor(amount.symbol)
  const raw = BigInt(amount.raw)
  if (digits === 4 && raw > 0n) {
    const tiny = tinyBtc(raw, amount.decimals)
    if (tiny !== null) return `${tiny} ${amount.symbol}`
  }
  const scaled = rescale(raw, amount.decimals, digits)
  return `${fixed(scaled, digits)} ${amount.symbol}`
}

/**
 * BTC and veBTC below 0.0001 (matchbox-v3 Data formats, ledger C5): three
 * significant figures, and "<0.000001" below that. Null when the normal
 * four decimals apply.
 */
function tinyBtc(raw: bigint, decimals: number): string | null {
  if (decimals < 6) return null
  if (raw >= pow10(decimals - 4)) return null
  if (raw < pow10(decimals - 6)) return "<0.000001"
  const digits = raw.toString().padStart(decimals, "0")
  const firstSignificant = digits.search(/[1-9]/)
  const places = Math.min(decimals, firstSignificant + 3)
  return fixed(rescale(raw, decimals, places), places)
}

/** Whole units with grouping: "5,880,000". */
export function formatWhole(raw: string, decimals: number): string {
  return fixed(rescale(BigInt(raw), decimals, 0), 0)
}

/** Compact votes: "22.15k", "1.09M", "6.97M". */
export function formatCompact(raw: string, decimals: number): string {
  const value = BigInt(raw)
  const units = [
    { exponent: 9, suffix: "B" },
    { exponent: 6, suffix: "M" },
    { exponent: 3, suffix: "k" },
  ]
  for (const unit of units) {
    const hundredths = rescale(value, decimals + unit.exponent, 2)
    if (hundredths >= 100n) return `${fixed(hundredths, 2)}${unit.suffix}`
  }
  return fixed(rescale(value, decimals, 2), 2)
}

/** Basis points as a percent with two places: 330 to "3.30%". */
export function formatBps(bps: number, options?: { signed?: boolean }): string {
  const scaled = BigInt(bps)
  const text = fixed(scaled, 2)
  return `${options?.signed === true && bps > 0 ? "+" : ""}${text}%`
}

/** An allocation share, trailing zeros dropped: 7000 to "70%", 3350 to "33.5%". */
export function formatShare(bps: number): string {
  const text = fixed(BigInt(bps), 2).replace(/\.?0+$/, "")
  return `${text}%`
}

/** "13,078,795". */
export function formatBlock(block: string): string {
  return group(block.replace(/^0+(?=\d)/, ""))
}

/** A boost from a 1e18 wad: "4.4×". */
export function formatBoost(wad: string): string {
  return `${fixed(rescale(BigInt(wad), 18, 1), 1)}×`
}

/** A collateral ratio from basis points: 29477 to "294.77%". */
export function formatRatio(bps: number): string {
  return `${fixed(BigInt(bps), 2)}%`
}

/** Ratio of two token amounts as basis points, clamped to 0..10000. */
export function shareBps(part: string, whole: string): number {
  const total = BigInt(whole)
  if (total <= 0n) return 0
  const bps = (BigInt(part) * 10_000n) / total
  return bps > 10_000n ? 10_000 : Number(bps)
}

/** Shortened address: 0x7c21…9e0B. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** "1 signature", "2 signatures". */
export function signatures(count: number): string {
  return `${count} ${count === 1 ? "signature" : "signatures"}`
}
