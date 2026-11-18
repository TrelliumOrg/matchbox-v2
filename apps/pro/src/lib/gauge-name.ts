import { nameWithPoolType } from "@matchbox/domain/pool-type"
import type { GaugeRef } from "../data/view-models"

/**
 * A gauge's name where text has one line for it: a pool gauge carries its
 * pool type ("BTC/MUSD CL200"), so pools that share a pair stay apart.
 */
export function gaugeName(gauge: Pick<GaugeRef, "name" | "poolLabel">): string {
  return nameWithPoolType(gauge.name, gauge.poolLabel ?? null)
}
