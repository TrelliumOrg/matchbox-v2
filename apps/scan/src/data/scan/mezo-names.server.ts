import { scanMezoIdNamesMax } from "@matchbox/contracts/scan"
import { bareWallets, nameWallets } from "./mezo-names"
import { readScan } from "./read.server"
import { scanSchemas } from "./schemas"

/**
 * Names a page's bare wallet addresses by their Mezo IDs (mezo-names.ts)
 * with one read, `/internal/scan/mezo-ids?addresses=`, after the page's
 * own reads. That route answers only from the API's cache (IDs the address
 * page, the search or a Mezo ID link already looked up) and never asks
 * Mezo, so a 50-row list costs one read whatever its rows. A page with no
 * bare address reads nothing. Past `mezoNamesWaitMs`, or when the read
 * fails, the page shows its addresses as before.
 */

/** How long a page waits for the names; the cache answers in a few ms. */
export const mezoNamesWaitMs = 250

export async function withMezoIds<T>(
  value: T,
  waitMs = mezoNamesWaitMs,
): Promise<T> {
  const addresses = bareWallets(value, scanMezoIdNamesMax)
  if (addresses.length === 0) return value
  const read = readScan(
    "mezo-ids",
    // Sorted, so the same set of addresses is the same request.
    new URLSearchParams({ addresses: [...addresses].sort().join(",") }),
    scanSchemas.mezoIdNames,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs)
  })
  try {
    const answer = await Promise.race([read, late])
    if (answer === "late" || answer.status !== "ok") return value
    return nameWallets(value, answer.data.data)
  } finally {
    clearTimeout(timer)
  }
}
