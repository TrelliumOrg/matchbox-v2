import { scanMetricDefinition } from "@matchbox/contracts/scan"
import { formatCompact, unitsToDecimal } from "@matchbox/domain/format"
import { canonicalQuery } from "../caller.server"
import type { Section } from "../explorer"
import { readScan } from "./read.server"
import { scanSchemas } from "./schemas"
import { knownTokens } from "./tokens"

/**
 * One daily series for a chart (`/series?metric=&dimension=&from=&to=`):
 * points as display numbers in whole units, each with its exact formatted
 * text, the current day marked partial (drawn in progress), and the
 * series' own facts from the registry (flow or level, unit, decimals,
 * first day, the last day of a backfill-only series). Values are never
 * summed across metrics.
 */

export type SeriesView = {
  metric: string
  kind: "flow" | "level"
  unit: "amount" | "count"
  points: {
    day: string
    value: number
    text: string
    /** The exact value in whole units, a decimal string ("1.2400"). */
    decimal: string
    partial: boolean
  }[]
  /** The latest point's text ("1,204", "6.41k"), with whether it is partial. */
  latest: { text: string; partial: boolean } | null
  firstDay: string | null
  /** A backfill-only series ends here; null for live series. */
  endsOn: string | null
  /** Cut to a custom span that holds none of the days it has. */
  outside?: boolean
}

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

function decimalsOf(
  decimals: number | "token" | null,
  dimension: string,
): number | null {
  if (decimals === null) return 0
  if (decimals !== "token") return decimals
  const token = dimension.split(":").at(-1) ?? ""
  return knownTokens[token.toLowerCase()]?.decimals ?? null
}

/** A decimal's whole part, compact: "1,204", "6.41k". */
export function wholeText(decimal: string): string {
  const [whole = "0"] = decimal.split(".")
  const negative = whole.startsWith("-")
  const text = formatCompact(BigInt(negative ? whole.slice(1) : whole))
  return `${negative ? "-" : ""}${text}`
}

export async function readSeries(input: {
  metric: string
  dimension?: string
  days: number
  now: number
  /**
   * The token's decimals for a "token" metric whose dimension does not
   * name the token (a Morpho market id: the loan token's for supply and
   * borrow, the collateral token's for collateral). Ignored otherwise.
   */
  tokenDecimals?: number
}): Promise<Section<SeriesView>> {
  const definition = scanMetricDefinition(input.metric)
  if (definition === null) return { status: "unavailable" }
  const dimension = input.dimension ?? ""
  // Ours, until the API says which token's decimals these are: a "token"
  // series answers resolvedDecimals (the dimension's token, a market's
  // loan or collateral token), which wins.
  const local =
    definition.decimals === "token" && input.tokenDecimals !== undefined
      ? input.tokenDecimals
      : decimalsOf(definition.decimals, dimension)
  const to = day(input.now)
  const from = day(input.now - Math.max(1, input.days - 1) * 86_400)
  const read = await readScan(
    "series",
    canonicalQuery({ metric: input.metric, dimension, from, to }),
    scanSchemas.series,
  )
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  if (read.status !== "ok") return { status: "unavailable" }
  const series = read.data.data
  const decimals =
    definition.decimals === "token" ? (series.resolvedDecimals ?? local) : local
  // A token amount whose decimals nobody knows is not drawn: guessing them
  // would invent the figures (a total across tokens or markets is summed
  // in different units, so the API resolves none).
  if (decimals === null) return { status: "unavailable" }
  const points = series.points.map((point) => {
    const decimal = unitsToDecimal(point.value, decimals)
    return {
      day: point.day,
      value: Number(decimal),
      text: wholeText(decimal),
      decimal,
      partial: point.partial,
    }
  })
  const last = points.at(-1)
  return {
    status: "ok",
    data: {
      metric: series.metric,
      kind: series.kind,
      unit: series.unit,
      points,
      latest:
        last === undefined ? null : { text: last.text, partial: last.partial },
      firstDay: series.firstDay,
      endsOn: series.endsOn,
    },
  }
}
