import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { maxQueryLength } from "./limits"

/**
 * Which `/internal/scan/search` kind a query is, after the browser's shape
 * detection: a full address (its label), a hex prefix (labels by address
 * prefix) or a name (labels and gauge names). Numbers and hashes are named
 * by their shape alone (epochs, locks, blocks, transactions), and a
 * Bitcoin address only by Mezo (use-mezo-id-search), so they ask nothing
 * more.
 */

export type ScanSearchKind = "name" | "address" | "address-prefix"

const fullAddress = /^0x[0-9a-fA-F]{40}$/
const addressPrefix = /^0x[0-9a-fA-F]{1,39}$/
const hexOnly = /^(0x)?[0-9a-fA-F]+$/
const number = /^[0-9][0-9,_ ]*$/
const controls = /\p{Cc}/u

export function scanSearchKind(query: string): ScanSearchKind | null {
  const q = query.trim()
  if (q.length < 2 || q.length > Math.min(maxQueryLength, 64)) return null
  if (controls.test(q)) return null
  if (fullAddress.test(q)) return "address"
  if (addressPrefix.test(q)) return "address-prefix"
  if (number.test(q) || hexOnly.test(q)) return null
  if (canonicalBtcAddress(q) !== null) return null
  return "name"
}
