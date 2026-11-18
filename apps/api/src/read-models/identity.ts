import type { WalletIdentity } from "@matchbox/contracts/read-models"
import type { Logger } from "@matchbox/logger"
import { getAddress, isAddress } from "viem"
import { z } from "zod"

// A wallet's Mezo ID from Mezo's accounts API (`/accounts/{address}`, which
// wants a checksummed address). Never throws: a down or odd API answers
// `unavailable`, so account pages still render. The route caches found IDs
// for a day at the edge; this isolate cache saves repeat lookups too.

export const mezoAccountsApi = "https://api.mezo.org"

export type IdentityReader = (address: string) => Promise<WalletIdentity>

const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/
const zeroAddress = `0x${"0".repeat(40)}`

/**
 * The account's own wallet: its one linked account of type `wallet`
 * (Mezo's shape, probed 13 Nov 2026: `{ type: "wallet", evmAddress,
 * btcAddress? }`), lower case. Null when there is none, more than one, or
 * it has no usable EVM address (the zero address is no wallet). An ID
 * names an address only through this wallet, never another linked
 * account.
 */
export function ownWalletOf(
  linked:
    | readonly {
        type?: string | null | undefined
        evmAddress?: string | null | undefined
      }[]
    | null
    | undefined,
): string | null {
  const own = (linked ?? []).filter((account) => account.type === "wallet")
  const [only] = own
  if (own.length !== 1 || only === undefined) return null
  const address = only.evmAddress
  if (typeof address !== "string" || !evmAddressPattern.test(address)) {
    return null
  }
  const lower = address.toLowerCase()
  return lower === zeroAddress ? null : lower
}

const noMezoIdSchema = z.object({ error: z.literal("Account has no Mezo ID") })

/**
 * Mezo's answer for an account with no ID: HTTP 500 with
 * `{"error":"Account has no Mezo ID"}`. That is "no ID", kept like any
 * other miss; every other 5xx is an outage. Reads the body.
 */
export async function isNoMezoIdAnswer(response: Response): Promise<boolean> {
  if (response.status !== 500) return false
  try {
    return noMezoIdSchema.safeParse(await response.json()).success
  } catch {
    return false
  }
}

const upstreamSchema = z.object({
  mezoId: z.string().nullish(),
  linkedAccounts: z
    .array(
      z.object({
        type: z.string(),
        evmAddress: z.string().nullish(),
        btcAddress: z.string().nullish(),
      }),
    )
    .nullish(),
})

/**
 * One account answer into the read model. The account's Mezo ID names
 * `address` only when `address` is the account's own wallet (ownWalletOf);
 * a linked account, or an answer for another wallet, has no ID here.
 */
export function toWalletIdentity(
  address: string,
  raw: unknown,
): WalletIdentity {
  const account = upstreamSchema.parse(raw)
  const owned = ownWalletOf(account.linkedAccounts) === address.toLowerCase()
  return {
    address,
    status: "found",
    mezoId:
      !owned ||
      account.mezoId === null ||
      account.mezoId === undefined ||
      account.mezoId === ""
        ? null
        : account.mezoId,
    linkedAccounts: (account.linkedAccounts ?? []).map((linked) => ({
      type: linked.type.length > 0 ? linked.type : "unknown",
      evmAddress:
        linked.evmAddress !== null &&
        linked.evmAddress !== undefined &&
        isAddress(linked.evmAddress, { strict: false })
          ? linked.evmAddress.toLowerCase()
          : null,
      btcAddress:
        linked.btcAddress === null ||
        linked.btcAddress === undefined ||
        linked.btcAddress === ""
          ? null
          : linked.btcAddress,
    })),
  }
}

const isolateTtlMs = 10 * 60 * 1000
const isolateEntries = 1000

export function createIdentityReader(deps: {
  fetcher: (url: string, init: RequestInit) => Promise<Response>
  logger: Logger
  baseUrl?: string
  now?: () => number
}): IdentityReader {
  const cache = new Map<string, { at: number; identity: WalletIdentity }>()
  const now = deps.now ?? Date.now
  return async function readIdentity(address) {
    const hit = cache.get(address)
    if (hit !== undefined && now() - hit.at < isolateTtlMs) return hit.identity
    let identity: WalletIdentity
    try {
      const response = await deps.fetcher(
        `${deps.baseUrl ?? mezoAccountsApi}/accounts/${getAddress(address)}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        },
      )
      if (response.status === 404 || (await isNoMezoIdAnswer(response))) {
        identity = {
          address,
          status: "not-found",
          mezoId: null,
          linkedAccounts: [],
        }
      } else if (!response.ok) {
        throw new Error(`Mezo accounts API answered ${response.status}`)
      } else {
        identity = toWalletIdentity(address, await response.json())
      }
    } catch (error) {
      deps.logger.warn({ message: "Mezo ID lookup failed", address, error })
      // Not cached: the next request tries again.
      return {
        address,
        status: "unavailable",
        mezoId: null,
        linkedAccounts: [],
      }
    }
    cache.set(address, { at: now(), identity })
    if (cache.size > isolateEntries) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return identity
  }
}
