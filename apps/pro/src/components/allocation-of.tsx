import type * as AllocationMark from "@matchbox/ui/allocation-mark"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import type { GaugeRef } from "../data/view-models"
import { gaugeName } from "../lib/gauge-name"

/**
 * A lock's votes as the allocation mark takes them. On its own, apart from
 * the activity row: the lock cards use it too, and importing it from the
 * row's module put the whole row in Overview's first paint although the
 * activity list there is an island.
 */
export function allocationOf(
  allocation: readonly { gauge: GaugeRef; shareBps: number }[],
): AllocationMark.RootProps["allocations"] {
  return allocation.map(({ gauge, shareBps }) => ({
    id: gauge.address,
    name: gaugeName(gauge),
    share: shareBps,
    color: gauge.color,
    picture: <GaugeCard.Picture picture={gauge.picture} size={18} />,
  }))
}
