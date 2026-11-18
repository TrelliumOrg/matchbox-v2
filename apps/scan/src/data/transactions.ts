import { createServerFn } from "@tanstack/react-start"
import { withMezoIds } from "./scan/mezo-names.server"
import type { TxTab } from "./transaction-tabs"
import { transactionsPage } from "./transactions.server"

/**
 * The Transactions page's read (work in transactions.server), its bare
 * wallets named by their cached Mezo IDs (scan/mezo-names).
 */

export type {
  ActivityTab,
  AllTransactions,
  TransactionsPage,
  TxWords,
} from "./transactions.server"

function identity<T>(input: T): T {
  return input
}

export const getTransactionsPage = createServerFn({ method: "GET" })
  .validator(identity<{ tab: TxTab; cursor: Record<string, unknown> }>)
  .handler(async ({ data }) => withMezoIds(await transactionsPage(data)))
