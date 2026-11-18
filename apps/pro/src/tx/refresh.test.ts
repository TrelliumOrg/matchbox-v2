import { beforeEach, describe, expect, it } from "vitest"
import { createHeadStore } from "../live/heads"
import { forgetWrites, gaugesAfter, walletAfter } from "./fresh-after"
import {
  type RefreshTarget,
  refreshAfterBlock,
  refreshAfterBlocks,
} from "./refresh"

const wallet = `0x${"ab".repeat(20)}`
const block = 13_203_206

function setup(
  head: number,
  targets: readonly RefreshTarget[],
  mined: number = block,
) {
  const store = createHeadStore({ number: head, receivedAt: 0 })
  const runs: { targets: readonly RefreshTarget[]; address: string }[] = []
  const stop = refreshAfterBlock({
    store,
    block: BigInt(mined),
    targets,
    address: wallet,
    refresh: (asked, address) => {
      runs.push({ targets: asked, address })
    },
  })
  return { store, runs, stop }
}

beforeEach(() => forgetWrites())

describe("refetching after a transaction", () => {
  it("waits for the head to pass the receipt's block", () => {
    const { store, runs } = setup(block, ["overview", "voter"])
    expect(runs).toEqual([])
    store.set(block + 1)
    expect(runs).toEqual([{ targets: ["overview", "voter"], address: wallet }])
  })

  it("runs at once when the head is already past it", () => {
    const { runs } = setup(block + 1, ["overview"])
    expect(runs).toHaveLength(1)
  })

  it("asks again as later blocks land, then stops", () => {
    const { store, runs } = setup(block, ["gauges"])
    for (let head = block + 1; head <= block + 60; head += 1) store.set(head)
    expect(runs).toHaveLength(refreshAfterBlocks.length)
  })

  it("runs once when the head jumps several steps", () => {
    const { store, runs } = setup(block, ["gauges"])
    store.set(block + 12)
    expect(runs).toHaveLength(1)
    store.set(block + 40)
    expect(runs).toHaveLength(2)
    store.set(block + 80)
    expect(runs).toHaveLength(2)
  })

  it("stops when asked to", () => {
    const { store, runs, stop } = setup(block, ["overview"])
    stop()
    store.set(block + 30)
    expect(runs).toEqual([])
  })

  it("names the block to the wallet's reads, and to the gauges after a vote", () => {
    setup(block, ["overview", "voter", "rewards"])
    expect(walletAfter(wallet)).toBe(block)
    expect(gaugesAfter()).toBeUndefined()
    setup(block + 9, ["voter", "gauges", "gauge"], block + 9)
    expect(walletAfter(wallet)).toBe(block + 9)
    expect(gaugesAfter()).toBe(block + 9)
  })
})
