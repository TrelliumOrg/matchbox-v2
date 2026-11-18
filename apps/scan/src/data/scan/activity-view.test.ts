import type { ScanActivityItem } from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import { lockHistory } from "../locks.server"
import { activityViews } from "./activity-view"
import { tokenLookup } from "./tokens"

const vebtc = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const context = { tokens: tokenLookup(), labels: {} }
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
const gauge = (n: number) => `0x${n.toString(16).padStart(40, "0")}`

let seq = 0
function row(fields: Partial<ScanActivityItem>): ScanActivityItem {
  seq += 1
  return {
    id: `row-${seq}`,
    tx_hash: hash(1),
    log_index: 100 - seq,
    block_number: 13_164_325,
    timestamp: 1_794_400_000,
    epoch_start: 1_793_836_800,
    action_type: "BOOST_VOTE",
    source: "POOLS_VOTER",
    contract_address: gauge(9),
    tx_from: null,
    actor: null,
    recipient: null,
    lock_escrow: vebtc,
    token_id: "1226",
    amount: null,
    token: null,
    gauge: gauge(1),
    pool: null,
    reward_contract: null,
    weight: "1000000000000000000",
    extra: {},
    ...fields,
  }
}

/** One vote transaction: a reset, then a vote per gauge. */
function voteTx(tx: number, gauges: number, token = "1226") {
  return [
    row({
      tx_hash: hash(tx),
      action_type: "BOOST_ABSTAIN",
      token_id: token,
      gauge: null,
      weight: null,
    }),
    ...Array.from({ length: gauges }, (_, index) =>
      row({ tx_hash: hash(tx), token_id: token, gauge: gauge(index + 1) }),
    ),
  ]
}

describe("activityViews", () => {
  it("reads one transaction's votes with one lock as one row", () => {
    const views = activityViews(voteTx(1, 18), context)
    expect(views.map((view) => view.text)).toEqual([
      "Reset votes on veBTC #1226",
      "Voted 18.0000 veBTC for 18 gauges with veBTC #1226",
    ])
    expect(views[1]?.txHash).toBe(hash(1))
  })

  it("keeps a vote for one gauge as its own sentence", () => {
    const views = activityViews(voteTx(1, 1), context)
    expect(views[1]?.text).toBe(
      "Voted 1.0000 veBTC for 0x0000…0001 with veBTC #1226",
    )
  })

  it("keeps other transactions and other locks apart", () => {
    const views = activityViews(
      [
        ...voteTx(1, 2).slice(1),
        ...voteTx(1, 2, "848").slice(1),
        ...voteTx(2, 3).slice(1),
      ],
      context,
    )
    expect(views.map((view) => view.text)).toEqual([
      "Voted 2.0000 veBTC for 2 gauges with veBTC #1226",
      "Voted 2.0000 veBTC for 2 gauges with veBTC #848",
      "Voted 3.0000 veBTC for 3 gauges with veBTC #1226",
    ])
  })
})

describe("lockHistory", () => {
  it("shows whole votes only, and at most 25 entries", () => {
    const rows = Array.from({ length: 30 }, (_, tx) => voteTx(tx + 1, 2)).flat()
    // The read stops inside a vote: its last entry is left out.
    const cut = lockHistory(
      { data: rows.slice(0, 50), nextCursor: "next" },
      context,
    )
    expect(cut.more).toBe(true)
    // No vote is shown with part of its gauges.
    const votes = cut.rows.filter((view) => view.text.startsWith("Voted"))
    expect(votes.length).toBeGreaterThan(0)
    for (const view of votes) expect(view.text).toContain("for 2 gauges")
    expect(cut.rows).toHaveLength(25)
    // A short read cut inside its third vote: that vote is left out.
    const short = lockHistory(
      { data: rows.slice(0, 8), nextCursor: "next" },
      context,
    )
    expect(short.rows.map((view) => view.text.split(" ")[0])).toEqual([
      "Reset",
      "Voted",
      "Reset",
      "Voted",
      "Reset",
    ])
    const whole = lockHistory(
      { data: rows.slice(0, 6), nextCursor: null },
      context,
    )
    expect(whole.more).toBe(false)
    expect(whole.rows).toHaveLength(4)
  })
})
