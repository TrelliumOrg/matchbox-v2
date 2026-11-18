import * as AllocationMark from "@matchbox/ui/allocation-mark"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import type { ReactNode } from "react"
import type { GaugeSummary } from "../../data/view-models"
import { gaugeName } from "../../lib/gauge-name"
import type { Ballot } from "./ballot"

/** The ballot bar's allocation mark, shown from 1024 to 1279 only. */
export function BallotMark({
  ballot,
  gauges,
}: {
  ballot: Ballot
  gauges: ReadonlyMap<string, GaugeSummary>
}): ReactNode {
  const allocations = [...ballot.entries()].flatMap(([id, bps]) => {
    const gauge = gauges.get(id)
    return gauge === undefined || bps <= 0
      ? []
      : [
          {
            id,
            name: gaugeName(gauge),
            share: bps,
            color: gauge.color,
            picture: <GaugeCard.Picture picture={gauge.picture} size={18} />,
          },
        ]
  })
  if (allocations.length === 0) return null
  return <AllocationMark.Root allocations={allocations} surface="var(--soft)" />
}
