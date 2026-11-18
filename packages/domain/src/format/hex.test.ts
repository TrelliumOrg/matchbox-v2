import { getAddress } from "viem"
import { describe, expect, it } from "vitest"
import { isValidAddress } from "../checksum"
import {
  isAddress20,
  isHash32,
  normalizeHex,
  shortHash,
  truncateMiddle,
} from "./hex"

const lower = "0x7c21a4b8f3e9d2c1b0a5968778f6e5d4c3b29e0b"
const checksummed = getAddress(lower)

/** The checksummed address with its first letter's case flipped. */
function flipOneLetter(value: string): string {
  const at = value.slice(2).search(/[a-fA-F]/) + 2
  const letter = value.charAt(at)
  const flipped =
    letter === letter.toLowerCase()
      ? letter.toUpperCase()
      : letter.toLowerCase()
  return `${value.slice(0, at)}${flipped}${value.slice(at + 1)}`
}

describe("hex", () => {
  it("truncates in the middle in the house formats", () => {
    expect(truncateMiddle("0x7f3a9c21d0e4b8f61a2c3e5d7b9f0a1c2e4d91c2")).toBe(
      "0x7f3a…91c2",
    )
    expect(shortHash(`0x8f3c2e71${"a".repeat(48)}5b09a41d`)).toBe(
      "0x8f3c2e71…5b09a41d",
    )
    expect(truncateMiddle("0x1234")).toBe("0x1234")
  })

  it("accepts lower, upper and correctly checksummed addresses only", () => {
    expect(checksummed).not.toBe(lower)
    expect(isValidAddress(lower)).toBe(true)
    expect(isValidAddress(`0x${lower.slice(2).toUpperCase()}`)).toBe(true)
    expect(isValidAddress(checksummed)).toBe(true)
    // One flipped letter breaks EIP-55.
    expect(isValidAddress(flipOneLetter(checksummed))).toBe(false)
    expect(isValidAddress("0x1234")).toBe(false)
    expect(isAddress20(flipOneLetter(checksummed))).toBe(true)
  })

  it("normalises typed hex, with or without 0x", () => {
    const body = "AB".repeat(32)
    expect(normalizeHex(body, 32)).toBe(`0x${"ab".repeat(32)}`)
    expect(normalizeHex(`0X${body}`, 32)).toBe(`0x${"ab".repeat(32)}`)
    expect(normalizeHex(`0x${body}`, 20)).toBeNull()
    expect(normalizeHex("zz".repeat(20), 20)).toBeNull()
    expect(isHash32(`0x${body}`)).toBe(true)
    expect(isHash32(body)).toBe(false)
  })
})
