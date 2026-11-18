import { formatBtc, fromWei } from "@matchbox/ui/amount"
import { groupThousands } from "./money"

/** Whole units from an 18-decimal wei string, rounded down. */
export function weiToWhole(wei: string): bigint {
  return BigInt(wei) / 10n ** 18n
}

/** "5,880,000" from wei. */
export function formatVotes(wei: string): string {
  return groupThousands(weiToWhole(wei))
}

/**
 * Votes always carry the escrow's unit: "22,582 veMEZO" (whole votes) or
 * "0.8000 veBTC" (@matchbox/ui's BTC rule). `wei` has 18 decimals.
 */
export function formatVoteAmount(
  wei: string | bigint,
  unit: "veMEZO" | "veBTC",
): string {
  const value = typeof wei === "bigint" ? wei : BigInt(wei)
  if (unit === "veMEZO")
    return `${groupThousands(weiToWhole(`${value}`))} veMEZO`
  return formatBtc(fromWei(value), "veBTC").text
}

const compactUnits = [
  { at: 1_000_000_000n, suffix: "B" },
  { at: 1_000_000n, suffix: "M" },
  { at: 1_000n, suffix: "k" },
] as const

/**
 * Compact counts for whole numbers: 41.26k, 5.88M, 282.9M, 923.4k. Two
 * decimals below 100 of the unit, one above. Thousands drop trailing zeros
 * (690k).
 */
export function formatCompact(whole: bigint | string): string {
  const value = typeof whole === "string" ? BigInt(whole) : whole
  const negative = value < 0n
  const abs = negative ? -value : value
  for (const unit of compactUnits) {
    if (abs >= unit.at) {
      const places = abs / unit.at >= 100n ? 1 : 2
      const scale = 10n ** BigInt(places)
      const scaled = (abs * scale + unit.at / 2n) / unit.at
      const int = scaled / scale
      let fraction = (scaled % scale).toString().padStart(places, "0")
      if (unit.suffix === "k") fraction = fraction.replace(/0+$/, "")
      const body = `${groupThousands(int)}${fraction === "" ? "" : `.${fraction}`}`
      return `${negative ? "-" : ""}${body}${unit.suffix}`
    }
  }
  return `${negative ? "-" : ""}${abs.toString()}`
}

/** Compact votes from wei. */
export function formatCompactVotes(wei: string): string {
  return formatCompact(weiToWhole(wei))
}
