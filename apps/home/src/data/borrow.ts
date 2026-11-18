import type { ScanBorrowTotalsResponse } from "@matchbox/contracts/scan"
import { formatDecimal, unitsToDecimal } from "@matchbox/domain/format"
import { compactText, dayText, type ScanFigures, scaleSeries } from "./figures"

/**
 * The Borrowed stat from `GET /internal/scan/borrow/totals` (README,
 * Borrowed): MUSD owed across Mezo's borrow venues, in MUSD and never in
 * dollars, since nothing prices MUSD and no stablecoin is taken as $1.
 */

export type BorrowFigures = Pick<
  ScanFigures,
  "borrowedMusd" | "borrowedEnclaves" | "borrowedSeries" | "borrowedDays"
>

/** `enclaves_share` is a fraction with 18 decimals: 1e18 is 100%. */
const shareDecimals = 18

/**
 * The stat's figures, or null when the answer has no total (a venue it
 * could not read): the page then keeps what it showed before, or says
 * "Not available", and never shows a partial sum. Amounts go from base
 * units with the answer's own decimals, in bigint; the share is a
 * percent with one decimal ("98.6"); the sparkline skips the days whose
 * total is null.
 */
export function borrowFigures(
  answer: ScanBorrowTotalsResponse,
): BorrowFigures | null {
  const { data } = answer
  if (data.total === null) return null
  return {
    borrowedMusd: unitsToDecimal(data.total, data.unit.decimals),
    borrowedEnclaves:
      data.enclaves_share === null
        ? null
        : // A percent is the fraction with two fewer decimals.
          formatDecimal(
            unitsToDecimal(data.enclaves_share, shareDecimals - 2),
            1,
          ).replaceAll(",", ""),
    borrowedSeries:
      data.history.status === "ok"
        ? scaleSeries(data.history.data.points.map((point) => point.total))
        : null,
    borrowedDays:
      data.history.status === "ok"
        ? data.history.data.points.map((point) =>
            point.total === null
              ? null
              : {
                  label: dayText(point.day, point.partial),
                  // Compact, as the stat writes its total: "4.06M MUSD".
                  text: `${compactText(unitsToDecimal(point.total, data.unit.decimals))} MUSD`,
                },
          )
        : null,
  }
}
