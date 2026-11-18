import { describe, expect, it } from "vitest"
import { scanSearchKind } from "./scan-kind"

describe("scan search kind", () => {
  it("asks for a label by address or prefix", () => {
    expect(scanSearchKind(`0x${"ab".repeat(20)}`)).toBe("address")
    expect(scanSearchKind("0x2ba6")).toBe("address-prefix")
  })

  it("asks for names", () => {
    expect(scanSearchKind("kiln")).toBe("name")
    expect(scanSearchKind("Mezo USD")).toBe("name")
  })

  it("leaves numbers, hashes and bare hex to their shape", () => {
    expect(scanSearchKind("47")).toBeNull()
    expect(scanSearchKind("13,118,064")).toBeNull()
    expect(scanSearchKind(`0x${"1".repeat(64)}`)).toBeNull()
    expect(scanSearchKind("deadbeef")).toBeNull()
  })

  it("leaves a Bitcoin address to Mezo's lookup", () => {
    expect(
      scanSearchKind("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"),
    ).toBeNull()
    expect(scanSearchKind("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBeNull()
    // Testnet is no Bitcoin address here: a name like any other.
    expect(scanSearchKind("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBe(
      "name",
    )
  })

  it("skips what the API would refuse", () => {
    expect(scanSearchKind("k")).toBeNull()
    expect(scanSearchKind("x".repeat(65))).toBeNull()
    expect(scanSearchKind(`ki${String.fromCodePoint(7)}ln`)).toBeNull()
  })
})
