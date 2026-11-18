/**
 * Hex values as people type and read them: middle truncation for display,
 * and the shapes an explorer accepts. One home for what Matchscan, Pro and
 * Stuart each wrote a copy of. No dependency: pages import this on first
 * paint. The EIP-55 checksum (keccak) lives in `@matchbox/domain/checksum`.
 */

/**
 * Shortens a value in the middle: "0x7f3a…91c2" with the defaults (the
 * matchbox-v3 address format). `head` counts the 0x. Short values come back
 * whole.
 */
export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** "0x8f3c2e71…5b09a41d": a 32-byte hash as block details show it. */
export function shortHash(hash: string): string {
  return truncateMiddle(hash, 10, 8)
}

const hash32 = /^0x[0-9a-fA-F]{64}$/
const address20 = /^0x[0-9a-fA-F]{40}$/

/** A 0x-prefixed 32-byte value: a transaction or block hash. */
export function isHash32(value: string): boolean {
  return hash32.test(value)
}

/** A 0x-prefixed 20-byte value, any case (no checksum check: see ../checksum). */
export function isAddress20(value: string): boolean {
  return address20.test(value)
}

/**
 * "0x" plus lower-case hex from what someone typed: with or without the
 * prefix, any case. Null when it is not hex of exactly `bytes` bytes.
 */
export function normalizeHex(value: string, bytes: number): string | null {
  const trimmed = value.trim()
  const body = /^0[xX]/.test(trimmed) ? trimmed.slice(2) : trimmed
  if (body.length !== bytes * 2 || !/^[0-9a-fA-F]+$/.test(body)) return null
  return `0x${body.toLowerCase()}`
}
