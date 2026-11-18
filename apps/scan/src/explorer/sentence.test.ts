import { describe, expect, it } from "vitest"
import type { ActivityView } from "../data/scan/activity-view"
import { groupRepeats } from "./sentence"

/** As the live Network page received them: pokes with no lock or actor. */
function poke(tx: string, log: number): ActivityView {
  return {
    id: `${tx}-${log}-BOOST_POKE`,
    txHash: tx,
    timestamp: 1_794_351_617,
    block: 13_141_848,
    action: "BOOST_POKE",
    parts: [{ kind: "text", text: "Refreshed votes" }],
    text: "Refreshed votes",
    actor: null,
  }
}

describe("rows of one transaction", () => {
  it("that read the same show as one row with how many", () => {
    const a = `0x${"b250".padEnd(64, "0")}`
    const b = `0x${"34b3".padEnd(64, "0")}`
    const groups = groupRepeats([
      poke(b, 0),
      poke(a, 4),
      poke(a, 3),
      poke(a, 2),
      poke(a, 1),
      poke(a, 0),
    ])
    expect(groups.map((group) => [group.row.txHash, group.count])).toEqual([
      [b, 1],
      [a, 5],
    ])
  })

  it("stay apart when any word differs, or another transaction comes between", () => {
    const a = `0x${"aa".padEnd(64, "0")}`
    const b = `0x${"bb".padEnd(64, "0")}`
    const other = { ...poke(a, 1), text: "Refreshed votes on veBTC #604" }
    expect(groupRepeats([poke(a, 2), other, poke(a, 0)])).toHaveLength(3)
    expect(groupRepeats([poke(a, 2), poke(b, 1), poke(a, 0)])).toHaveLength(3)
  })
})
