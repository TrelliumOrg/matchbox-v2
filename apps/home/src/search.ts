import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { isValidAddress } from "@matchbox/domain/checksum"
import { normalizeHex } from "@matchbox/domain/format"
import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { links } from "./page/links"

/**
 * `/search?q=…`: where the Matchscan card's search form submits, as a
 * plain GET, so it works without JavaScript. It sends the query on to the
 * matching Matchscan page by the query's shape, by the rules of
 * Matchscan's own search (apps/scan/src/search/detect.ts), of which it
 * takes only the shapes that have one reading:
 *
 * - 32 bytes of hex, with or without "0x": a transaction (Matchscan offers
 *   the transaction first, and the block with that hash after it).
 * - 20 bytes of hex: an address. Mixed case must carry a valid EIP-55
 *   checksum, as Matchscan requires.
 * - "block 13078795", "b13078795", "block #13,078,795": a block. So is a
 *   bare number above 1,000,000, where Matchscan's only reading is a
 *   block (lock ids and epochs stay far below).
 * - "alice.mezo": a Mezo ID, to `/address/alice.mezo`, which Matchscan
 *   resolves to the wallet's address (a bare "alice" stays a name).
 * - A mainnet Bitcoin address ("bc1q…", "1…", "3…"): to `/address/bc1q…`,
 *   which Matchscan resolves to the EVM address Mezo links with it.
 *
 * Anything else, a bare small number (an epoch, a lock or a block), a
 * name, or an empty query, goes to Matchscan's home page, where its search
 * palette can offer every reading.
 *
 * Never an open redirect: the origin is Matchscan's, fixed at build, and
 * the path is one of three fixed prefixes followed by lower-case hex,
 * ASCII digits, a Mezo ID of [a-z0-9-] and ".mezo", or a Bitcoin address
 * of ASCII letters and digits that this module validated. Nothing else
 * from the query reaches the target.
 */

export const searchPath = "/search"

/** Matchscan's own limit: a hash is 66 characters, longer is no shape. */
const maxQueryLength = 120

/** Matchscan's: lock ids stay far below block heights. */
const maxLockId = 1_000_000

const scanOrigin = new URL(links.scan).origin

/** A whole number, allowing "13,078,795" and "13 078 795"; ASCII only. */
function wholeNumber(value: string): number | null {
  const bare = value.replace(/[,_\s]/g, "")
  if (!/^[0-9]{1,12}$/.test(bare)) return null
  const parsed = Number(bare)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** "block 1", "b1", "block #1": the number, else null. Linear in the query. */
function labelledBlock(value: string): number | null {
  const lower = value.toLowerCase()
  const label = ["block", "b"].find((candidate) => lower.startsWith(candidate))
  if (label === undefined) return null
  let rest = value.slice(label.length).trimStart()
  if (rest.startsWith("#")) rest = rest.slice(1).trimStart()
  return wholeNumber(rest)
}

/** The Matchscan path for a query: a page, or "/" for Matchscan's home. */
export function searchTargetPath(query: string | null): string {
  if (query === null || query.length > maxQueryLength) return "/"
  const value = query.trim()
  if (value === "") return "/"
  const hash = normalizeHex(value, 32)
  if (hash !== null) return `/tx/${hash}`
  const address = normalizeHex(value, 20)
  if (address !== null) {
    const typed = /^0[xX]/.test(value) ? `0x${value.slice(2)}` : `0x${value}`
    return isValidAddress(typed) ? `/address/${address}` : "/"
  }
  const btc = canonicalBtcAddress(value)
  if (btc !== null) return `/address/${btc}`
  const mezoId = canonicalMezoId(value)
  if (mezoId !== null) return `/address/${mezoId}`
  const block = labelledBlock(value)
  if (block !== null) return `/block/${block}`
  const number = wholeNumber(value)
  if (number !== null && number > maxLockId) return `/block/${number}`
  return "/"
}

/** The absolute address on Matchscan for a request to `/search`. */
export function searchTarget(url: URL): string {
  return `${scanOrigin}${searchTargetPath(url.searchParams.get("q"))}`
}

/** The redirect, or 405 for anything but GET and HEAD. Never cached. */
export function searchResponse(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    })
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: searchTarget(new URL(request.url)),
      "cache-control": "no-store",
    },
  })
}
