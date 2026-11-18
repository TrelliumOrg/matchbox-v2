import type { PropertyName } from "@matchbox/ui/property-icon"
import type { GaugeKind, LockKind, VoteUnit } from "../../data/view-models"

/**
 * The four gauge types (decided 9 Nov): names, icons, the lock that votes
 * them and Vote's path segment (`/vote/vebtc`).
 */

export type GaugeKindInfo = {
  /** "veBTC gauges" */
  label: string
  /** "veBTC gauge" */
  singular: string
  property: PropertyName
  /** The escrow whose locks vote this type. */
  escrow: LockKind
  unit: VoteUnit
  segment: VoteSegment
}

export type VoteSegment = "vebtc" | "mezo" | "validators" | "pools"

export const gaugeKinds: Record<GaugeKind, GaugeKindInfo> = {
  vebtc: {
    label: "veBTC gauges",
    singular: "veBTC gauge",
    property: "vebtc-gauge",
    escrow: "vemezo",
    unit: "veMEZO",
    segment: "vebtc",
  },
  mezo: {
    label: "MEZO gauges",
    singular: "MEZO gauge",
    property: "mezo-gauge",
    escrow: "vemezo",
    unit: "veMEZO",
    segment: "mezo",
  },
  validator: {
    label: "Validator gauges",
    singular: "Validator gauge",
    property: "validator-gauge",
    escrow: "vebtc",
    unit: "veBTC",
    segment: "validators",
  },
  pool: {
    label: "Pool gauges",
    singular: "Pool gauge",
    property: "pool-gauge",
    escrow: "vebtc",
    unit: "veBTC",
    segment: "pools",
  },
}

/** Listed in this order, grouped by the lock that votes them. */
export const kindOrder: readonly GaugeKind[] = [
  "vebtc",
  "mezo",
  "validator",
  "pool",
]

export const escrowGroups: readonly {
  escrow: LockKind
  label: string
  kinds: readonly GaugeKind[]
}[] = [
  { escrow: "vemezo", label: "Voted with veMEZO", kinds: ["vebtc", "mezo"] },
  { escrow: "vebtc", label: "Voted with veBTC", kinds: ["validator", "pool"] },
]

export function kindForSegment(segment: string): GaugeKind | null {
  for (const kind of kindOrder) {
    if (gaugeKinds[kind].segment === segment) return kind
  }
  return null
}

/** "22,582 veMEZO", "0.80 veBTC": votes always carry the escrow's unit. */
export const escrowUnit: Record<LockKind, VoteUnit> = {
  vemezo: "veMEZO",
  vebtc: "veBTC",
}
