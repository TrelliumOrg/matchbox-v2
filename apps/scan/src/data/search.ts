import { createServerFn } from "@tanstack/react-start"
import { searchAll } from "./search.server"

/** One row of the palette's remote groups. */
export type SearchHit = {
  group: "gauges" | "addresses" | "transactions" | "jump"
  icon:
    | "gauge"
    | "address"
    | "contract"
    | "token"
    | "transaction"
    | "block"
    | "epoch"
    | "lock"
    | "pool"
  title: string
  /** A label's tag ("Validator", "Pool") or a token symbol. */
  tag: string | null
  detail: string
  path: string
  /** Names and tags from labels or the chain: render as untrusted text. */
  untrusted: boolean
}

export type SearchResult = {
  status: "ok" | "failed" | "limited"
  source: "scan" | "blockscout"
  hits: SearchHit[]
}

function identity<T>(input: T): T {
  return input
}

export const searchRemote = createServerFn({ method: "GET" })
  .validator(
    identity<{ q: string; kind: "name" | "address" | "address-prefix" }>,
  )
  .handler(({ data }) => searchAll(data))
