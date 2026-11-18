import { checksumAddress } from "viem"
import { isAddress20 } from "./format/hex"

/**
 * EIP-55, apart from the formatters because it needs keccak (viem): import
 * it where people type addresses, never on a page's first paint.
 */

/**
 * A 0x-prefixed address whose checksum holds: all lower case and all upper
 * case carry no checksum and are accepted; mixed case must match EIP-55.
 */
export function isValidAddress(value: string): boolean {
  if (!isAddress20(value)) return false
  const body = value.slice(2)
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true
  return checksumAddress(`0x${body.toLowerCase()}`) === value
}
