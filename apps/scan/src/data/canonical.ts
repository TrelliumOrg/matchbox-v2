import { normalizeHex } from "@matchbox/domain/format"
import type { LockEscrow } from "../search/detect"

/**
 * One URL per entity, so the HTML cache never holds the same page under
 * two keys: hex lower-case with 0x, numbers without leading zeros, escrow
 * names lower-case. Each returns the canonical segment, or null when the
 * segment is not that kind of thing at all (the route's 404).
 */

const number = /^\d{1,12}$/

/** "0001" to "1". Null past 12 digits or for anything but digits. */
export function canonicalNumber(raw: string): string | null {
  if (!number.test(raw)) return null
  return String(Number(raw))
}

/** A 32-byte hash, any case, with or without 0x. */
export function canonicalHash(raw: string): string | null {
  return normalizeHex(raw, 32)
}

/**
 * An address, lower-cased. The EIP-55 checksum is checked where people type
 * (search), not here: route loaders ship in every page's entry chunk, and
 * the checksum's keccak would add about 65 kB brotli to first paint.
 */
export function canonicalAddress(raw: string): string | null {
  return normalizeHex(raw, 20)
}

/** A block by height ("13078795") or by hash. */
export function canonicalBlock(raw: string):
  | { kind: "height"; segment: string; height: number }
  | {
      kind: "hash"
      segment: string
    }
  | null {
  const height = canonicalNumber(raw)
  if (height !== null) {
    return { kind: "height", segment: height, height: Number(height) }
  }
  const hash = canonicalHash(raw)
  return hash === null ? null : { kind: "hash", segment: hash }
}

export function canonicalEscrow(raw: string): LockEscrow | null {
  const lower = raw.toLowerCase()
  return lower === "vebtc" || lower === "vemezo" ? lower : null
}
