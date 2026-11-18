import {
  type ScanMezoIdLookup,
  type ScanMezoIdNames,
  scanMezoIdLookupSchema,
  scanMezoIdNamesMax,
} from "@matchbox/contracts/scan"
import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import type { Logger } from "@matchbox/logger"
import { PlatformError } from "@matchbox/server"
import type { Hono } from "hono"
import { getAddress } from "viem"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import {
  isNoMezoIdAnswer,
  mezoAccountsApi,
  ownWalletOf,
} from "../read-models/identity"
import { queryOf, type ScanContext } from "./context"
import { scanCacheControl } from "./serve"

// /internal/scan/mezo-ids/{key}: a Mezo ID to its wallets (Matchscan's
// search and `/address/alice.mezo`), an address to its Mezo ID and linked
// Bitcoin address (the address page), and a mainnet Bitcoin address to the
// EVM address linked with it (search and `/address/bc1q…`). Each is one
// exact lookup on Mezo's accounts API (`/accounts/{key}`), which takes any
// of the three; what it accepts is in @matchbox/domain/mezo-id and
// @matchbox/domain/btc-address. The key is validated before any upstream
// URL is built from it.
//
// `?fresh=1` skips every stored answer, asks Mezo, and is answered
// no-store: Pro asks that way when a transfer to an ID reaches its review.
// What it learns about an ID replaces what was stored (freshID below), so
// later reads, Pro's and Matchscan's, see the ID's current wallet.
//
// /internal/scan/mezo-ids?addresses=a,b: the IDs already cached for a
// list's addresses (Matchscan's transaction and holder lists). Cache only:
// it reads the found answers the route above stored, and never asks Mezo.

/**
 * What to look up: a canonical Mezo ID, a lower-case address, or a
 * canonical mainnet Bitcoin address (bech32 lower case, base58 as typed).
 */
export type MezoIdKey =
  | { kind: "mezo-id"; id: string }
  | { kind: "address"; address: string }
  | { kind: "btc"; address: string }

export type MezoIdResolver = (key: MezoIdKey) => Promise<ScanMezoIdLookup>

const addressPattern = /^0x[0-9a-fA-F]{40}$/

/** A path segment as a key, or null when it is none of the shapes. */
export function mezoIdKey(raw: string): MezoIdKey | null {
  if (addressPattern.test(raw)) {
    return { kind: "address", address: raw.toLowerCase() }
  }
  const btc = canonicalBtcAddress(raw)
  if (btc !== null) return { kind: "btc", address: btc }
  const id = canonicalMezoId(raw)
  return id === null ? null : { kind: "mezo-id", id }
}

function keyText(key: MezoIdKey): string {
  return key.kind === "mezo-id" ? key.id : key.address
}

const upstreamSchema = z.object({
  mezoId: z.string().nullish(),
  linkedAccounts: z
    .array(
      z.object({
        type: z.string().nullish(),
        evmAddress: z.string().nullish(),
        btcAddress: z.string().nullish(),
      }),
    )
    .nullish(),
})

type LinkedAccount = NonNullable<
  z.infer<typeof upstreamSchema>["linkedAccounts"]
>[number]

/** A linked account's EVM address, lower case, or null (none, or zero). */
function evmOf(account: LinkedAccount): string | null {
  const address = account.evmAddress
  if (typeof address !== "string" || !addressPattern.test(address)) {
    return null
  }
  const lower = address.toLowerCase()
  return /^0x0{40}$/.test(lower) ? null : lower
}

/** A linked account's Bitcoin address as a key, or null when it is none. */
function btcOf(account: LinkedAccount): string | null {
  return canonicalBtcAddress(account.btcAddress ?? "")
}

/** The Bitcoin address linked with the account's own wallet, or null. */
function walletBtcOf(
  linked: readonly LinkedAccount[] | null | undefined,
  wallet: string,
): string | null {
  const own = (linked ?? []).find(
    (account) => account.type === "wallet" && evmOf(account) === wallet,
  )
  return own === undefined ? null : btcOf(own)
}

/**
 * The one EVM address linked with Bitcoin address `btc`: the linked
 * accounts whose Bitcoin address is exactly `btc` (after the same
 * normalisation as the key). Null when there is none, when one has no
 * usable EVM address, or when they name different EVM addresses.
 */
function evmOfBtc(
  linked: readonly LinkedAccount[] | null | undefined,
  btc: string,
): string | null {
  const evms = new Set<string | null>()
  for (const account of linked ?? []) {
    if (btcOf(account) === btc) evms.add(evmOf(account))
  }
  const [only] = evms
  return evms.size === 1 && only !== undefined ? only : null
}

/** Mezo's API answers within a few hundred ms; past this the search moves on. */
export const mezoIdDeadlineMs = 2500

