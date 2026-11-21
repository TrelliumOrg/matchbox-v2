import { MEZO_APP_GAUGES } from "@matchbox/chain"
import type { NetworkSlug } from "@matchbox/contracts/network"
import type { GaugeDirectory } from "@matchbox/contracts/read-models"

const listed = new Set<string>(MEZO_APP_GAUGES)

/**
 * The directory as Pro lists it. On mainnet a MEZO gauge the Mezo app does
 * not list is left out, so Vote, Optimize and the summary offer the same
 * MEZO gauges as the app. The stored directory keeps every gauge: Scan, the
 * jobs and a gauge's own page still read them, and a lock's standing vote on
 * one still shows. Testnet is left whole, since the app lists none there.
 */
export default function proDirectory(
  directory: GaugeDirectory,
  network: NetworkSlug,
): GaugeDirectory {
  if (network !== "mezo") return directory
  return {
    ...directory,
    gauges: directory.gauges.filter(
      (card) =>
        card.gauge.voter !== "third-party" ||
        listed.has(card.gauge.address.toLowerCase()),
    ),
  }
}
