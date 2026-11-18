import * as DocFigure from "@matchbox/ui/doc-figure"
import type { ReactNode } from "react"

/**
 * Schematic drawings for `::figure`: the layout of a Pro screen in its own
 * labels, never invented figures. The numbered markers match the steps
 * on the same page.
 */

function Box({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}): ReactNode {
  return (
    <div className={`rounded-[14px] bg-bg p-2.5 ${className ?? ""}`}>
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
      className={`block truncate text-[12px] leading-6 ${strong ? "font-semibold text-ink2" : "text-sec"}`}
    >
      {children}
    </span>
  )
}

function Vote(): ReactNode {
  return (
    <div className="relative grid grid-cols-[30%_1fr_28%] gap-3 p-5 max-sm:gap-2 max-sm:p-3">
      <Box>
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
        <div className="grid grid-cols-2 gap-2">
          <span className="block overflow-hidden rounded-[10px] bg-bg">
            <span className="block h-5 bg-mezo" />
            <span className="block px-2">
              <Line strong>veMEZO lock</Line>
            </span>
          </span>
          <span className="block overflow-hidden rounded-[10px] bg-bg">
            <span className="block h-5 bg-mezo" />
            <span className="block px-2">
              <Line strong>veMEZO lock</Line>
            </span>
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {["Gauge", "Gauge", "Gauge", "Gauge"].map((label, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing
              key={index}
              className={`block rounded-[10px] bg-bg px-2 py-1 ${index === 0 ? "shadow-[inset_0_0_0_1.5px_var(--acc)]" : ""}`}
            >
              <Line strong>{label}</Line>
              <span className="mt-1 block h-1.5 rounded-full bg-soft2" />
            </span>
          ))}
        </div>
      </div>
      <Box className="overflow-hidden p-0">
        <span className="block bg-mezo px-2.5">
          <span className="block truncate text-[12px] leading-6 font-semibold text-on-mezo">
            Ballot
          </span>
        </span>
        <span className="block p-2.5">
          <Line>Projected</Line>
          <Line strong>Gauge, 100%</Line>
          <span className="mt-1 block rounded-full bg-soft px-2">
            <Line strong>Optimize</Line>
          </span>
          <span className="mt-1.5 block rounded-full bg-acc px-2 text-center">
            <span className="block truncate text-[12px] leading-6 font-semibold text-on-acc">
              Review and sign
            </span>
          </span>
        </span>
      </Box>
      <DocFigure.Marker number={1} x={3} y={9} />
      <DocFigure.Marker number={2} x={33.5} y={27} />
      <DocFigure.Marker number={3} x={33.5} y={56} />
      <DocFigure.Marker number={4} x={70.5} y={38} />
      <DocFigure.Marker number={5} x={70.5} y={84} />
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