export function createMezoIdResolver(deps: {
  fetcher: (url: string, init: RequestInit) => Promise<Response>
  logger: Logger
  baseUrl?: string
  timeoutMs?: number
}): MezoIdResolver {
  return async function resolveMezoId(key) {
    // Built only from a validated key: an ID of [a-z0-9-] plus ".mezo", an
    // address checksummed as the API wants it, or a Bitcoin address of
    // ASCII letters and digits.
    const segment =
      key.kind === "address"
        ? getAddress(key.address)
        : encodeURIComponent(key.kind === "mezo-id" ? key.id : key.address)
    let response: Response
    try {
      response = await deps.fetcher(
        `${deps.baseUrl ?? mezoAccountsApi}/accounts/${segment}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(deps.timeoutMs ?? mezoIdDeadlineMs),
        },
      )
    } catch (error) {
      deps.logger.warn({
        message: "Mezo ID lookup failed",
        key: keyText(key),
        error: error instanceof Error ? error.message : String(error),
      })
      return { status: "unavailable" }
    }
    // 404 is no such account; 422 is a key Mezo does not accept, which our
    // validation should already have refused; a 500 saying "Account has no
    // Mezo ID" is Mezo's way of saying the address has none.
    if (
      response.status === 404 ||
      response.status === 422 ||
      (await isNoMezoIdAnswer(response))
    ) {
      return { status: "not-found" }
    }
    if (!response.ok) {
      deps.logger.warn({
        message: "Mezo ID lookup failed",
        key: keyText(key),
        status: response.status,
      })
      return { status: "unavailable" }
    }
    let parsed: z.infer<typeof upstreamSchema>
    try {
      parsed = upstreamSchema.parse(await response.json())
    } catch (error) {
      deps.logger.warn({
        message: "Mezo ID answer unreadable",
        key: keyText(key),
        error: error instanceof Error ? error.message : String(error),
      })
      return { status: "unavailable" }
    }
    // Ownership, both ways: the answer must name the account we asked
    // about, through its own wallet. Anything else is not found.
    const linked = parsed.linkedAccounts
    const wallet = ownWalletOf(linked)
    const answered = canonicalMezoId(parsed.mezoId ?? "")
    if (key.kind === "btc") {
      // Where the Bitcoin address leads: the EVM address linked with it.
      // The account's ID comes along only when that is its own wallet.
      const evm = evmOfBtc(linked, key.address)
      if (evm === null) return { status: "not-found" }
      return {
        status: "found",
        mezo_id: evm === wallet ? answered : null,
        wallets: [evm],
        btc_address: key.address,
      }
    }
    if (key.kind === "mezo-id") {
      return wallet === null || answered !== key.id
        ? { status: "not-found" }
        : {
            status: "found",
            mezo_id: key.id,
            wallets: [wallet],
            btc_address: walletBtcOf(linked, wallet),
          }
    }
    // An address that is not the account's own wallet (a linked one) is
    // not named by the account's ID.
    if (wallet !== key.address) return { status: "not-found" }
    return {
      status: "found",
      mezo_id: answered,
      wallets: [wallet],
      btc_address: walletBtcOf(linked, wallet),
    }
  }
}

/** Seconds a miss is reused (the `brief` class keeps it no longer). */
const missSlotSeconds = 60

function resourceOf(key: MezoIdKey): string {
  return `/internal/scan/mezo-ids/${keyText(key)}`
}

const storedLookupSchema = z.object({ data: scanMezoIdLookupSchema })

/** A stored answer's Mezo ID, or null (a miss, or unreadable). */
function storedMezoId(body: string): string | null {
  let parsed: z.infer<typeof storedLookupSchema>
  try {
    parsed = storedLookupSchema.parse(JSON.parse(body))
  } catch {
    return null
  }
  const lookup = parsed.data
  return lookup.status === "found"
    ? canonicalMezoId(lookup.mezo_id ?? "")
    : null
}

/** `a,b,c` as distinct lower-case addresses, or null when any is not one. */
function addressesOf(raw: string): string[] | null {
  const addresses = new Set<string>()
  for (const part of raw.split(",")) {
    if (!addressPattern.test(part)) return null
    addresses.add(part.toLowerCase())
  }
  return addresses.size > scanMezoIdNamesMax ? null : [...addresses]
}

/**
 * An ID found with its own wallet also answers for that wallet's address,
 * so lists show the ID without asking Mezo. Only where the address has no
 * answer of its own yet: neither a stored ID nor this minute's "no ID"
 * from its own lookup is ever replaced.
 */
async function keepReverse(
  c: ApiContext,
  scan: ScanContext,
  id: string,
  wallet: string,
  btc: string | null,
  slot: string,
): Promise<void> {
  const resource = resourceOf({ kind: "address", address: wallet })
  if ((await scan.responder.peek(resource, "")) !== null) return
  if ((await scan.responder.peek(resource, slot)) !== null) return
  const answer: ScanMezoIdLookup = {
    status: "found",
    mezo_id: id,
    wallets: [wallet],
    btc_address: btc,
  }
  await scan.responder.keepFinal(c, resource, { data: answer })
}

/** The wallet a stored answer names for `id`, or null. */
function storedWallet(body: string | null, id: string): string | null {
  if (body === null) return null
  let parsed: z.infer<typeof storedLookupSchema>
  try {
    parsed = storedLookupSchema.parse(JSON.parse(body))
  } catch {
    return null
  }
  const lookup = parsed.data
  return lookup.status === "found" && lookup.mezo_id === id
    ? (lookup.wallets[0] ?? null)
    : null
}

/**
 * What a fresh read of an ID stores, straight from Mezo and past the
 * ownership check:
 *
 * - found: the ID's forward answer (replacing a stored one, so the next
 *   display read shows the wallet funds would go to), and its wallet's
 *   reverse answer where that address has none of its own (keepReverse);
 * - not found: the stored forward answer is dropped;
 * - either way, when the ID's wallet changed, the old wallet's answer is
 *   dropped if it still names the ID, so no list shows two wallets under
 *   one ID;
 * - unavailable: nothing changes.
 *
 * Per data center (the Cache API) and this isolate's memory: another
 * isolate keeps what it holds in memory until it is recycled.
 */
async function freshId(
  c: ApiContext,
  scan: ScanContext,
  id: string,
  answer: ScanMezoIdLookup,
  slot: string,
): Promise<void> {
  if (answer.status === "unavailable") return
  const forward = resourceOf({ kind: "mezo-id", id })
  const before = storedWallet(await scan.responder.peekFinal(forward), id)
  const now = answer.status === "found" ? (answer.wallets[0] ?? null) : null
  if (answer.status === "found" && now !== null) {
    await scan.responder.keepFinal(c, forward, { data: answer })
  } else {
    await scan.responder.forget(c, forward, "")
  }
  if (before !== null && before !== now) {
    const old = resourceOf({ kind: "address", address: before })
    if (storedMezoId((await scan.responder.peekFinal(old)) ?? "") === id) {
      await scan.responder.forget(c, old, "")
    }
  }
  if (now !== null && answer.status === "found") {
    await keepReverse(c, scan, id, now, answer.btc_address ?? null, slot)
  }
}

export function registerScanMezoIds(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  app.get("/internal/scan/mezo-ids", async (c) => {
    const { addresses: raw } = queryOf(c, { addresses: z.string().min(1) })
    const addresses = addressesOf(raw)
    if (addresses === null) throw new PlatformError("invalid_request")
    // Found answers only: those are stored under a version-free key. A
    // miss or an address never looked up has nothing there and stays out.
    const found = await Promise.all(
      addresses.map(async (address) => {
        const body = await scan.responder.peekFinal(
          resourceOf({ kind: "address", address }),
        )
        return [address, body === null ? null : storedMezoId(body)] as const
      }),
    )
    const names: ScanMezoIdNames = {}
    for (const [address, id] of found) if (id !== null) names[address] = id
    // Stored nowhere here; a caller may reuse it a minute (`brief`), so
    // Matchscan still stores the page that shows it.
    return c.json({ data: names }, 200, {
      "Cache-Control": scanCacheControl.brief,
    })
  })

  app.get("/internal/scan/mezo-ids/:key", async (c) => {
    const { fresh } = queryOf(c, { fresh: z.literal("1").optional() })
    const key = mezoIdKey(c.req.param("key"))
    if (key === null) throw new PlatformError("not_found")
    const resolve = scan.deps.mezoIds
    if (resolve === null || resolve === undefined) {
      throw new PlatformError("service_disabled")
    }
    const resource = resourceOf(key)
    const slot = `m${Math.floor(scan.nowSeconds() / missSlotSeconds)}`
    const resolver = resolve
    const asked = key
    async function lookup(): Promise<ScanMezoIdLookup> {
      const answer = await resolver(asked)
      if (answer.status !== "found" || asked.kind === "address") return answer
      // An ID, or a Bitcoin address of an ID's own wallet (the resolver
      // names the ID only then), also answers for that wallet.
      const own = answer.wallets[0]
      const id = answer.mezo_id
      if (own !== undefined && id !== null) {
        await keepReverse(c, scan, id, own, answer.btc_address ?? null, slot)
      }
      return answer
    }
    if (fresh !== undefined) {
      return scan.responder.serveFresh(c, {
        caller: callerOf(c),
        render: async () => {
          const answer = await resolver(asked)
          if (asked.kind === "mezo-id") {
            await freshId(c, scan, asked.id, answer, slot)
          }
          return { data: answer }
        },
      })
    }
    // An ID and its wallet: kept a day under a version-free key (IDs
    // rarely move), as is a Bitcoin address's EVM address. Not found, or
    // an address with no ID yet: a one-minute slot, so a new ID or link
    // shows up soon. Mezo's API down or late: stored nowhere.
    return scan.responder.serveComposed(c, {
      finalKey: { resource, version: "" },
      resource,
      version: slot,
      cacheClass: "brief",
      caller: callerOf(c),
      render: async () => {
        const answer = await lookup()
        return {
          body: { data: answer },
          final:
            answer.status === "found" &&
            (answer.mezo_id !== null || asked.kind === "btc"),
          shareable: answer.status !== "unavailable",
        }
      },
    })
  })
}
