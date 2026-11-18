import { createServerFn } from "@tanstack/react-start"
import { epochPage, epochsPage } from "./epochs.server"

/**
 * The Epochs pages' server functions. Their work is in epochs.server; this
 * module stays light so the browser keeps only the RPC stubs.
 */

export type {
  CurrentEpoch,
  DepositLine,
  EpochDoc,
  EpochPage,
  EpochRow,
  EpochsPage,
  SourceRow,
  SourceTable,
  VotesCast,
} from "./epochs.server"

function identity<T>(input: T): T {
  return input
}

export const getEpochsPage = createServerFn({ method: "GET" })
  .validator(identity<{ cursor: string | null }>)
  .handler(({ data }) => epochsPage(data))

export const getEpochPage = createServerFn({ method: "GET" })
  .validator(identity<{ epoch: number }>)
  .handler(({ data }) => epochPage(data))
