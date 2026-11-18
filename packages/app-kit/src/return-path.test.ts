import { describe, expect, it } from "vitest"
import { InvalidIdError, idSegment, isUuid } from "./ids"
import { safeReturnPath } from "./return-path"

const backslash = String.fromCodePoint(92)

/** Ported from Matchbox ID's and Developer's return-path and id tests. */

describe("safeReturnPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeReturnPath("/authorize?request=abc")).toBe(
      "/authorize?request=abc",
    )
    expect(safeReturnPath("/")).toBe("/")
  })

  it("rejects anything that could leave the origin", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example/x",
      `/${backslash}evil.example`,
      "javascript:alert(1)",
      "",
      42,
      undefined,
      `/${"a".repeat(2048)}`,
    ]) {
      expect(safeReturnPath(value)).toBeNull()
    }
  })

  it("rejects paths that normalise to protocol-relative URLs", () => {
    for (const value of [
      "/.//evil.com",
      "/..//evil.com",
      "/%2e//evil.com",
      "/%2e%2e//evil.com",
      "/a/..//evil.com",
      `/./${backslash}evil.com`,
      `/${String.fromCodePoint(9)}/evil.com`,
      `/${String.fromCodePoint(10)}/evil.com`,
      `/${String.fromCodePoint(0)}/evil.com`,
    ]) {
      expect(safeReturnPath(value)).toBeNull()
    }
  })

  it("keeps encoded slashes, at signs and backslashes as path text", () => {
    expect(safeReturnPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com")
    expect(safeReturnPath("/%5Cevil.com")).toBe("/%5Cevil.com")
    expect(safeReturnPath("/@evil.com")).toBe("/@evil.com")
  })
})

describe("ids", () => {
  it("accepts UUIDs only, so inputs cannot rewrite internal paths", () => {
    const id = "2b5a2814-a844-4572-aa2e-75650fd3841c"
    expect(idSegment(id)).toBe(id)
    expect(isUuid(id)).toBe(true)
    for (const value of ["..", "../apps", `${id}/..`, "%2e%2e", "", 1, null]) {
      expect(() => idSegment(value)).toThrow(InvalidIdError)
      expect(isUuid(value)).toBe(false)
    }
  })
})
