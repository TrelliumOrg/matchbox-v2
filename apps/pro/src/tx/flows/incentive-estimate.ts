import { microToUsd, usdToMicro } from "../../features/vote/ballot"
import { formatUsd } from "../../lib/format"

const wad = 10n ** 18n

/**
 * What an addition pays per 1,000 votes on the gauge, at the votes it has
 * now: "About $0.11", or "Under $0.01". Null when the gauge has less than
 * one vote, where the figure would mean nothing. Votes move until the
 * epoch closes, so this is an estimate and says so.
 */
export function perThousandVotes(
  addedUsd: string,
  votesWei: string,
): string | null {
  const votes = BigInt(votesWei)
  if (votes < wad) return null
  const micro = (usdToMicro(addedUsd) * 1_000n * wad) / votes
  if (micro <= 0n) return null
  return micro < 10_000n
    ? "Under $0.01"
    : `About ${formatUsd(microToUsd(micro), "cents")}`
}
