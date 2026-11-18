/**
 * Placeholder marks for apps without a logo and for wallets: initials on a
 * pastel circle (`@matchbox/ui/avatar`), the hue derived from the value so
 * the same app or wallet always looks the same.
 */

/** "Gauge Scout" → "GS", "Gaugeboard" → "GA", "" → "?". */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
  const [first, second] = words
  if (first === undefined) return "?"
  const letters =
    second === undefined
      ? Array.from(first).slice(0, 2)
      : [Array.from(first)[0], Array.from(second)[0]]
  return letters.join("").toUpperCase()
}

function hashOf(value: string): number {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return hash
}

/** A stable hue (0 to 359) for a name. */
export function nameHue(name: string): number {
  return hashOf(name) % 360
}

/** "F3" and a hue from the address's first bytes (case-insensitive). */
export function walletMark(address: string): { initials: string; hue: number } {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(6, "0")
  return {
    initials: hex.slice(0, 2).toUpperCase(),
    hue: Number.parseInt(hex.slice(2, 6), 16) % 360,
  }
}
