import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { type Address, getAddress, isAddress, zeroAddress } from "viem"
import type { IdentityLookup } from "../account/identity"
import {
  mezoIdNotFoundMessage,
  mezoIdUnavailableMessage,
} from "../account/recipient"

/**
 * Where a lock transfer goes, from what was typed: a 0x address, or a Mezo
 * ID ("pyke.mezo", by Mezo's rules in @matchbox/domain/mezo-id) that the
 * sheet looks up and then checks here.
 */

export type Recipient =
  | { kind: "empty" }
  | { kind: "address"; address: Address }
  | { kind: "name"; name: string }
  | { kind: "invalid"; message: string }
  /** The lookup failed (not "no such ID"): the sheet offers Try again. */
  | { kind: "unavailable"; message: string }

function toAddress(value: string, owner: string): Recipient {
  if (!isAddress(value, { strict: false }) || value === zeroAddress) {
    return { kind: "invalid", message: "Not an address" }
  }
  if (value.toLowerCase() === owner.toLowerCase()) {
    return { kind: "invalid", message: "Your own wallet" }
  }
  return { kind: "address", address: getAddress(value) }
}

export function parseRecipient(raw: string, owner: string): Recipient {
  const value = raw.trim()
  if (value === "") return { kind: "empty" }
  if (value.toLowerCase().endsWith(".mezo")) {
    const name = canonicalMezoId(value)
    return name === null
      ? { kind: "invalid", message: "Not a Mezo ID" }
      : { kind: "name", name }
  }
  return toAddress(value, owner)
}

/** A looked up Mezo ID: its address, or null when Mezo does not know it. */
export function resolvedRecipient(
  address: string | null,
  owner: string,
): Recipient {
  if (address === null) {
    return { kind: "invalid", message: mezoIdNotFoundMessage }
  }
  return toAddress(address, owner)
}

/** A Mezo ID's lookup as the recipient; null while it runs. */
export function lookedUpRecipient(
  lookup: IdentityLookup | null,
  owner: string,
): Recipient {
  if (lookup === null) return { kind: "empty" }
  if (lookup.status === "unavailable") {
    return { kind: "unavailable", message: mezoIdUnavailableMessage }
  }
  return resolvedRecipient(
    lookup.status === "found" ? lookup.identity.address : null,
    owner,
  )
}
