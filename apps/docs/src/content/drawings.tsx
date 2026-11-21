import * as DocFigure from "@matchbox/ui/doc-figure"
import type { ReactNode } from "react"

/**
 * Schematic drawings for `::figure`: the layout of a Pro screen in its own
 * labels, never invented figures. The numbered markers match the steps
 * on the same page. A label is always whole (D3, 20 Nov 2026): on a phone
 * it wraps between words, the boxes pad less, and the Vote drawing shows
 * one lock and two gauges in one column, so every word fits, with its
 * markers on the elements they number.
 */

/** 24 tall on one line. On phones, 16 a line with 4 above and below. */
const labelClass = "block text-[12px] leading-6 max-sm:py-1 max-sm:leading-4"

function Box({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}): ReactNode {
  return (
    <div
      className={`rounded-[14px] bg-bg p-2.5 max-sm:p-1.5 ${className ?? ""}`}
    >
      {children}
    </div>
  )
}

function Line({
  strong = false,
  children,
}: {
  strong?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <span
      className={`${labelClass} ${strong ? "font-semibold text-ink2" : "text-sec"}`}
    >
      {children}
    </span>
  )
}

/**
 * A marker on phones only, placed on the element it numbers (its nearest
 * positioned ancestor), so it stays there whatever the labels wrap to.
 * Wider, the drawing's own markers sit on the whole card.
 */
function PhoneMarker({
  number,
  x,
  y,
}: {
  number: number
  x: number
  y: number
}): ReactNode {
  return (
    <span className="contents sm:hidden">
      <DocFigure.Marker number={number} x={x} y={y} />
    </span>
  )
}

function Vote(): ReactNode {
  return (
    <div className="relative grid grid-cols-[30%_1fr_28%] gap-3 p-5 max-sm:gap-1.5 max-sm:p-2">
      <Box className="relative">
        <PhoneMarker number={1} x={4} y={4} />
        <Line>Voted with veMEZO</Line>
        <span className="block rounded-[10px] bg-soft px-1.5">
          <Line strong>veBTC gauges</Line>
        </span>
        <Line strong>MEZO gauges</Line>
        <Line>Voted with veBTC</Line>
        <Line strong>Validator gauges</Line>
        <Line strong>Pool gauges</Line>
      </Box>
      <div className="min-w-0">
        <Line>Vote with</Line>
        <div className="relative grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <PhoneMarker number={2} x={0} y={23} />
          <span className="block overflow-hidden rounded-[10px] bg-bg">
            <span className="block h-5 bg-mezo" />
            <span className="block px-2">
              <Line strong>veMEZO lock</Line>
            </span>
          </span>
          <span className="block overflow-hidden rounded-[10px] bg-bg max-sm:hidden">
            <span className="block h-5 bg-mezo" />
            <span className="block px-2">
              <Line strong>veMEZO lock</Line>
            </span>
          </span>
        </div>
        <div className="relative mt-2 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <PhoneMarker number={3} x={0} y={0} />
          {["Gauge", "Gauge", "Gauge", "Gauge"].map((label, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing
              key={index}
              className={`block rounded-[10px] bg-bg px-2 py-1 ${index === 0 ? "shadow-[inset_0_0_0_1.5px_var(--acc)]" : ""} ${index > 1 ? "max-sm:hidden" : ""}`}
            >
              <Line strong>{label}</Line>
              <span className="mt-1 block h-1.5 rounded-full bg-soft2" />
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-[14px] bg-bg p-2.5 max-sm:p-0">
        <span className="block bg-mezo px-2.5 max-sm:rounded-t-[14px] max-sm:px-1.5">
          <span className={`${labelClass} font-semibold text-on-mezo`}>
            Ballot
          </span>
        </span>
        <span className="block p-2.5 max-sm:p-1.5">
          <Line>Projected</Line>
          <Line strong>Gauge, 100%</Line>
          <span className="relative mt-1 block rounded-full bg-soft px-2 max-sm:pr-1.5 max-sm:pl-3">
            <PhoneMarker number={4} x={0} y={50} />
            <Line strong>Optimize</Line>
          </span>
          <span className="relative mt-1.5 block rounded-full bg-acc px-2 text-center max-sm:rounded-xl max-sm:pr-1.5 max-sm:pl-3">
            <PhoneMarker number={5} x={0} y={50} />
            <span className={`${labelClass} font-semibold text-on-acc`}>
              Review and sign
            </span>
          </span>
        </span>
      </div>
      <span className="contents max-sm:hidden">
        <DocFigure.Marker number={1} x={3} y={9} />
        <DocFigure.Marker number={2} x={33.5} y={27} />
        <DocFigure.Marker number={3} x={33.5} y={56} />
        <DocFigure.Marker number={4} x={70.5} y={38} />
        <DocFigure.Marker number={5} x={70.5} y={84} />
      </span>
    </div>
  )
}

const drawings: Readonly<Record<string, () => ReactNode>> = {
  vote: Vote,
}

export function Drawing({ name }: { name: string }): ReactNode {
  const Picture = drawings[name]
  return Picture === undefined ? null : <Picture />
}
