import { beforeEach, describe, expect, it } from "vitest"
import { describeEvent } from "../components/activity-row"
import type { ActivityEvent } from "../data/view-models"
import {
  getOwnTxs,
  noteSettled,
  noteSubmitted,
  type OwnTx,
  ownEvents,
  ownTxStorageKey,
  parseOwnTxs,
  pruned,
  resetOwnTxs,
  settled,
  submitted,
} from "./own-txs"

const wallet = `0x${"7c".repeat(20)}`
const other = `0x${"3f".repeat(20)}`
const hash = (digit: string) => `0x${digit.repeat(64)}`
const now = 1_794_500_000

function tx(fields: Partial<OwnTx> = {}): OwnTx {
  return {
    hash: hash("a"),
    wallet,
    label: "Vote with #2207",
    at: now,
    status: "confirming",
    ...fields,
  }
}

describe("the stored list", () => {
  it("is empty for anything that is not a list of transactions", () => {
    for (const raw of [null, "", "{", "{}", "[1]", '[{"hash":"0x12"}]']) {
      expect(parseOwnTxs(raw)).toEqual([])
    }
    expect(
      parseOwnTxs(JSON.stringify([tx(), { ...tx(), status: "x" }])),
    ).toEqual([tx()])
  })

  it("puts a new transaction first, once, lower case", () => {
    const first = submitted(
      [],
      {
        hash: hash("A"),
        wallet: wallet.toUpperCase().replace("0X", "0x"),
        label: "Vote with #2207",
      },
      now,
    )
    expect(first).toEqual([tx()])
    const again = submitted(
      first,
      { hash: hash("a"), wallet, label: "Retry" },
      now + 5,
    )
    expect(again).toHaveLength(1)
    expect(again[0]?.label).toBe("Retry")
    expect(
      submitted(first, { hash: "0x12", wallet, label: "Bad" }, now),
    ).toEqual(first)
  })

  it("records the outcome of the transaction with that hash only", () => {
    const list = [tx(), tx({ hash: hash("b") })]
    expect(
      settled(list, hash("B"), "reverted").map((entry) => entry.status),
    ).toEqual(["confirming", "reverted"])
  })

  it("forgets by age: a reverted one stays longest", () => {
    const list = [
      tx({ status: "confirmed", at: now - 16 * 60 }),
      tx({ hash: hash("b"), status: "confirming", at: now - 16 * 60 }),
      tx({ hash: hash("c"), status: "confirming", at: now - 61 * 60 }),
      tx({ hash: hash("d"), status: "reverted", at: now - 23 * 3600 }),
      tx({ hash: hash("e"), status: "reverted", at: now - 25 * 3600 }),
    ]
    expect(pruned(list, now).map((entry) => entry.hash)).toEqual([
      hash("b"),
      hash("d"),
    ])
  })
})

describe("own transactions as Activity rows", () => {
  const indexed: ActivityEvent[] = [
    {
      id: "indexed-1",
      status: "confirmed",
      at: now - 60,
      epoch: 48,
      block: 13_170_000,
      tx: hash("B"),
      detail: { kind: "own", label: "ignored" },
    },
  ]

  it("lists this wallet's, minus the ones the indexer already has", () => {
    const list = [
      tx(),
      tx({ hash: hash("b"), status: "confirmed" }),
      tx({ hash: hash("c"), wallet: other }),
      tx({
        hash: hash("d"),
        status: "reverted",
        label: "Incentive to Kiln Labs",
      }),
    ]
    const events = ownEvents(list, wallet, indexed, () => 48)
    expect(events.map((event) => [event.tx, event.status])).toEqual([
      [hash("a"), "confirming"],
      [hash("d"), "reverted"],
    ])
    expect(events[0]).toMatchObject({
      id: `own-${hash("a")}`,
      epoch: 48,
      block: null,
      detail: { kind: "own", label: "Vote with #2207" },
    })
  })

  it("reads as confirming, confirmed or reverted", () => {
    const [confirming, confirmed, reverted] = ownEvents(
      [
        tx(),
        tx({ hash: hash("b"), status: "confirmed" }),
        tx({ hash: hash("c"), status: "reverted" }),
      ],
      wallet,
      [],
      () => 48,
    ).map((event) => describeEvent(event, "dated"))
    expect(confirming).toMatchObject({
      title: "Vote with #2207",
      subline: "Confirming",
      pending: true,
      sub: null,
    })
    expect(confirmed?.subline).toMatch(/^Epoch 48, \d\d:\d\d$/)
    expect(confirmed?.pending).toBe(false)
    expect(reverted?.subline).toMatch(/^Reverted, \d\d:\d\d$/)
    expect(reverted?.sub).toBe("Not sent")
  })
})

describe("in this browser", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetOwnTxs()
  })

  it("keeps a submitted step and its outcome across loads", () => {
    expect(getOwnTxs()).toEqual([])
    noteSubmitted({ hash: hash("a"), wallet, label: "Vote with #2207" })
    expect(getOwnTxs()[0]).toMatchObject({ status: "confirming" })
    noteSettled(hash("a"), "reverted")
    resetOwnTxs()
    expect(getOwnTxs()[0]).toMatchObject({
      hash: hash("a"),
      status: "reverted",
      label: "Vote with #2207",
    })
    expect(window.localStorage.getItem(ownTxStorageKey)).toContain(hash("a"))
  })
})
