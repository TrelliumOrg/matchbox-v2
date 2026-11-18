import { createServerFn } from "@tanstack/react-start"
import type { PeriodInput } from "../explorer/voting/range"
import type { TokenSlug } from "./scan/token-list"
import {
  musdLater,
  type TokenSort,
  tokenPage,
  tokensPage,
} from "./token-pages.server"

/**
 * The Tokens pages' server functions. Their work is in token-pages.server;
 * this module stays light so the browser keeps only the RPC stubs.
 */

export type {
  Missing,
  MusdLater,
  SplitPanel,
  TokenPage,
  TokenPanel,
  TokenRow,
  TokenSort,
  TokensPage,
} from "./token-pages.server"

function identity<T>(input: T): T {
  return input
}

export const getTokensPage = createServerFn({ method: "GET" })
  .validator(identity<{ sort: TokenSort }>)
  .handler(({ data }) => tokensPage(data))

export const getTokenPage = createServerFn({ method: "GET" })
  .validator(identity<{ slug: TokenSlug } & PeriodInput>)
  .handler(({ data }) => tokenPage(data))

export const getMusdLater = createServerFn({ method: "GET" })
  .validator(identity<PeriodInput>)
  .handler(({ data }) => musdLater(data))
