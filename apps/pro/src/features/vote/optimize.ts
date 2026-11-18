import { optimizeCapped } from "@matchbox/domain"
import type { Ballot, BallotGauge } from "./ballot"

/**
 * Optimize, with `@matchbox/domain`'s closed-form optimizer (the same one
 * Stuart uses). Loaded on demand, never on first paint.
 */

/** Every Mezo voter caps a ballot at 30 targets (`maxVotingNum`). */
const maxTargets = 30

export function optimize(
  gauges: readonly BallotGauge[],
  power: bigint,
): Ballot | null {
  const result = optimizeCapped({
    gauges: gauges
      .filter((gauge) => gauge.incentivesMicro > 0n)
      .map((gauge) => ({
        id: gauge.id,
        existingWeight: gauge.competing,
        incentiveValueMicroUsd: gauge.incentivesMicro,
      })),
    votingPowers: [power],
    maxTargets,
  })
  if (result === null) return null
  return new Map([...result].map(([id, bps]) => [id, Number(bps)]))
}
