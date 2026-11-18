import { describe, expect, it } from "vitest"
import { addBlock, fromHead, type LatestBlock } from "./latest-blocks"

const row = (height: number): LatestBlock => ({
  height,
  timestamp: height,
  transactions: 1,
  miner: null,
})

describe("latest blocks from head messages", () => {
  it("adds a newer block at the top and keeps five", () => {
    const rows = [row(10), row(9), row(8), row(7), row(6)]
    expect(addBlock(rows, row(11)).map((each) => each.height)).toEqual([
      11, 10, 9, 8, 7,
    ])
  })

  it("ignores a block it already shows or an older one", () => {
    const rows = [row(10), row(9)]
    expect(addBlock(rows, row(10))).toEqual(rows)
    expect(addBlock(rows, row(3))).toEqual(rows)
  })

  it("reads the head message's details", () => {
    expect(
      fromHead({
        number: 12,
        timestamp: 99,
        hash: null,
        transactionCount: 4,
        gasUsed: "1",
        miner: `0x${"ab".repeat(20)}`,
      }),
    ).toEqual({
      height: 12,
      timestamp: 99,
      transactions: 4,
      miner: { address: `0x${"ab".repeat(20)}`, name: null, contract: false },
    })
  })

  it("names the proposer from the validators' names", () => {
    const miner = `0x${"AB".repeat(20)}`
    expect(
      fromHead(
        {
          number: 12,
          timestamp: 99,
          hash: null,
          transactionCount: 4,
          gasUsed: "1",
          miner,
        },
        { [miner.toLowerCase()]: "aras.haus" },
      ).miner,
    ).toEqual({
      address: miner.toLowerCase(),
      name: null,
      contract: false,
      label: { name: "aras.haus", kind: "validator", tags: [] },
    })
  })
})
