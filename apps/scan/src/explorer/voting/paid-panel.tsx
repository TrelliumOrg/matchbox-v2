import * as Inspect from "@matchbox/ui/inspect"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { RewardsView } from "../../data/scan/rewards"
import { Filling } from "../filling"
import {
  barLabel,
  Figure,
  Panel,
  PanelEmpty,
  PanelState,
  type StackedBarView,
  Stats,
  stackedReserve,
} from "./parts"

/**
 * Incentives and fees paid to voters each epoch, in USD at the epoch's
 * closing daily prices, stacked by token kind.
 */
export function PaidPanel({
  paid,
  label = "Paid to voters by epoch",
}: {
  paid: Section<RewardsView | null>
  label?: string
}): ReactNode {
  const data = paid.status === "ok" ? paid.data : null
  return (
    <Panel
      label={label}
      aside={
        data === null ? null : (
          <span className="text-[14px] text-sec">At epoch close</span>
        )
      }
    >
      {paid.status !== "ok" ? (
        <PanelState section={paid} />
      ) : data === null ? (
        <PanelEmpty>Nothing paid yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.figure}
            note={data.note}
            reserve={stackedReserve(data.bars)}
          />
          {data.filling === null ? null : (
            <Filling asOf={data.filling.asOf} className="mt-1" />
          )}
          <Stats stats={data.stats} />
          <StackedEpochBars
            bars={data.bars}
            series={data.series}
            label={label}
          />
        </>
      )}
    </Panel>
  )
}

// -- stacked epoch bars (here, not in parts: only these pages draw them) --

const stackTones = {
  mezo: "bg-mezo",
  ink: "bg-ink",
  acc: "bg-acc",
} as const

/**
 * Epoch bars split into series (tokens, or fees and incentives), bottom
 * first, with a legend; each bar opens its epoch. An epoch still filling
 * (the one running, or a closed one whose payouts are not in yet) is drawn
 * lighter, as so far, and its legend swatch so. Hover, a touch or focus
 * reads the epoch's total and its parts into the panel's figure.
 */
export function StackedEpochBars({
  bars,
  series,
  label,
  height = 140,
}: {
  bars: readonly StackedBarView[]
  series: readonly { label: string; tone: keyof typeof stackTones }[]
  label: string
  height?: number
}): ReactNode {
  Inspect.useInspect(bars.length > 0)
  if (bars.length === 0) return null
  const max = Math.max(...bars.map((bar) => bar.value), 0) || 1
  // The legend names only the series some bar holds.
  const shown = series.filter((_, part) =>
    bars.some((bar) => (bar.parts[part] ?? 0) > 0),
  )
  const first = bars[0]
  const last = bars.at(-1)
  const filling = bars.filter((bar) => bar.current).map((bar) => bar.epoch)
  return (
    <figure className="mt-6 flex flex-col gap-2">
      <ul
        aria-label={label}
        className="flex items-end gap-[3px]"
        style={{ height }}
        {...Inspect.root("x", "figure", true)}
      >
        {bars.map((bar) => {
          const partial = bar.current
          return (
            <li
              key={bar.epoch}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <Link
                to="/epochs/$epoch"
                params={{ epoch: String(bar.epoch) }}
                aria-label={`Epoch ${bar.epoch}${partial ? " so far" : ""}, ${bar.text}: ${bar.detail}`}
                className={`flex w-full origin-bottom animate-[mbx-grow_420ms_var(--ease-roll)_backwards] flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${partial ? "opacity-55" : ""} ${bar.value <= 0 ? "bg-mut" : ""}`}
                data-mbx-motion=""
                {...Inspect.point(
                  { label: barLabel(bar, partial), value: bar.text },
                  bar.value,
                  { partial },
                )}
                style={{
                  height: `${Math.max(2, (bar.value / max) * 100)}%`,
                }}
              >
                {series.map((each, part) => {
                  const value = bar.parts[part] ?? 0
                  return value <= 0 || bar.value <= 0 ? null : (
                    <span
                      key={each.label}
                      className={`block w-full flex-none ${stackTones[each.tone]}`}
                      style={{ height: `${(value / bar.value) * 100}%` }}
                    />
                  )
                })}
              </Link>
            </li>
          )
        })}
      </ul>
      <figcaption
        aria-hidden="true"
        className="flex justify-between font-mono text-xs text-sec"
      >
        <span>Epoch {first?.epoch}</span>
        <span>Epoch {last?.epoch}</span>
      </figcaption>
      <p
        aria-hidden="true"
        className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-sec"
      >
        {shown.map((each) => (
          <span key={each.label} className="flex items-center gap-2">
            <span
              className={`size-2.5 flex-none rounded-[2px] ${stackTones[each.tone]}`}
            />
            {each.label}
          </span>
        ))}
        {filling.length > 0 ? (
          <span className="flex items-center gap-2">
            <span
              className={`size-2.5 flex-none rounded-[2px] opacity-55 ${shown[0] === undefined ? "bg-mut" : stackTones[shown[0].tone]}`}
            />
            {soFarText(filling)}
          </span>
        ) : null}
      </p>
    </figure>
  )
}

/** "Epoch 48 so far", "Epochs 47 and 48 so far". */
function soFarText(epochs: readonly number[]): string {
  const [one, ...rest] = epochs
  if (rest.length === 0) return `Epoch ${one} so far`
  const last = rest.at(-1)
  return rest.length === 1
    ? `Epochs ${one} and ${last} so far`
    : `Epochs ${one} to ${last} so far`
}

// The governance panels travel in this chunk: one lazy chunk for every
// voting panel loaded after first paint, so no page's preload map grows.
export {
  EpochFigurePanel,
  LockDistributionPanels,
} from "./governance-panels"
