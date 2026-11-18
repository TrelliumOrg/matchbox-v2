import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { type Address, getAddress, isAddress, zeroAddress } from "viem"

/** When Mezo has no such ID. */
export const mezoIdNotFoundMessage = "Mezo ID not found"

/** When the lookup failed: not the same as "no such ID". */
export const mezoIdUnavailableMessage =
  "Couldn't look up this Mezo ID. Try again."

/**
 * What the Send sheet's To field holds: an address (any case, a checksum
 * must be right when mixed case), a Mezo ID typed in full ("alice.mezo")
 * by Mezo's rules (@matchbox/domain/mezo-id, as Matchscan reads them), or
 * neither. A bare word is never read as an ID: a pasted Bitcoin address or
 * an address missing its 0x would otherwise become someone's Mezo ID.
 */
export type Recipient =
  | { kind: "empty" }
  | { kind: "address"; address: Address }
  | { kind: "mezo-id"; name: string }
  | { kind: "invalid"; reason: string }

/** Why bare text is not a recipient, as specific as the text allows. */
function bareReason(text: string): string {
  if (/^[0-9a-f]{40}$/i.test(text)) return "Add 0x to the start of the address"
  if (
    /^(bc1|tb1|bcrt1)[a-z0-9]{8,}$/i.test(text) ||
    /^[13mn2][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(text)
  ) {
    return "Bitcoin address. Send to a 0x address on Mezo"
  }
  return "Add .mezo for a Mezo ID, or use a 0x address"
}

export function parseRecipient(input: string): Recipient {
  const trimmed = input.trim()
  if (trimmed === "") return { kind: "empty" }
  // An ID first: "0xabc.mezo" is an ID, not a bad address.
  if (/\.mezo$/i.test(trimmed)) {
    const name = canonicalMezoId(trimmed)
    if (name === null) return { kind: "invalid", reason: "Not a Mezo ID" }
    return { kind: "mezo-id", name }
  }
  if (/^0x/i.test(trimmed)) {
    if (!isAddress(trimmed, { strict: false }))
      return { kind: "invalid", reason: "Not a valid address" }
    if (/[a-f]/.test(trimmed.slice(2)) && /[A-F]/.test(trimmed.slice(2))) {
      if (!isAddress(trimmed, { strict: true }))
        return { kind: "invalid", reason: "Address checksum does not match" }
    }
    const address = getAddress(trimmed)
    if (address === zeroAddress)
      return { kind: "invalid", reason: "Cannot send to the zero address" }
    return { kind: "address", address }
  }
  return { kind: "invalid", reason: bareReason(trimmed) }
}
