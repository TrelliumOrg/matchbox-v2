import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { mezoIdFromQuery } from "@matchbox/domain/mezo-id"
import { degrade } from "./caller.server"
import { readScan } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"

/**
 * Mezo IDs and linked Bitcoin addresses through the API
 * (`/internal/scan/mezo-ids/{key}`, which asks Mezo's accounts API and
 * caches the answer). Quiet by design: an unknown ID, Mezo's API down or
 * ours busy all read as no match, so the palette keeps its other readings
 * and a page keeps rendering. A Bitcoin address Mezo has no account for is
 * the one miss said out loud.
 */

/**
 * A Mezo account found by its ID or by a Bitcoin address, and its wallets,
 * the account's own first. For a Bitcoin address, `btcAddress` is that
 * address and `wallets` the EVM address linked with it; `mezoId` is null
 * when that is not the ID's own wallet. No wallets: Mezo has no account
 * for that Bitcoin address.
 */
export type MezoIdMatch = {
  mezoId: string | null
  wallets: string[]
  btcAddress?: string
}

/**
 * The account a query could name: a mainnet Bitcoin address, else a Mezo
 * ID ("alice.mezo", "alice").
 */
export async function mezoIdMatch(q: string): Promise<MezoIdMatch | null> {
  // The server's own reading: never a key the browser sent unchecked.
  const query = q.slice(0, 80)
  const btc = canonicalBtcAddress(query)
  const id = btc === null ? mezoIdFromQuery(query) : null
  const key = btc ?? id
  if (key === null) return null
  const read = await readScan(
    `mezo-ids/${encodeURIComponent(key)}`,
    new URLSearchParams(),
    scanSchemas.mezoId,
  )
  if (read.status !== "ok") return null
  const lookup = read.data.data
  if (btc !== null) {
    if (lookup.status === "not-found") {
      return { mezoId: null, wallets: [], btcAddress: btc }
    }
    if (lookup.status !== "found" || lookup.wallets.length === 0) return null
    return { mezoId: lookup.mezo_id, wallets: lookup.wallets, btcAddress: btc }
  }
  if (lookup.status !== "found" || lookup.wallets.length === 0) return null
  return { mezoId: key, wallets: lookup.wallets }
}

/**
 * How long the address page waits for the ID beside its document. Found
 * IDs are cached a day, so this only bites when Mezo's API is slow; the
 * page then renders without the ID and is not stored.
 */
export const addressMezoIdWaitMs = 800

/** What Mezo says of an address: its Mezo ID and linked Bitcoin address. */
export type AddressIdentity = {
  mezoId: string | null
  btcAddress: string | null
}

const unnamed: AddressIdentity = { mezoId: null, btcAddress: null }

/** The Mezo ID and linked Bitcoin address of a lower-case address. */
export async function mezoIdOfAddress(
  address: string,
  waitMs = addressMezoIdWaitMs,
): Promise<AddressIdentity> {
  if (!/^0x[0-9a-f]{40}$/.test(address)) return unnamed
  const read = readScan(
    `mezo-ids/${address}`,
    new URLSearchParams(),
    scanSchemas.mezoId,
  ).then((answer): AddressIdentity => {
    if (answer.status !== "ok" || answer.data.data.status !== "found") {
      return unnamed
    }
    const found = answer.data.data
    return {
      mezoId: found.mezo_id,
      btcAddress: canonicalBtcAddress(found.btc_address ?? ""),
    }
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs)
  })
  try {
    const result = await Promise.race([read, late])
    if (result !== "late") return result
    degrade()
    return unnamed
  } finally {
    clearTimeout(timer)
  }
}
