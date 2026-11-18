import { describe, expect, it } from "vitest"
import { splitCidrs, unrestrictedCidrs } from "./cidrs"

describe("allowed IPs", () => {
  it("split on commas and spaces", () => {
    expect(splitCidrs(" 203.0.113.0/24,  2001:db8::/32 ,,")).toEqual([
      "203.0.113.0/24",
      "2001:db8::/32",
    ])
  })

  it("flag /0 entries, which allow every address", () => {
    expect(
      unrestrictedCidrs([
        "0.0.0.0/0",
        "::/0",
        "10.0.0.0/0",
        "2001:db8::/00",
        "203.0.113.0/24",
        "198.51.100.7",
        "10.0.0.0/10",
      ]),
    ).toEqual(["0.0.0.0/0", "::/0", "10.0.0.0/0", "2001:db8::/00"])
  })
})
