import { bandBoost } from "@matchbox/ui/gauge-card"
import type {
  GaugeKind,
  GaugeProfile,
  Market,
  Picture,
  Protocol,
} from "../data/view-models"
import { gaugeKinds } from "../features/gauge/kinds"
import { formatIncentives, formatVeBtc, weiToWhole } from "../lib/format"

/**
 * What each link preview card shows, built from the same view models the
 * screens render. Pure: no fetches, no Worker bindings, so tests build them
 * from fixtures.
 */

/** Every page without its own card. Nulls when the read models failed. */
export type DefaultCard = {
  kind: "default"
  epoch: number
  /** Seconds left in the epoch. */
  endsIn: number | null
  incentivesUsd: string | null
  /** Wei. */
  veMezoLocked: string | null
  /** Whole units, decimal string. */
  veBtcLocked: string | null
}

export type CardPicture = Picture | { kind: "pair"; tokens: string[] }

export type GaugeCard = {
  kind: "gauge"
  epoch: number
  address: string
  name: string
  /** "#6033", shown grey after the name; null when the name has it. */
  id: string | null
  gaugeKind: GaugeKind
  /** "veBTC gauge, 250.1660 veBTC" */
  typeLine: string
  picture: CardPicture
  apyBps: number | null
  /** "$12.40", "Unpriced", "$1.15 + 2 unpriced" (`formatIncentives`). */
  incentives: string
  incentiveTokens: string[]
  /** "5×" and whether the gauge is at or past optimal. Null without a boost. */
  boost: { label: string; atMax: boolean } | null
  /** Band fill 0 to 1; null for gauges without a band. */
  band: { fill: number; atMax: boolean } | null
  expired: boolean
}

export type ProtocolCard = {
  kind: "protocol"
  epoch: number
  incentivesUsd: string
  changeUsd: string
  /** Up to 12 epochs ending at (or around) the selected one, oldest first. */
  bars: { epoch: number; usd: string; selected: boolean }[]
}

export type Card = DefaultCard | GaugeCard | ProtocolCard

export function defaultCard(
  market: Market | null,
  protocol: Protocol | null,
  epoch: number,
  nowSeconds: number,
): DefaultCard {
  return {
    kind: "default",
    epoch: protocol?.latestEpoch ?? market?.epoch.number ?? epoch,
    endsIn:
      market === null ? null : Math.max(0, market.epoch.endsAt - nowSeconds),
    incentivesUsd: protocol?.incentivesUsd ?? null,
    veMezoLocked: protocol?.stats.veMezoLocked ?? null,
    veBtcLocked: protocol?.stats.veBtcLocked ?? null,
  }
}

const poolKinds = {
  cl: "Concentrated",
  stable: "Stable",
  volatile: "Volatile",
  vault: "Vault",
} as const

const validatorStatus = {
  active: "Active",
  jailed: "Jailed",
  inactive: "Inactive",
} as const

/** The type's compact metadata, as the cards show it. */
function metaLine(profile: GaugeProfile): string | null {
  const meta = profile.gauge.meta
  switch (meta.kind) {
    case "vebtc":
      return meta.lock === "expired" ? "Lock expired" : formatVeBtc(meta.weight)
    case "validator":
      return (
        meta.operator ??
        (meta.status === null ? null : validatorStatus[meta.status])
      )
    case "pool": {
      const pair = meta.pair.join("/")
      const parts = [
        // Pool gauges are named by their pair: say it once.
        pair === "" || pair === profile.gauge.name ? null : pair,
        meta.poolKind === null ? null : poolKinds[meta.poolKind],
      ].filter((part) => part !== null)
      return parts.length === 0 ? null : parts.join(", ")
    }
    case "mezo":
      return meta.chain ?? meta.protocol
  }
}

export function gaugeCard(profile: GaugeProfile, epoch: number): GaugeCard {
  const gauge = profile.gauge
  const id =
    gauge.tokenId === null || gauge.name.includes("#")
      ? null
      : `#${gauge.tokenId}`
  const meta = metaLine(profile)
  const singular = gaugeKinds[gauge.kind].singular
  const pair = gauge.meta.kind === "pool" ? gauge.meta.pair : []
  // Pool gauges are pictured by their pair's coins, as Protocol lists them.
  const picture: CardPicture =
    gauge.picture.kind === "initials" && pair.length > 0
      ? { kind: "pair", tokens: pair }
      : gauge.picture
  let boost: GaugeCard["boost"] = null
  let band: GaugeCard["band"] = null
  if (gauge.optimalVotes !== null && !gauge.expired) {
    const votes = Number(weiToWhole(gauge.votes))
    const optimal = Number(weiToWhole(gauge.optimalVotes))
    const ratio = optimal > 0 ? votes / optimal : 0
    const atMax = optimal > 0 && ratio >= 1
    boost = { label: bandBoost(votes, optimal), atMax }
    band = { fill: Math.min(Math.max(ratio, 0), 1), atMax }
  }
  return {
    kind: "gauge",
    epoch,
    address: gauge.address,
    name: gauge.name,
    id,
    gaugeKind: gauge.kind,
    typeLine: meta === null ? singular : `${singular}, ${meta}`,
    picture,
    apyBps: gauge.expired ? null : gauge.apyBps,
    incentives: formatIncentives({
      usd: gauge.incentivesUsd,
      priced: gauge.priced,
      unpriced: gauge.unpriced,
    }),
    incentiveTokens: gauge.incentiveTokens,
    boost,
    band,
    expired: gauge.expired,
  }
}

/** Bars on the card, as many as one Protocol chart window. */
const barCount = 12

export function protocolCard(protocol: Protocol): ProtocolCard {
  const all = protocol.incentivesByEpoch
  const index = all.findIndex((bar) => bar.epoch === protocol.epoch)
  const end =
    index < 0 ? all.length : Math.min(all.length, Math.max(index + 1, barCount))
  const shown = all.slice(Math.max(0, end - barCount), end)
  return {
    kind: "protocol",
    epoch: protocol.epoch,
    incentivesUsd: protocol.incentivesUsd,
    changeUsd: protocol.incentivesChangeUsd,
    bars: shown.map((bar) => ({
      epoch: bar.epoch,
      usd: bar.all,
      selected: bar.epoch === protocol.epoch,
    })),
  }
}
