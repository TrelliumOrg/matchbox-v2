import { scanMetricDefinition } from "@matchbox/contracts/scan"

/**
 * Series a page charts are named only through the registry exported by
 * `@matchbox/contracts/scan` (series.ts): `metric` throws at module load
 * when a name is not registered, so a rename in the registry fails the
 * build and tests here instead of drawing an empty chart. Keep each page's
 * choices in one small map (`{ volume: metric("dex.volume_in") }`), so a
 * rename is a one-line change. Never add two metrics together.
 */
export function metric<Name extends string>(name: Name): Name {
  if (scanMetricDefinition(name) === null) {
    throw new Error(`Series metric "${name}" is not in the registry`)
  }
  return name
}

/** The ranges a captioned panel offers (30d first, then 90d, then All). */
export const seriesRanges = { "30d": 30, "90d": 90, All: 730 } as const

export type SeriesRange = keyof typeof seriesRanges
