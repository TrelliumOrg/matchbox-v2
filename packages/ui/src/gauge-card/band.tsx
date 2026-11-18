import type { ReactNode } from "react"
import { Glyph, shapes } from "../icons"

/**
 * The gauge card's 48px labelled band, in its own module so screens that
 * show only the band (Overview's veBTC lock cards) do not load the card.
 */

export type BandProps = {
  /** Votes on the gauge, whole units. Ratios only: no money here. */
  votes: number
  /** Votes that take the gauge to 5x. */
  optimal: number
  /** The vote count (an AnimatedNumber). */
  count: ReactNode
  /** "of 1.40M veMEZO", after the count at rest. */
  of: string
  /** "1.17M veMEZO to go", the line on hover, focus or tap. */
  toGo: string
  /** "7.07M veMEZO over" past optimal, in secondary text on hover, focus or tap. */
  over: string
  /** Shows the up arrow while picked. */
  rising?: boolean
}

/** The boost a gauge reaches with these votes: 1x plus 4x of the way to optimal. */
export function boostLabel(votes: number, optimal: number): string {
  if (optimal <= 0) return "1.0×"
  const ratio = Math.min(votes / optimal, 1)
  return `${(Math.round((1 + 4 * ratio) * 10) / 10).toFixed(1)}×`
}

/**
 * The right side: the boost only ("1.7×"), and "5×" from optimal on, however
 * far past it the gauge is (owner decision, 9 Nov: past optimal is not an
 * error, the gauge still pays 5×).
 */
export function bandBoost(votes: number, optimal: number): string {
  const ratio = optimal > 0 ? votes / optimal : 0
  if (ratio >= 1) return "5×"
  return boostLabel(votes, optimal)
}

// One line at a time: on hover, focus or tap the resting line rolls up and
// out while the other rolls up into its place, and back on leave.
const roll =
  "transition-[transform,opacity] duration-[220ms] ease-roll [grid-area:1/1]"
const showing =
  "group-hover/gauge:-translate-y-full group-hover/gauge:opacity-0 group-focus-within/gauge:-translate-y-full group-focus-within/gauge:opacity-0 group-data-[peek]/gauge:-translate-y-full group-data-[peek]/gauge:opacity-0"
const hidden =
  "translate-y-full opacity-0 group-hover/gauge:translate-y-0 group-hover/gauge:opacity-100 group-focus-within/gauge:translate-y-0 group-focus-within/gauge:opacity-100 group-data-[peek]/gauge:translate-y-0 group-data-[peek]/gauge:opacity-100"

export function Band({
  votes,
  optimal,
  count,
  of,
  toGo,
  over,
  rising = false,
}: BandProps): ReactNode {
  const ratio = optimal > 0 ? votes / optimal : 0
  const past = ratio > 1.0005
  const atMax = ratio >= 1
  const fill = Math.min(Math.max(ratio, 0), 1)
  return (
    <div className="relative flex h-12 flex-none items-center justify-between overflow-hidden bg-soft2 px-5 text-[14.5px] text-ink2 in-data-[gauge-view=compact]:hidden">
      <span
        aria-hidden="true"
        data-mbx-motion=""
        className="absolute inset-0 origin-left bg-band-acc transition-transform duration-[400ms] ease-roll"
        style={{ transform: `scaleX(${fill})` }}
      >
        <span
          data-mbx-motion=""
          className={`absolute inset-0 bg-band-pos transition-opacity duration-[400ms] ease-roll ${atMax ? "opacity-100" : "opacity-0"}`}
        />
      </span>
      <span className="relative grid h-6 min-w-0 items-center overflow-hidden">
        <span
          data-mbx-motion=""
          className={`flex items-center ${roll} ${showing}`}
        >
          <b className="font-[650] text-ink">{count}</b>
          {rising ? (
            <span
              aria-hidden="true"
              data-mbx-motion=""
              className="ml-0.5 inline-grid animate-[mbx-fade-in_200ms_ease-out] text-pos"
            >
              <Glyph shape={shapes.arrowUp} size={15} strokeWidth={2.6} />
            </span>
          ) : null}
          <span className="ml-1 truncate">{of}</span>
        </span>
        <span
          data-mbx-motion=""
          aria-hidden="true"
          className={`truncate font-[650] ${past ? "text-sec" : "text-ink"} ${roll} ${hidden}`}
        >
          {past ? over : atMax ? of : toGo}
        </span>
      </span>
      <span
        className={`relative flex-none font-[650] ${atMax ? "text-pos" : "text-ink"}`}
      >
        {bandBoost(votes, optimal)}
      </span>
    </div>
  )
}

Band.displayName = "GaugeCard.Band"

/** The band's place when there is no boost to show ("Lock expired"). */
