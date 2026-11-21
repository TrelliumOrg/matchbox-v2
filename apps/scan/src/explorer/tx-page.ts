import { createServerFn } from "@tanstack/react-start"
import { getTransactionPage } from "../data/entities"
import { presentTx } from "./tx-present.server"

function identity<T>(input: T): T {
  return input
}

/**
 * The transaction page's read: the composed document (data/entities), as
 * the page shows it (tx-present). The presenting happens on the server,
 * so the browser loads no pool table for it.
 */
export const getTxPage = createServerFn({ method: "GET" })
  .validator(identity<{ hash: string }>)
  .handler(async ({ data }) => presentTx(await getTransactionPage({ data })))
