import { createServerFn } from "@tanstack/react-start"
import type { PeriodInput } from "../explorer/voting/range"
import { networkOverview } from "./network.server"

/**
 * The Network overview's server function. Its work is in network.server;
 * this module stays light so the browser keeps only the RPC stub.
 */

export type {
  DexView,
  NetworkOverview,
  NetworkValues,
  TvlView,
} from "./network.server"

function identity<T>(input: T): T {
  return input
}

export const getNetworkOverview = createServerFn({ method: "GET" })
  .validator(identity<PeriodInput>)
  .handler(({ data }) => networkOverview(data))
