import { describe, expect, it } from "vitest"
import {
  addressAvatar,
  formatAgo,
  formatApy,
  formatChange,
  formatCompact,
  formatCompactVotes,
  formatDate,
  formatDay,
  formatDayLong,
  formatDecimal,
  formatDuration,
  formatPrice,
  formatShare,
  formatSignedUsd,
  formatTime,
  formatToken,
  formatUsd,
  formatVeBtc,
  formatVotes,
  isAddress,
  shortAddress,
} from "./format"

describe("money", () => {
  it("formats USD the way the guideline does", () => {
    expect(formatUsd("86.42")).toBe("$86.42")
    expect(formatUsd("1240")).toBe("$1,240.00")
    expect(formatUsd("89854.4")).toBe("$89,854")
    expect(formatUsd("14820", "cents")).toBe("$14,820.00")
    expect(formatUsd("8832", "whole")).toBe("$8,832")
    expect(formatSignedUsd("654.6", "cents")).toBe("+$654.60")
    expect(formatUsd("-12.5")).toBe("-$12.50")
  })

  it("rounds half up without floating point", () => {
    expect(formatDecimal("0.005", 2)).toBe("0.01")
    expect(formatDecimal("1.004", 2)).toBe("1.00")
    expect(formatDecimal("999.995", 2)).toBe("1,000.00")
    expect(formatDecimal("123456789012345678.129", 2)).toBe(
      "123,456,789,012,345,678.13",
    )
  })

  it("gives BTC 4 to 6 decimals and MEZO 2", () => {
    expect(formatToken("0.8", "BTC")).toBe("0.8000")
    expect(formatToken("0.000412", "BTC")).toBe("0.000412")
    expect(formatToken("812.4", "MEZO")).toBe("812.40")
  })

  it("formats prices by size", () => {
    expect(formatPrice("105710")).toBe("$105,710")
    expect(formatPrice("1")).toBe("$1.00")
    expect(formatPrice("0.184")).toBe("$0.1840")
    expect(formatPrice("0.00421")).toBe("$0.0042")
  })
})

describe("votes and rates", () => {
  const wei = (whole: string): string => `${BigInt(whole) * 10n ** 18n}`

  it("prints counts in full and compact", () => {
    expect(formatVotes(wei("5880000"))).toBe("5,880,000")
    expect(formatCompactVotes(wei("41260"))).toBe("41.26k")
    expect(formatCompactVotes(wei("5880000"))).toBe("5.88M")
    expect(formatCompactVotes(wei("282900000"))).toBe("282.9M")
    expect(formatCompact(690_000n)).toBe("690k")
    expect(formatCompact(923_400n)).toBe("923.4k")
    expect(formatCompact(999n)).toBe("999")
  })

  it("formats basis points", () => {
    expect(formatApy(256)).toBe("2.56%")
    expect(formatApy(5)).toBe("0.05%")
    expect(formatShare(7000)).toBe("70%")
    expect(formatChange(180)).toBe("+1.8%")
    expect(formatChange(-240)).toBe("-2.4%")
  })
})

describe("time", () => {
  const thursday = Date.UTC(2026, 10, 5, 9, 40) / 1000

  it("formats dates in UTC with real weekdays", () => {
    expect(formatDay(thursday)).toBe("Thu 5 Nov")
    expect(formatDayLong(thursday)).toBe("Thursday 5 Nov")
    expect(formatDate(Date.UTC(2030, 0, 9) / 1000)).toBe("9 Jan 2030")
    expect(formatTime(thursday)).toBe("09:40")
  })

  it("formats durations", () => {
    expect(formatDuration(3 * 86_400 + 12 * 3600 + 420)).toBe("3d 12h")
    expect(formatDuration(5 * 3600 + 20 * 60)).toBe("5h 20m")
    expect(formatDuration(-4)).toBe("0s")
    expect(formatAgo(120)).toBe("2m")
    expect(formatAgo(10_800)).toBe("3h")
  })
})

describe("addresses", () => {
  const address = "0x7c21a4b8f3e9d2c1b0a5968778f6e5d4c3b29e0B"

  it("shortens and validates", () => {
    expect(shortAddress(address)).toBe("0x7c21…9e0B")
    expect(isAddress(address)).toBe(true)
    expect(isAddress("0x7c21")).toBe(false)
    expect(isAddress(42)).toBe(false)
  })

  it("derives the avatar from the address byte", () => {
    expect(addressAvatar(address)).toEqual({ initials: "7C", hue: 174 })
  })
})

describe("veBTC weights", () => {
  it("show 4 decimals, never the raw 18-decimal string", () => {
    expect(formatVeBtc("250.166000859788582573")).toBe("250.1660 veBTC")
    expect(formatVeBtc("1060000")).toBe("1,060,000.0000 veBTC")
  })
})
