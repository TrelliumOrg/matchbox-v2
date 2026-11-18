import { createServerFn } from "@tanstack/react-start"
import { addressDocument, blockPage, transactionPage } from "./entities.server"
import { mezoIdOfAddress } from "./mezo-id.server"
import { nameViews } from "./scan/names"
import { knownNames } from "./scan/names.server"

/**
 * The entity pages' server functions. Their work is in entities.server
 * (one composed document each); this module stays light so the browser
 * bundle keeps only the RPC stubs. Each page's addresses without a label
 * of ours are named from the isolate's validator and gauge names, read
 * beside the document.
 */

export type {
  AddressDocument,
  BlockPage,
  BorrowView,
  Headline,
  TxPage,
} from "./entities.server"

function identity<T>(input: T): T {
  return input
}

export const getTransactionPage = createServerFn({ method: "GET" })
  .validator(identity<{ hash: string }>)
  .handler(async ({ data }) => {
    const [page, names] = await Promise.all([
      transactionPage(data),
      knownNames(),
    ])
    return nameViews(page, names)
  })

export const getBlockPage = createServerFn({ method: "GET" })
  .validator(identity<{ id: string; cursor: Record<string, unknown> }>)
  .handler(async ({ data }) => {
    const [page, names] = await Promise.all([blockPage(data), knownNames()])
    return nameViews(page, names)
  })

export const getAddressDocument = createServerFn({ method: "GET" })
  .validator(identity<{ address: string }>)
  .handler(async ({ data }) => {
    // The address's Mezo ID and linked Bitcoin address beside its
    // document, in the same round.
    const [document, names, identity] = await Promise.all([
      addressDocument(data),
      knownNames(),
      mezoIdOfAddress(data.address),
    ])
    return {
      ...nameViews(document, names),
      mezoId: identity.mezoId,
      btcAddress: identity.btcAddress,
    }
  })
