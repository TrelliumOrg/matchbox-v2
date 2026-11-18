import address from "./fixtures/address.json"
import addressCounters from "./fixtures/address-counters.json"
import addressTokenTransfers from "./fixtures/address-token-transfers.json"
import addressTokens from "./fixtures/address-tokens.json"
import addressTransactions from "./fixtures/address-transactions.json"
import block from "./fixtures/block.json"
import blockTransactions from "./fixtures/block-transactions.json"
import blocks from "./fixtures/blocks.json"
import mainPageBlocks from "./fixtures/main-page-blocks.json"
import searchQuick from "./fixtures/search-quick.json"
import smartContract from "./fixtures/smart-contract.json"
import token from "./fixtures/token.json"
import tokenHolders from "./fixtures/token-holders.json"
import tokenTransfers from "./fixtures/token-transfers.json"
import transaction from "./fixtures/transaction.json"
import transactionLogs from "./fixtures/transaction-logs.json"
import transactionTokenTransfers from "./fixtures/transaction-token-transfers.json"
import transactions from "./fixtures/transactions.json"

/**
 * Fixtures mode: the Blockscout proxy's answers recorded from the live
 * upstream on 9 Nov 2026 (copied from apps/api/src/blockscout/fixtures).
 * One transaction, its block and one address, plus the lists and search,
 * so every Scan page renders with no backend, and MUSD's token, holders
 * and transfers (the token pages' tabs; the contract read is BoostVoter's,
 * served for MUSD too). One more address stands for
 * a rate-limited proxy, so the smoke test sees a section degrade. Anything
 * else is a 404.
 */

export const fixtureIds = {
  transaction: transaction.hash.toLowerCase(),
  block: block.height,
  blockHash: block.hash.toLowerCase(),
  address: address.hash.toLowerCase(),
  /** The recorded token (MUSD). */
  token: token.address_hash.toLowerCase(),
  /** Every read for this address answers 429, as a busy proxy does. */
  busyAddress: `0x${"0b".repeat(20)}`,
} as const

/** The newest recorded block, the fixtures' chain head. */
export const fixtureHead = {
  block: mainPageBlocks[0]?.height ?? block.height,
  timestamp: Math.floor(
    Date.parse(mainPageBlocks[0]?.timestamp ?? block.timestamp) / 1000,
  ),
}

/** A page and no further pages: cursors in fixtures lead nowhere. */
function lastPage<T extends object>(page: T, query: URLSearchParams): T {
  return [...query.keys()].length > 0
    ? { ...page, next_page_params: null }
    : page
}

export function blockscoutFixture(
  path: string,
  query: URLSearchParams,
): { status: number; body: unknown } {
  const ok = (body: unknown) => ({ status: 200, body })
  const lower = path.toLowerCase()
  const { transaction: tx, block: height, blockHash, address: who } = fixtureIds
  if (lower.startsWith(`addresses/${fixtureIds.busyAddress}`)) {
    return { status: 429, body: { message: "Too many requests" } }
  }
  switch (lower) {
    case "main-page/blocks":
      return ok(mainPageBlocks)
    case "blocks":
      return ok(lastPage(blocks, query))
    case "transactions":
      return ok(lastPage(transactions, query))
    case "search/quick":
      return ok(searchQuick)
    case `blocks/${height}`:
    case `blocks/${blockHash}`:
      return ok(block)
    case `blocks/${height}/transactions`:
    case `blocks/${blockHash}/transactions`:
      return ok(blockTransactions)
    case `transactions/${tx}`:
      return ok(transaction)
    case `transactions/${tx}/logs`:
      return ok(transactionLogs)
    case `transactions/${tx}/token-transfers`:
      return ok(transactionTokenTransfers)
    case `addresses/${who}`:
      return ok(address)
    case `addresses/${who}/counters`:
      return ok(addressCounters)
    case `addresses/${who}/tokens`:
      return ok(addressTokens)
    case `addresses/${who}/transactions`:
      return ok(lastPage(addressTransactions, query))
    case `addresses/${who}/token-transfers`:
      return ok(lastPage(addressTokenTransfers, query))
    case `tokens/${fixtureIds.token}`:
      return ok(token)
    case `tokens/${fixtureIds.token}/holders`:
      return ok(tokenHolders)
    case `tokens/${fixtureIds.token}/transfers`:
      return ok(lastPage(tokenTransfers, query))
    case `smart-contracts/${fixtureIds.token}`:
      return ok(smartContract)
    default:
      return { status: 404, body: { message: "Not found" } }
  }
}
