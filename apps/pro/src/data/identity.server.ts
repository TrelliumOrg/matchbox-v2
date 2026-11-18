import { addressInputSchema } from "@matchbox/contracts/common"
import { scanMezoIdLookupSchema } from "@matchbox/contracts/scan"
import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { z } from "zod"
import { readModel } from "./source.server"

/**
 * One identity lookup for every caller in Pro: the Worker's wallet URLs
 * (`/pyke.mezo/vote`), the Send sheet and the lock transfer sheet.
 *
 * - An address goes to `/internal/pro/wallets/{address}/identity`, which
 *   takes addresses only and answers the address's Mezo ID.
 * - A Mezo ID goes to `/internal/scan/mezo-ids/{id}`, the API's resolver
 *   (it validates the ID, checks Mezo's answer names that ID through its
 *   own wallet, and keeps a found ID a day). `fresh` skips every stored
 *   answer and is answered no-store: for an ID about to receive funds.
 *
 * Three answers, never a throw: found, not found, and unavailable (Mezo's
 * API down, ours failing or busy). Unavailable is never "no such ID":
 * callers must not keep it, and pages say to try again.
 */

/** A wallet's Mezo ID, or the wallet a Mezo ID names. */
export type Identity = { address: string; mezoId: string | null }

export type IdentityLookup =
  | { status: "found"; identity: Identity }
  | { status: "not-found" }
  | { status: "unavailable" }

const notFound: IdentityLookup = { status: "not-found" }
const unavailable: IdentityLookup = { status: "unavailable" }

/**
 * The fields Pro reads from `/internal/pro/wallets/{address}/identity`.
 * Local until the API's identity schema is committed to
 * `@matchbox/contracts`; zod drops the fields it does not name (linked
 * accounts).
 */
const identityResponse = z.object({
  data: z.object({
    address: addressInputSchema,
    status: z.enum(["found", "not-found", "unavailable"]),
    mezoId: z.string().min(1).nullable(),
  }),
})

const mezoIdResponse = z.object({ data: scanMezoIdLookupSchema })

async function readAddress(address: string): Promise<IdentityLookup> {
  const found = await readModel(
    `/internal/pro/wallets/${address}/identity`,
    identityResponse,
    true,
  )
  if (found === null) return notFound
  // Mezo's API down: the address is still an address, its ID unknown.
  if (found.data.status === "unavailable") return unavailable
  return {
    status: "found",
    identity: {
      address: found.data.address.toLowerCase(),
      mezoId: found.data.mezoId?.toLowerCase() ?? null,
    },
  }
}

async function readMezoId(id: string, fresh: boolean): Promise<IdentityLookup> {
  const found = await readModel(
    `/internal/scan/mezo-ids/${encodeURIComponent(id)}${fresh ? "?fresh=1" : ""}`,
    mezoIdResponse,
    true,
  )
  const lookup = found?.data
  if (lookup === undefined) return notFound
  if (lookup.status === "unavailable") return unavailable
  if (lookup.status === "not-found") return notFound
  const wallet = lookup.wallets[0]
  return wallet === undefined
    ? notFound
    : {
        status: "found",
        identity: { address: wallet.toLowerCase(), mezoId: id },
      }
}

export async function readIdentity(
  key: string,
  options: { fresh?: boolean } = {},
): Promise<IdentityLookup> {
  const address = addressInputSchema.safeParse(key)
  const id = address.success ? null : canonicalMezoId(key)
  if (!address.success && id === null) return notFound
  try {
    return address.success
      ? await readAddress(address.data)
      : await readMezoId(id ?? "", options.fresh === true)
  } catch {
    // A 429, a 5xx, an unreachable API or an answer that fails its schema.
    return unavailable
  }
}
