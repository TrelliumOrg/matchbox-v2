/**
 * Shortens an address or hash in the middle: "0x7f3a…91c2" (the matchbox-v3
 * Data format for addresses). `head` counts the 0x. Values already short
 * enough come back whole.
 */
export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export type HashKind = "address" | "hash"

/** Addresses keep 6 and 4 characters, hashes 10 and 8 (block details). */
export const defaultLengths: Record<HashKind, { head: number; tail: number }> =
  {
    address: { head: 6, tail: 4 },
    hash: { head: 10, tail: 8 },
  }
