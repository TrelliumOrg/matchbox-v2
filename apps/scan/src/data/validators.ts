import { createServerFn } from "@tanstack/react-start"
import {
  type ValidatorSort,
  validatorPage,
  validatorsPage,
} from "./validators.server"

/**
 * The Validators pages' server functions. Their work is in
 * validators.server; this module stays light so the browser keeps only the
 * RPC stubs.
 */

export type {
  BlocksDay,
  EpochNav,
  EpochVotes,
  OutsideRow,
  ProposedFigures,
  ShareBarView,
  ValidatorBlocks,
  ValidatorHeader,
  ValidatorPage,
  ValidatorRow,
  ValidatorShare,
  ValidatorSort,
  ValidatorStatus,
  ValidatorsPage,
  ValidatorTable,
  VotesHistory,
} from "./validators.server"

function identity<T>(input: T): T {
  return input
}

export const getValidatorsPage = createServerFn({ method: "GET" })
  .validator(identity<{ epoch: number | null; sort: ValidatorSort }>)
  .handler(({ data }) => validatorsPage(data))

export const getValidatorPage = createServerFn({ method: "GET" })
  .validator(identity<{ address: string }>)
  .handler(({ data }) => validatorPage(data))
