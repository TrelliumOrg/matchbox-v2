import type { LockRef, Overview, Rewards } from "../data/view-models"
import type { TxRequest } from "./tx-store"

/**
 * The claim request for Claim all, Claim and relock and a lock's own Claim.
 * The sources come from the rewards read model (which gauges each lock
 * earns from) joined with the gauges each lock votes now, so a claim still
 * covers a gauge the read model has not caught up with. The chain decides
 * the amounts at review.
 */
export function claimRequest(
  rewards: Rewards,
  overview: Overview | null,
  options: { relock: boolean; only?: LockRef },
): Extract<TxRequest, { flow: "claim" }> {
  const wanted = (lock: LockRef): boolean =>
    options.only === undefined ||
    (options.only.kind === lock.kind && options.only.tokenId === lock.tokenId)

  const sources = rewards.locks
    .filter((entry) => wanted(entry.lock))
    .map((entry) => {
      const live =
        overview?.locks.find(
          (lock) =>
            lock.kind === entry.lock.kind &&
            lock.tokenId === entry.lock.tokenId,
        )?.votes ?? []
      const gauges = new Map(
        entry.gauges.map((gauge) => [
          gauge.address.toLowerCase(),
          { address: gauge.address, voter: gauge.voter, name: gauge.name },
        ]),
      )
      for (const vote of live) {
        const key = vote.gauge.address.toLowerCase()
        if (!gauges.has(key)) {
          gauges.set(key, {
            address: vote.gauge.address,
            voter: vote.gauge.voter,
            name: vote.gauge.name,
          })
        }
      }
      return { lock: entry.lock, usd: entry.usd, gauges: [...gauges.values()] }
    })

  const relockInto =
    overview?.locks
      .filter((lock) => lock.kind === "vemezo" && !lock.expired)
      .sort((left, right) =>
        BigInt(right.votingPowerWei) > BigInt(left.votingPowerWei) ? 1 : -1,
      )[0] ?? null

  const usd =
    options.only === undefined
      ? rewards.claimable.usd
      : (sources[0]?.usd ?? "0")

  return {
    flow: "claim",
    sources,
    usd,
    tokens:
      options.only === undefined
        ? rewards.claimable.tokens
        : (rewards.locks.find((entry) => wanted(entry.lock))?.tokens ?? []),
    relockInto: relockInto === null ? null : { tokenId: relockInto.tokenId },
    relock: options.relock && relockInto !== null,
  }
}
