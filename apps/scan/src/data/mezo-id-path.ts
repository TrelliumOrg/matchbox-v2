import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { canonicalAddress } from "./canonical"
import { findMezoId } from "./mezo-id"

/**
 * Where `/address/alice.mezo/votes` or `/address/bc1q…/votes` goes: the
 * wallet's own address page with the same tab (for a Bitcoin address, the
 * EVM address Mezo links with it). `none` is a Bitcoin address Mezo has no
 * account for; null (the plain 404) is a segment that is neither shape, an
 * ID with no wallet, or Mezo's API out. Only ever a path on this origin,
 * built from a validated address and a known tab. Loaded on demand, so
 * pages keep it out of their entry chunk.
 */
export async function mezoIdAddressPath(
  segment: string,
  pathname: string,
  tabs: ReadonlySet<string>,
): Promise<string | "none" | null> {
  const key = canonicalBtcAddress(segment) ?? canonicalMezoId(segment)
  if (key === null) return null
  const match = await findMezoId({ data: { q: key } })
  if (match?.btcAddress !== undefined && match.wallets.length === 0) {
    return "none"
  }
  const wallet = canonicalAddress(match?.wallets[0] ?? "")
  if (wallet === null) return null
  const tab = pathname.split("/")[3] ?? ""
  return `/address/${wallet}${tabs.has(tab) ? `/${tab}` : ""}`
}
