import { createServerFn } from "@tanstack/react-start"
import type { PeriodInput } from "../explorer/voting/range"
import {
  type Escrow,
  type LockOrder,
  lockPage,
  locksPage,
} from "./locks.server"

/**
 * The Locks pages' server functions. Their work is in locks.server; this
 * module stays light so the browser keeps only the RPC stubs.
 */

export type {
  Escrow,
  LockOrder,
  LockPage,
  LocksPage,
  VoteHistory,
  VoteSplit,
} from "./locks.server"

function identity<T>(input: T): T {
  return input
}

export const getLocksPage = createServerFn({ method: "GET" })
  .validator(
    identity<
      {
        escrow: Escrow
        order: LockOrder
        cursor: string | null
      } & PeriodInput
    >,
  )
  .handler(({ data }) => locksPage(data))

export const getLockPage = createServerFn({ method: "GET" })
  .validator(identity<{ escrow: Escrow; id: string }>)
  .handler(({ data }) => lockPage(data))
