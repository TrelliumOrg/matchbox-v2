/**
 * Links from Matchscan into Matchbox Pro. "Vote on Matchbox" opens Vote on
 * the gauge's type with the gauge already on the ballot (`?pick=`), not the
 * gauge's profile: the reader came to vote, and the profile is one click
 * from the ballot.
 */

export const proOrigin = "https://pro.matchbox.markets"

type GaugeKind = "vebtc" | "mezo" | "validator" | "pool"

/** Vote's path segment for each gauge type (Pro's `/vote/<segment>`). */
const voteSegment: Record<GaugeKind, string> = {
  vebtc: "vebtc",
  mezo: "mezo",
  validator: "validators",
  pool: "pools",
}

/**
 * Vote with this gauge picked. Without a known type the link goes to
 * `/vote`, which opens the gauge's own type.
 */
export function proVoteUrl(
  gauge: string,
  kind: GaugeKind | null | undefined,
): string {
  const path =
    kind === null || kind === undefined ? "/vote" : `/vote/${voteSegment[kind]}`
  return `${proOrigin}${path}?pick=${gauge.toLowerCase()}`
}
