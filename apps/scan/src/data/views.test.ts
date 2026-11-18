import {
  addressSchema,
  blockSchema,
  logsPageSchema,
  mainPageBlocksSchema,
  tokenBalancesPageSchema,
  tokenTransfersPageSchema,
  transactionSchema,
  transactionsPageSchema,
} from "@matchbox/contracts/blockscout"
import { describe, expect, it } from "vitest"
import address from "./blockscout/fixtures/address.json"
import addressTokenTransfers from "./blockscout/fixtures/address-token-transfers.json"
import addressTokens from "./blockscout/fixtures/address-tokens.json"
import block from "./blockscout/fixtures/block.json"
import mainPageBlocks from "./blockscout/fixtures/main-page-blocks.json"
import transaction from "./blockscout/fixtures/transaction.json"
import transactionLogs from "./blockscout/fixtures/transaction-logs.json"
import transactions from "./blockscout/fixtures/transactions.json"
import {
  addressSummary,
  addressTransfer,
  blockDetail,
  blockRow,
  cursorOf,
  gasShare,
  logView,
  tokenBalance,
  txDetail,
  txRow,
} from "./views"

describe("Blockscout to view models", () => {
  it("reads blocks with exact gas shares", () => {
    const rows = mainPageBlocksSchema.parse(mainPageBlocks).map(blockRow)
    expect(rows[0]?.height).toBe(13_118_577)
    expect(rows[0]?.hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(gasShare("1195410", "10000000")).toEqual({
      percent: "12.0%",
      share: 0.12,
    })
    expect(gasShare("0", "0").percent).toBe("0.0%")
    const detail = blockDetail(blockSchema.parse(block))
    expect(detail.height).toBe(13_118_064)
    expect(detail.parentHash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("reads a transaction, its decoded input and its transfers", () => {
    const detail = txDetail(transactionSchema.parse(transaction))
    expect(detail.status).toBe("success")
    expect(detail.decoded?.name).toBe("execute(bytes commands, bytes[] inputs)")
    expect(detail.fee).toBe("0.00000028")
    expect(detail.value).toBeNull()
    expect(detail.transfers).toHaveLength(2)
    expect(detail.from.address).toBe(detail.from.address.toLowerCase())
    const rows = transactionsPageSchema.parse(transactions).items.map(txRow)
    expect(rows[0]?.hash).toBe(rows[0]?.hash.toLowerCase())
  })

  it("keeps log topics and decodings", () => {
    const logs = logsPageSchema.parse(transactionLogs).items.map(logView)
    expect(logs.length).toBe(2)
    expect(logs[0]?.topics.every((topic) => topic.startsWith("0x"))).toBe(true)
  })

  it("reads an address, its tokens and its transfers", () => {
    const summary = addressSummary(addressSchema.parse(address))
    expect(summary.address).toBe(address.hash.toLowerCase())
    const tokens = tokenBalancesPageSchema
      .parse(addressTokens)
      .items.map(tokenBalance)
    expect(tokens.map((token) => [token.symbol, token.amount])).toEqual([
      ["MUSD", "73.72"],
      ["BTC", "0.000131"],
      ["mUSDC", "169.31"],
      ["MEZO-CL-POS", "4"],
    ])
    const transfers = tokenTransfersPageSchema
      .parse(addressTokenTransfers)
      .items.map((transfer) => addressTransfer(summary.address, transfer))
    expect(
      transfers.every((transfer) => transfer.direction !== undefined),
    ).toBe(true)
  })

  it("turns keyset cursors into query values, null at the end", () => {
    expect(cursorOf({ block_number: 13116321, index: 0 })).toEqual({
      block_number: "13116321",
      index: "0",
    })
    expect(cursorOf(null)).toBeNull()
  })
})
