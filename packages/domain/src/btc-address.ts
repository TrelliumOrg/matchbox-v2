/**
 * Bitcoin addresses, as Mezo's accounts API takes them (`/accounts/{btc}`),
 * probed 13 Nov 2026:
 *
 * - A linked address answers its Mezo account; any other is not found
 *   (404), testnet ones included.
 * - Exact match: a bech32 address is found lower case only (the same
 *   address upper case is 404), so it is lower-cased here. Base58 is
 *   case-sensitive and passed on as typed.
 *
 * Mainnet only, by shape (no checksum): P2PKH ("1…") and P2SH ("3…") in
 * base58, 26 to 35 characters; SegWit v0 ("bc1q…", 42 or 62 characters)
 * and Taproot ("bc1p…", 62) in bech32's alphabet, in one case. Testnet and
 * regtest ("tb1…", "bcrt1…", "m…", "n…", "2…") are refused. What passes is
 * only ASCII letters and digits, so it is safe in a URL path as it is.
 *
 * Pure and tiny: Matchscan's search palette imports it.
 */

const base58 = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/
const bech32 =
  /^bc1(?:q(?:[02-9ac-hj-np-z]{38}|[02-9ac-hj-np-z]{58})|p[02-9ac-hj-np-z]{58})$/

/**
 * A mainnet Bitcoin address typed or linked (" bc1q… ", "BC1Q…"), as the
 * key to look up, or null when it is not one.
 */
export function canonicalBtcAddress(raw: string): string | null {
  const value = raw.trim()
  if (value.length > 62) return null
  if (base58.test(value)) return value
  const lower = value.toLowerCase()
  // Bech32 is one case throughout; mixed case is no address.
  if (value !== lower && value !== value.toUpperCase()) return null
  return bech32.test(lower) ? lower : null
}
