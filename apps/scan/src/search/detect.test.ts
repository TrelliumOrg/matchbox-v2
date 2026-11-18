import { describe, expect, it } from "vitest"
import { detect, maxQueryLength, targetLabel, targetPath } from "./detect"

const context = { head: 13_078_795, epoch: 47 }
const hash =
  "0x8D3F1B6CA29E04F7B51C3D88E6A0F2B4C917D5E3A06B8F12C4D7E9A1B3F544E0"
const address = "0x7C21a4b8f3e9d2c1b0a5968778f6e5d4c3b29e0B"

/** EIP-55's own example, and with one letter's case flipped. */
const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
const badChecksum = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"

describe("search shapes", () => {
  it("offers a 32-byte value as a transaction or a block hash", () => {
    const lower = hash.toLowerCase()
    expect(detect(hash, context)).toEqual([
      { kind: "tx", hash: lower },
      { kind: "block-hash", hash: lower },
    ])
    // Without 0x too: 64 hex characters are unambiguous.
    expect(detect(hash.slice(2), context)).toEqual(detect(hash, context))
  })

  it("reads addresses, checksum first", () => {
    expect(detect(` ${address.toLowerCase()} `, context)).toEqual([
      { kind: "address", address: address.toLowerCase() },
    ])
    expect(detect(address.toUpperCase().replace("0X", "0x"), context)).toEqual([
      { kind: "address", address: address.toLowerCase() },
    ])
    expect(detect(checksummed, context)).toEqual([
      { kind: "address", address: checksummed.toLowerCase() },
    ])
    expect(detect(checksummed.slice(2), context)).toHaveLength(1)
    expect(detect(badChecksum, context)).toEqual([])
  })

  it("takes labelled numbers at their word, escrow included", () => {
    expect(detect("epoch 47", context)).toEqual([{ kind: "epoch", number: 47 }])
    expect(detect("E12", context)).toEqual([{ kind: "epoch", number: 12 }])
    expect(detect("veBTC #604", context)).toEqual([
      { kind: "lock", escrow: "vebtc", id: 604 },
    ])
    expect(detect("vemezo 604", context)).toEqual([
      { kind: "lock", escrow: "vemezo", id: 604 },
    ])
    expect(detect("#6033", context)).toEqual([
      { kind: "lock", escrow: "vebtc", id: 6033 },
      { kind: "lock", escrow: "vemezo", id: 6033 },
    ])
    expect(detect("block 13,078,795", context)).toEqual([
      { kind: "block", height: 13_078_795 },
    ])
  })

  it("offers every reading of a bare number, likeliest first", () => {
    const kinds = (query: string): string[] =>
      detect(query, context).map((target) =>
        target.kind === "lock" ? `lock:${target.escrow}` : target.kind,
      )
    expect(kinds("47")).toEqual(["epoch", "lock:vebtc", "lock:vemezo", "block"])
    expect(kinds("6033")).toEqual(["lock:vebtc", "lock:vemezo", "block"])
    expect(kinds("13,078,795")).toEqual(["block"])
  })

  it("rules out blocks past the head and nonsense", () => {
    expect(detect("99999999", context)).toEqual([])
    expect(detect("0x1234", context)).toEqual([])
    expect(detect("kiln", context)).toEqual([])
    expect(detect("   ", context)).toEqual([])
    expect(detect(`${hash}0`, context)).toEqual([])
  })

  it("routes each kind to its page", () => {
    expect(targetPath({ kind: "tx", hash: "0xab" })).toBe("/tx/0xab")
    expect(targetPath({ kind: "block-hash", hash: "0xab" })).toBe("/block/0xab")
    expect(targetPath({ kind: "address", address: "0xcd" })).toBe(
      "/address/0xcd",
    )
    expect(targetPath({ kind: "block", height: 5 })).toBe("/block/5")
    expect(targetPath({ kind: "epoch", number: 47 })).toBe("/epochs/47")
    expect(targetPath({ kind: "lock", escrow: "vemezo", id: 604 })).toBe(
      "/locks/vemezo/604",
    )
  })

  it("labels rows in the house formats", () => {
    expect(
      targetLabel({ kind: "address", address: address.toLowerCase() }).title,
    ).toBe("0x7c21…9e0b")
    expect(targetLabel({ kind: "block", height: 13_078_795 }).title).toBe(
      "Block 13,078,795",
    )
    expect(targetLabel({ kind: "lock", escrow: "vebtc", id: 604 })).toEqual({
      title: "veBTC #604",
      detail: "veBTC lock",
    })
  })
})

/**
 * The best of several timings of `batch` calls, after a warm-up, in ms. A
 * single call takes microseconds, so each timing covers many.
 */
function fastest(work: () => void, batch = 500, runs = 5): number {
  const many = () => {
    for (let call = 0; call < batch; call += 1) work()
  }
  many()
  let best = Number.POSITIVE_INFINITY
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    many()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

// Timing is compared within one run, never against a fixed number of
// milliseconds: a loaded machine slows both sides alike.
describe("search stays fast on hostile input", () => {
  const oversized = [
    `e${" ".repeat(2000)}x`,
    `epoch${" ".repeat(5000)}#${" ".repeat(5000)}1x`,
    `#${",".repeat(100_000)}x`,
    `${"1 ".repeat(50_000)}x`,
    `0x${"a".repeat(100_000)}`,
  ]

  it.each(oversized.map((query) => [query.slice(0, 12), query]))(
    "%s… costs no more than a query at the cap",
    (_label, query) => {
      expect(detect(query, context)).toEqual([])
      // Past the cap nothing is parsed, so a huge query costs no more than
      // its first 120 characters; parsing all of it would cost hundreds
      // of times more.
      const atCap = query.slice(0, maxQueryLength)
      expect(fastest(() => detect(query, context))).toBeLessThan(
        fastest(() => detect(atCap, context)) * 3,
      )
    },
  )

  // Under the cap the parser runs on every character.
  const patterns: [string, (length: number) => string][] = [
    ["spaces after e", (length) => `e${" ".repeat(length - 2)}x`],
    [
      "spaces around #",
      (length) => {
        const half = " ".repeat(Math.floor((length - 7) / 2))
        return `epoch${half}#${half}x`
      },
    ],
  ]

  it.each(patterns)("%s grows linearly up to the cap", (_label, build) => {
    const short = build(15)
    const long = build(maxQueryLength)
    expect(detect(long, context)).toEqual([])
    // Eight times the length: at most 8 times the time if linear (about 3
    // here, each call having a fixed cost), about 23 measured with a
    // quadratic pass added, far more if a pattern backtracks.
    const ratio =
      fastest(() => detect(long, context)) /
      fastest(() => detect(short, context))
    expect(ratio).toBeLessThan(10)
  })

  it("reads nothing past the field's length", () => {
    expect(maxQueryLength).toBe(120)
    expect(detect(`${" ".repeat(maxQueryLength)}47`, context)).toEqual([])
    expect(detect(`epoch ${"0".repeat(10)}47`, context)).toEqual([
      { kind: "epoch", number: 47 },
    ])
  })
})
