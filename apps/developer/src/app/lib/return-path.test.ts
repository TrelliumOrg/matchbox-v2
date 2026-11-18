import { describe, expect, it } from "vitest"
import { safeReturn, signInDestination } from "../../routes/sign-in"

describe("console sign-in return path", () => {
  it("keeps same-origin paths, including Classic ?redirect= targets", () => {
    expect(safeReturn("/apps?org=x")).toBe("/apps?org=x")
    expect(safeReturn("/organization")).toBe("/organization")
    expect(safeReturn("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com")
    expect(safeReturn("/@evil.com")).toBe("/@evil.com")
  })

  it("falls back to / for anything that could leave the origin", () => {
    for (const value of [
      "//evil.com",
      "https://evil.com",
      "https://user@evil.com",
      "/\\evil.com",
      "/./\\evil.com",
      "/.//evil.com",
      "/..//evil.com",
      "/%2e//evil.com",
      "/%2e%2e//evil.com",
      "/a/..//evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\u0000/evil.com",
      "javascript:alert(1)",
      undefined,
    ]) {
      expect(safeReturn(value)).toBe("/")
    }
  })
})

describe("console sign-in destination", () => {
  it("goes to the organization after an invitation sign-in, as Classic did", () => {
    expect(signInDestination({ invitation: "tok" })).toBe("/organization")
    expect(signInDestination({ invitation: "tok", redirect: "/apps" })).toBe(
      "/apps",
    )
    expect(signInDestination({ redirect: "/apps" })).toBe("/apps")
    expect(signInDestination({ return: "//evil.com" })).toBe("/")
    expect(signInDestination({})).toBe("/")
  })
})
