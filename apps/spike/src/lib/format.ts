const groupThousands = /\B(?=(\d{3})+(?!\d))/g

/** Formats a decimal USD string ("1180.00") without converting it to a float. */
export function formatUsd(decimal: string): string {
  const [whole = "0", fraction = "00"] = decimal.split(".")
  const cents = fraction.padEnd(2, "0").slice(0, 2)
  return `$${whole.replace(groupThousands, ",")}.${cents}`
}

/** Formats an integer count with thousands separators. */
export function formatCount(value: number): string {
  return String(value).replace(groupThousands, ",")
}
