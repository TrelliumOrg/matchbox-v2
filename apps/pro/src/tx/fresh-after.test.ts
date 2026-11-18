import { beforeEach, describe, expect, it } from "vitest"
import {
  forgetWrites,
  freshAfterMs,
  gaugesAfter,
  noteWrite,
  walletAfter,
} from "./fresh-after"

const wallet = `0x${"AB".repeat(20)}`
const other = `0x${"cd".repeat(20)}`
const start = 1_000_000

beforeEach(() => forgetWrites())

describe("the block a read should include after a transaction", () => {
  it("is nothing until this tab sends one", () => {
    expect(walletAfter(wallet, start)).toBeUndefined()
    expect(gaugesAfter(start)).toBeUndefined()
  })

  it("is the block of the wallet's transaction, whatever the address case", () => {
    noteWrite({ address: wallet, block: 13_203_206n, gauges: false }, start)
    expect(walletAfter(wallet.toLowerCase(), start + 1)).toBe(13_203_206)
    expect(walletAfter(wallet, start + 1)).toBe(13_203_206)
    // Nobody else's reads, and not the gauges: a new lock changes neither.
    expect(walletAfter(other, start + 1)).toBeUndefined()
    expect(gaugesAfter(start + 1)).toBeUndefined()
  })

  it("covers the gauges after a vote", () => {
    noteWrite({ address: wallet, block: 13_203_300, gauges: true }, start)
    expect(gaugesAfter(start + 1)).toBe(13_203_300)
  })

  it("keeps the latest block of several transactions", () => {
    noteWrite({ address: wallet, block: 13_203_300, gauges: true }, start)
    noteWrite({ address: wallet, block: 13_203_206, gauges: true }, start + 5)
    expect(walletAfter(wallet, start + 10)).toBe(13_203_300)
    expect(gaugesAfter(start + 10)).toBe(13_203_300)
  })

  it("is forgotten after a few minutes", () => {
    noteWrite({ address: wallet, block: 13_203_300, gauges: true }, start)
    expect(walletAfter(wallet, start + freshAfterMs - 1)).toBe(13_203_300)
    expect(walletAfter(wallet, start + freshAfterMs)).toBeUndefined()
    expect(gaugesAfter(start + freshAfterMs)).toBeUndefined()
  })

  it("ignores a block that is not one", () => {
    noteWrite({ address: wallet, block: 0, gauges: true }, start)
    noteWrite({ address: wallet, block: Number.NaN, gauges: true }, start)
    expect(walletAfter(wallet, start + 1)).toBeUndefined()
    expect(gaugesAfter(start + 1)).toBeUndefined()
  })
})
