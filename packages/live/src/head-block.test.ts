import { describe, expect, it } from "vitest"
import { parseHeadBlock } from "./head-source"
import { createHeadStore } from "./heads"

const hash = `0x${"ab".repeat(32)}`
const miner = `0x${"cd".repeat(20)}`

describe("head block details", () => {
  it("reads BlockHub's extended head message", () => {
    expect(
      parseHeadBlock(
        JSON.stringify({
          type: "head",
          block: 13118577,
          timestamp: 1794200000,
          hash,
          transactionCount: 3,
          gasUsed: "412300",
          miner,
        }),
      ),
    ).toEqual({
      number: 13118577,
      timestamp: 1794200000,
      hash,
      transactionCount: 3,
      gasUsed: "412300",
      miner,
    })
  })

  it("nulls malformed extras and refuses non-heads", () => {
    expect(
      parseHeadBlock({
        type: "head",
        block: 5,
        timestamp: 1,
        hash: "nope",
        transactionCount: -1,
        gasUsed: 12,
        miner: miner.toUpperCase(),
      }),
    ).toEqual({
      number: 5,
      timestamp: 1,
      hash: null,
      transactionCount: null,
      gasUsed: null,
      miner: null,
    })
    expect(parseHeadBlock({ type: "stale", since: 1 })).toBeNull()
    expect(parseHeadBlock('{"number":5}')).toBeNull()
    expect(parseHeadBlock("not json")).toBeNull()
  })

  it("keeps details only with the head they describe", () => {
    const store = createHeadStore({ number: 10, receivedAt: 0 })
    const block = {
      number: 11,
      timestamp: 1,
      hash,
      transactionCount: 0,
      gasUsed: "0",
      miner,
    }
    store.set(11, 5, block)
    expect(store.get()).toEqual({ number: 11, receivedAt: 5, block })
    store.set(12, 6, block)
    expect(store.get()).toEqual({ number: 12, receivedAt: 6 })
  })
})
