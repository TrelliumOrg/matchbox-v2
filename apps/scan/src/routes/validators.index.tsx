import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getValidatorsPage, type ValidatorSort } from "../data/validators"
import { ValidatorsView } from "../explorer/validators/validators-page"

type Search = { epoch?: number; sort?: Exclude<ValidatorSort, "share"> }

function epochOf(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value
  return typeof number === "number" &&
    Number.isInteger(number) &&
    number >= 0 &&
    number < 100_000
    ? number
    : undefined
}

/**
 * Validators (`9qiDCpYgJ3`). The epoch and the order are search params:
 * the current epoch and vote share stay out of the URL. An epoch past the
 * current one shows the current one.
 */
export const Route = createFileRoute("/validators/")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const epoch = epochOf(search.epoch)
    return {
      ...(epoch === undefined ? {} : { epoch }),
      ...(search.sort === "proposed" || search.sort === "uptime"
        ? { sort: search.sort }
        : {}),
    }
  },
  loaderDeps: ({ search }): { epoch: number | null; sort: ValidatorSort } => ({
    epoch: search.epoch ?? null,
    sort: search.sort ?? "share",
  }),
  loader: ({ deps }) => getValidatorsPage({ data: deps }),
  head: () => ({ meta: [{ title: "Validators, Matchscan" }] }),
  component: function ValidatorsRoute(): ReactNode {
    return <ValidatorsView page={Route.useLoaderData()} />
  },
})
