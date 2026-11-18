import {
  tokenTransfersPageSchema,
  transactionsPageSchema,
} from "@matchbox/contracts/blockscout"
import { describe, expect, it } from "vitest"
import recordedTransfers from "../blockscout/fixtures/token-transfers.json"
import recordedTransactions from "../blockscout/fixtures/transactions.json"
import { transferView, txRow } from "../views"
import { type ActivityView, partsText } from "./activity-view"
import { wallet } from "./fixtures/world"
import { bareWallets, mezoIdLabelKind, nameWallets } from "./mezo-names"

/**
 * Mezo IDs in lists, on the recorded Blockscout pages: MUSD's transfers
 * (from a pool contract to the recorded wallet) and the latest
 * transactions (an EOA calling contracts).
 */

const transfers = tokenTransfersPageSchema
  .parse(recordedTransfers)
  .items.map(transferView)
const transactions = transactionsPageSchema
  .parse(recordedTransactions)
  .items.map(txRow)
const sender = "0xf35c1a20303ddca464ebf5b3b023588cf3181c8a"

function sentence(): ActivityView {
  const parts: ActivityView["parts"] = [
    { kind: "text", text: "Sent " },
    { kind: "figure", text: "12.5 MUSD" },
    { kind: "text", text: " to " },
    { kind: "address", address: wallet, name: null },
  ]
  return {
    id: "a1",
    txHash: `0x${"ab".repeat(32)}`,
    timestamp: 1_794_000_000,
    block: 13_000_000,
    action: "transfer",
    parts,
    text: partsText(parts),
    actor: sender,
  }
}

describe("bareWallets", () => {
  it("collects the wallets a page shows as short addresses, once each", () => {
    // The pool is a contract: never asked about.
    expect(bareWallets({ items: transfers }, 100)).toEqual([wallet])
    expect(bareWallets({ items: transactions }, 100)).toEqual([sender])
    expect(bareWallets([sentence()], 100)).toEqual([wallet])
  })

  it("skips addresses we or Blockscout already name, and keeps to the cap", () => {
    const [first] = transactions
    if (first === undefined) throw new Error("no recorded transaction")
    const labelled = {
      ...first,
      from: {
        ...first.from,
        label: { name: "Kiln", kind: "validator", tags: [] },
      },
    }
    const named = { ...first, from: { ...first.from, name: "Vault" } }
    expect(bareWallets([labelled, named], 100)).toEqual([])
    expect(bareWallets([{ items: transfers }, sentence()], 0)).toEqual([])
  })
})

describe("nameWallets", () => {
  it("labels a wallet with its Mezo ID and leaves the rest as they were", () => {
    const page = { items: transfers, next: null }
    const named = nameWallets(page, { [wallet]: "alice.mezo" })
    for (const [index, row] of named.items.entries()) {
      expect(row.to.label).toEqual({
        name: "alice.mezo",
        kind: mezoIdLabelKind,
        tags: [],
      })
      expect(row.from).toEqual(transfers[index]?.from)
    }
    // The input is not changed.
    expect(transfers[0]?.to.label).toBeUndefined()
  })

  it("names a sentence's address and rewrites its text", () => {
    const [named] = nameWallets([sentence()], { [wallet]: "alice.mezo" })
    expect(named?.parts[3]).toEqual({
      kind: "address",
      address: wallet,
      name: "alice.mezo",
    })
    expect(named?.text).toBe("Sent 12.5 MUSD to alice.mezo")
  })

  it("changes nothing without IDs, or for other addresses", () => {
    const page = { items: transactions }
    expect(nameWallets(page, {})).toBe(page)
    expect(nameWallets(page, { [wallet]: "alice.mezo" })).toEqual(page)
    // A `text` beside `parts` that are not a sentence is left alone.
    const other = { text: "Kept", parts: [1, 2] }
    expect(nameWallets(other, { [wallet]: "alice.mezo" })).toEqual(other)
  })
})
