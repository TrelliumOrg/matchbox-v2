import { type CalcSearch, calcSearch } from "../../boost/calc-link"
import type { GaugeSummary } from "../../data/view-models"
import { weiToWhole } from "../../lib/format"

/**
 * A weight cut to six decimal places, without trailing zeros: the chain
 * gives eighteen ("250.166000859788582573"), which filled the calculator's
 * field and went into the URL as a quoted string. Six is two more than the
 * app shows anywhere, and it stays a number in the URL.
 */
function sixPlaces(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".")
  const kept = fraction.slice(0, 6).replace(/0+$/, "")
  return kept === "" ? whole : `${whole}.${kept}`
}

/**
 * The search that opens the boost calculator on a veBTC gauge's own
 * figures: its lock's veBTC weight and the veMEZO votes on it now, working
 * out the boost, so it opens showing the boost the profile shows. Null for
 * a gauge with no boost (a pool, a validator, a MEZO gauge) and for one
 * whose lock has no weight left.
 */
export function gaugeCalcSearch(gauge: GaugeSummary): CalcSearch | null {
  if (gauge.meta.kind !== "vebtc") return null
  const weight = sixPlaces(gauge.meta.weight)
  // Nothing left, or less than the calculator can show.
  if (!/[1-9]/.test(weight)) return null
  return calcSearch({
    veBtc: weight,
    veMezo: weiToWhole(gauge.votes).toString(),
    solve: "boost",
  })
}
