import { describe, expect, it } from "vitest"
import {
  canonicalAddress,
  canonicalBlock,
  canonicalEscrow,
  canonicalHash,
  canonicalNumber,
} from "./canonical"

/** EIP-55's own example, and the same address with one letter's case flipped. */
const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
const badChecksum = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
const lower = checksummed.toLowerCase()
const hash = `0x${"8d3f1b6c".repeat(8)}`

describe("canonical URLs", () => {
  it("drops leading zeros and refuses non-numbers", () => {
    expect(canonicalNumber("0001")).toBe("1")
    expect(canonicalNumber("007")).toBe("7")
    expect(canonicalNumber("0")).toBe("0")
    expect(canonicalNumber("1e3")).toBeNull()
    expect(canonicalNumber("1".repeat(13))).toBeNull()
  })

  it("lower-cases hashes and adds 0x", () => {
    expect(canonicalHash(hash.toUpperCase().replace("0X", "0X"))).toBe(hash)
    expect(canonicalHash(hash.slice(2))).toBe(hash)
    expect(canonicalHash("0x1234")).toBeNull()
  })

  it("lower-cases addresses (search checks the checksum)", () => {
    expect(canonicalAddress(checksummed)).toBe(lower)
    expect(canonicalAddress(lower.toUpperCase().replace("0X", "0x"))).toBe(
      lower,
    )
    expect(canonicalAddress(lower.slice(2))).toBe(lower)
    expect(canonicalAddress(badChecksum)).toBe(lower)
    expect(canonicalAddress("0x1234")).toBeNull()
  })

  it("reads a block segment as a height or a hash", () => {
    expect(canonicalBlock("0013078795")).toEqual({
      kind: "height",
      segment: "13078795",
      height: 13_078_795,
    })
    expect(canonicalBlock(hash.toUpperCase().replace("0X", "0x"))).toEqual({
      kind: "hash",
      segment: hash,
    })
    expect(canonicalBlock("abc")).toBeNull()
  })

  it("names escrows in lower case", () => {
    expect(canonicalEscrow("veBTC")).toBe("vebtc")
    expect(canonicalEscrow("vemezo")).toBe("vemezo")
    expect(canonicalEscrow("lock")).toBeNull()
  })
})
