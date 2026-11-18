import { describe, expect, it } from "vitest"
import { formatSeen, formatShortDate, shortAddress } from "./format"
import { initials, nameHue, walletMark } from "./marks"
import { describeUserAgent } from "./user-agent"

describe("initials", () => {
  it("takes two words' initials or a single word's first two letters", () => {
    expect(initials("Stackbridge Rewards")).toBe("SR")
    expect(initials("  epoch   watch ")).toBe("EW")
    expect(initials("Gaugeboard")).toBe("GA")
    expect(initials("")).toBe("?")
  })
})

describe("marks", () => {
  it("are stable per name and address", () => {
    expect(nameHue("Gaugeboard")).toBe(nameHue("Gaugeboard"))
    const address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
    expect(walletMark(address)).toEqual(walletMark(address.toUpperCase()))
    expect(walletMark(address).initials).toBe("F3")
  })
})

describe("dates", () => {
  it("drops the year only for the current year", () => {
    const now = new Date("2026-10-21T12:00:00Z")
    expect(formatShortDate("2026-10-12T12:00:00Z", now)).toBe("12 Oct")
    expect(formatShortDate("2025-10-12T12:00:00Z", now)).toBe("12 Oct 2025")
  })

  it("names today and yesterday", () => {
    const now = new Date(2026, 10, 9, 18, 0)
    expect(formatSeen(new Date(2026, 10, 9, 15, 42).toISOString(), now)).toBe(
      "Today, 15:42",
    )
    expect(formatSeen(new Date(2026, 10, 8, 21, 8).toISOString(), now)).toBe(
      "Yesterday, 21:08",
    )
    expect(formatSeen(new Date(2026, 10, 2, 9, 14).toISOString(), now)).toBe(
      "2 Nov, 09:14",
    )
  })

  it("shortens addresses", () => {
    expect(shortAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")).toBe(
      "0xf39f…2266",
    )
  })
})

describe("describeUserAgent", () => {
  it("names the browser and system without a middle dot", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36",
      ),
    ).toBe("Chrome on macOS")
    expect(describeUserAgent(null)).toBe("Unknown device")
  })
})
