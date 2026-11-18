import { describe, expect, it } from "vitest"
import { canonicalMezoId, mezoIdFromQuery } from "./mezo-id"

describe("canonicalMezoId", () => {
  it("lower-cases a full ID, as Mezo stores them", () => {
    expect(canonicalMezoId("alice.mezo")).toBe("alice.mezo")
    expect(canonicalMezoId(" Alice.MEZO ")).toBe("alice.mezo")
    expect(canonicalMezoId("a.mezo")).toBe("a.mezo")
    expect(canonicalMezoId("node-7.mezo")).toBe("node-7.mezo")
  })

  it("needs the .mezo suffix", () => {
    expect(canonicalMezoId("alice")).toBeNull()
    expect(canonicalMezoId("alice.eth")).toBeNull()
    expect(canonicalMezoId(".mezo")).toBeNull()
  })

  it("refuses what Mezo refuses, and anything that could leave the path", () => {
    for (const bad of [
      "a_b.mezo",
      "a b.mezo",
      "a.b.mezo",
      "été.mezo",
      "../x.mezo",
      "a/b.mezo",
      "a%2fb.mezo",
      "a?b.mezo",
      "a#b.mezo",
      "a:b.mezo",
      "a\u0000b.mezo",
    ]) {
      expect(canonicalMezoId(bad), bad).toBeNull()
    }
  })

  it("keeps to 63 characters before the suffix", () => {
    expect(canonicalMezoId(`${"a".repeat(63)}.mezo`)).not.toBeNull()
    expect(canonicalMezoId(`${"a".repeat(64)}.mezo`)).toBeNull()
  })
})

describe("mezoIdFromQuery", () => {
  it("reads a full ID", () => {
    expect(mezoIdFromQuery("Alice.mezo")).toBe("alice.mezo")
    expect(mezoIdFromQuery("x.mezo")).toBe("x.mezo")
  })

  it("adds the suffix to a bare name", () => {
    expect(mezoIdFromQuery("alice")).toBe("alice.mezo")
    expect(mezoIdFromQuery("Kiln")).toBe("kiln.mezo")
    expect(mezoIdFromQuery("node-7")).toBe("node-7.mezo")
  })

  it("leaves numbers, single characters and other shapes alone", () => {
    for (const other of [
      "",
      "a",
      "604",
      "13078795",
      "epoch 47",
      "veBTC #604",
      "mUSDC/MUSD",
      "a_b",
      "x".repeat(64),
    ]) {
      expect(mezoIdFromQuery(other), other).toBeNull()
    }
  })
})
