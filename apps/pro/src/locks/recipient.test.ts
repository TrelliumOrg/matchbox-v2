import { getAddress } from "viem"
import { describe, expect, it } from "vitest"
import {
  lookedUpRecipient,
  parseRecipient,
  resolvedRecipient,
} from "./recipient"

const owner = "0x7c21000000000000000000000000000000009e0b"
const friend = "0xf365000000000000000000000000000000008bc4"

function upper(address: string): string {
  return address.toUpperCase().replace("0X", "0x")
}

describe("parseRecipient", () => {
  it("waits for input", () => {
    expect(parseRecipient("  ", owner)).toEqual({ kind: "empty" })
  })

  it("takes a 0x address in any case, checksummed", () => {
    expect(parseRecipient(` ${upper(friend)} `, owner)).toEqual({
      kind: "address",
      address: getAddress(friend),
    })
  })

  it("takes a Mezo ID to look up, in lower case", () => {
    expect(parseRecipient(" Pyke.mezo ", owner)).toEqual({
      kind: "name",
      name: "pyke.mezo",
    })
    expect(parseRecipient(".mezo", owner)).toEqual({
      kind: "invalid",
      message: "Not a Mezo ID",
    })
  })

  it("reads Mezo IDs by Mezo's rules, as Matchscan does", () => {
    expect(parseRecipient("my-wallet-2.MEZO", owner)).toEqual({
      kind: "name",
      name: "my-wallet-2.mezo",
    })
    // Mezo refuses an underscore, a dot inside the name, anything
    // non-ASCII and a name over 63 characters.
    for (const input of [
      "pyke_1.mezo",
      "a.b.mezo",
      "café.mezo",
      `${"a".repeat(64)}.mezo`,
    ]) {
      expect(parseRecipient(input, owner), input).toEqual({
        kind: "invalid",
        message: "Not a Mezo ID",
      })
    }
  })

  it("refuses garbage, the zero address and the owner itself", () => {
    expect(parseRecipient("0x1234", owner)).toEqual({
      kind: "invalid",
      message: "Not an address",
    })
    expect(
      parseRecipient("0x0000000000000000000000000000000000000000", owner),
    ).toEqual({ kind: "invalid", message: "Not an address" })
    expect(parseRecipient(upper(owner), owner)).toEqual({
      kind: "invalid",
      message: "Your own wallet",
    })
  })
})

describe("resolvedRecipient", () => {
  it("sends to the address a Mezo ID names", () => {
    expect(resolvedRecipient(friend, owner)).toEqual({
      kind: "address",
      address: getAddress(friend),
    })
  })

  it("says when Mezo does not know the ID, or it is the owner's", () => {
    expect(resolvedRecipient(null, owner)).toEqual({
      kind: "invalid",
      message: "Mezo ID not found",
    })
    expect(resolvedRecipient(owner, owner)).toEqual({
      kind: "invalid",
      message: "Your own wallet",
    })
  })
})

describe("lookedUpRecipient", () => {
  it("waits, sends to a found wallet, and says when Mezo has no such ID", () => {
    expect(lookedUpRecipient(null, owner)).toEqual({ kind: "empty" })
    expect(
      lookedUpRecipient(
        {
          status: "found",
          identity: { address: friend, mezoId: "pyke.mezo" },
        },
        owner,
      ),
    ).toEqual({ kind: "address", address: getAddress(friend) })
    expect(lookedUpRecipient({ status: "not-found" }, owner)).toEqual({
      kind: "invalid",
      message: "Mezo ID not found",
    })
  })

  it("says to try again when the lookup failed, never 'not found'", () => {
    expect(lookedUpRecipient({ status: "unavailable" }, owner)).toEqual({
      kind: "unavailable",
      message: "Couldn't look up this Mezo ID. Try again.",
    })
  })
})
