import { createServerFn } from "@tanstack/react-start"
import { type MezoIdMatch, mezoIdMatch } from "./mezo-id.server"

/** The palette's and `/address/{id}`'s Mezo ID lookup (mezo-id.server). */

export type { MezoIdMatch }

function identity<T>(input: T): T {
  return input
}

export const findMezoId = createServerFn({ method: "GET" })
  .validator(identity<{ q: string }>)
  .handler(({ data }) => mezoIdMatch(typeof data.q === "string" ? data.q : ""))
