import {
  type ScanMezoIdLookup,
  type ScanMezoIdNames,
  scanMezoIdNamesMax,
} from "@matchbox/contracts/scan"
import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { fixtureIds } from "../../blockscout/fixtures"
import { badRequest, type FixtureRoute, ok } from "./shared"
import { wallet } from "./world"

/**
 * `/mezo-ids/{key}` as the API answers it: "alice.mezo" is the recorded
 * wallet, "kiln.mezo" the recorded address (so "kiln" finds a label and an
 * ID), "down.mezo" plays Mezo's API down (unavailable, never stored), and
 * any other well-formed ID is not found. Each wallet has a linked Bitcoin
 * address (fixtureBtc), which leads back to it; `fixtureBtc.down` plays
 * Mezo's API down, and any other mainnet Bitcoin address has no account.
 *
 * `/mezo-ids?addresses=` answers as if both had been looked up already:
 * the recorded wallet and address by their IDs, every other address left
 * out, as the API's cache-only read does.
 */

const ids: Record<string, string> = {
  "alice.mezo": wallet,
  "kiln.mezo": fixtureIds.address,
}

/** The ID Mezo's API would answer `down` with. */
export const fixtureDownMezoId = "down.mezo"

/**
 * Bitcoin addresses: the documentation vectors of BIP 173, BIP 350 and
 * base58, never a real account's address. Mirrored in e2e/mezo-id.spec.ts.
 */
export const fixtureBtc = {
  /** alice.mezo's wallet. */
  alice: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  /** kiln.mezo's wallet. */
  kiln: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
  /** No Mezo account. */
  none: "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
  /** Mezo's API down. */
  down: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
} as const

const btcOfId: Record<string, string> = {
  "alice.mezo": fixtureBtc.alice,
  "kiln.mezo": fixtureBtc.kiln,
}

function found(id: string): ScanMezoIdLookup {
  return {
    status: "found",
    mezo_id: id,
    wallets: [ids[id] ?? ""],
    btc_address: btcOfId[id] ?? null,
  }
}

function lookup(key: string): ScanMezoIdLookup | null {
  if (/^0x[0-9a-f]{40}$/.test(key)) {
    const id = Object.keys(ids).find((name) => ids[name] === key)
    return id === undefined ? { status: "not-found" } : found(id)
  }
  const btc = canonicalBtcAddress(key)
  if (btc !== null) {
    if (btc !== key) return null
    if (btc === fixtureBtc.down) return { status: "unavailable" }
    const id = Object.keys(btcOfId).find((name) => btcOfId[name] === btc)
    return id === undefined ? { status: "not-found" } : found(id)
  }
  const id = canonicalMezoId(key)
  if (id === null) return null
  if (id === fixtureDownMezoId) return { status: "unavailable" }
  return ids[id] === undefined ? { status: "not-found" } : found(id)
}

function cachedNames(raw: string): ScanMezoIdNames | null {
  const addresses = raw.split(",")
  if (!addresses.every((address) => /^0x[0-9a-fA-F]{40}$/.test(address))) {
    return null
  }
  const distinct = new Set(addresses.map((address) => address.toLowerCase()))
  if (distinct.size > scanMezoIdNamesMax) return null
  const names: ScanMezoIdNames = {}
  for (const [id, address] of Object.entries(ids)) {
    if (distinct.has(address)) names[address] = id
  }
  return names
}

export const mezoIdFixtures: FixtureRoute[] = [
  {
    pattern: /^mezo-ids$/,
    answer: (_match, query) => {
      const raw = query.get("addresses")
      if ([...query.keys()].length !== 1 || raw === null) return badRequest
      const names = cachedNames(raw)
      return names === null ? badRequest : ok({ data: names })
    },
  },
  {
    pattern: /^mezo-ids\/([^/]+)$/,
    exact: true,
    answer: (match, query) => {
      if ([...query.keys()].length > 0) return badRequest
      let key: string
      try {
        key = decodeURIComponent(match[1] ?? "")
      } catch {
        return null
      }
      const found = lookup(key)
      return found === null ? null : ok({ data: found })
    },
  },
]
