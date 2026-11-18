import type {
  EpochIncentives,
  FundedGauge,
  GaugeCard,
  GaugeDirectory,
  Protocol,
} from "@matchbox/contracts/read-models"
import { subtractUsd, sumUsd, toCents } from "./money"

/**
 * The current epoch's incentives, taken from the gauge directory.
 *
 * Two things count this epoch's incentives. The directory's cards read
 * each gauge's reward contracts on chain. The protocol read model sums the
 * deposits the indexer decoded. They are the same money, but the indexer
 * can miss a reward contract (the sMUSD gauge, created before its start
 * block, had 10,000 MUSD the total left out on 11 Nov 2026) and prices a
 * deposit at the time it landed, so the total and the cards disagreed and
 * one gauge could show more than the whole epoch.
 *
 * For the current epoch the cards are the truth: they are what the chain
 * holds now, and they are what the screens list beside the total. So the
 * total, its split by voter and the funded list are rebuilt from the same
 * cards whenever both documents describe the same epoch. Past epochs, the
 * previous total and deposit counts stay the indexer's; a gauge it has no
 * deposits for gets a null count, not a zero.
 */

const segmentByVoter: Partial<
  Record<GaugeCard["gauge"]["voter"], "vebtcUsd" | "validatorsUsd" | "poolsUsd">
> = {
  boost: "vebtcUsd",
  validators: "validatorsUsd",
  pools: "poolsUsd",
}

/** A gauge with rewards this epoch, alive or not: the money is there. */
function hasIncentives(card: GaugeCard): boolean {
  return card.incentives.tokens.length > 0
}

function byUsdDescending(left: FundedGauge, right: FundedGauge): number {
  const difference =
    toCents(right.incentives.usd) - toCents(left.incentives.usd)
  return difference > 0n ? 1 : difference < 0n ? -1 : 0
}

export function withDirectoryIncentives(
  protocol: Protocol,
  directory: GaugeDirectory,
): Protocol {
  if (directory.epoch.number !== protocol.epoch.number) return protocol
  const cards = directory.gauges.filter(hasIncentives)
  const usd = sumUsd(cards.map((card) => card.incentives.usd))
  const deposits = new Map(
    protocol.funded.gauges.map((entry) => [
      entry.gauge.address.toLowerCase(),
      entry.deposits,
    ]),
  )
  const gauges = cards
    .map((card) => ({
      gauge: card.gauge,
      incentives: card.incentives,
      deposits: deposits.get(card.gauge.address.toLowerCase()) ?? null,
    }))
    .sort(byUsdDescending)
  const segment = (name: "vebtcUsd" | "validatorsUsd" | "poolsUsd") =>
    sumUsd(
      cards.flatMap((card) =>
        segmentByVoter[card.gauge.voter] === name ? [card.incentives.usd] : [],
      ),
    )
  const bar: EpochIncentives = {
    epoch: protocol.epoch,
    totalUsd: usd,
    vebtcUsd: segment("vebtcUsd"),
    validatorsUsd: segment("validatorsUsd"),
    poolsUsd: segment("poolsUsd"),
  }
  const previousUsd = protocol.incentives.previousUsd
  return {
    ...protocol,
    incentives: {
      usd,
      previousUsd,
      changeUsd: previousUsd === null ? null : subtractUsd(usd, previousUsd),
    },
    incentivesByEpoch: protocol.incentivesByEpoch.map((entry) =>
      entry.epoch.number === protocol.epoch.number ? bar : entry,
    ),
    funded: { count: gauges.length, gauges },
  }
}
