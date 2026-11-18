import * as Inspect from "@matchbox/ui/inspect"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { BlockDays } from "../../data/scan/block-days"
import type { BlockTimes } from "../../data/scan/block-times"
import { slowAfter } from "../../data/scan/block-times"
import { type BlockWindow, blockWindows } from "../../data/scan/block-window"
import { Figure, Panel, Stats, type StatView } from "../voting/parts"

/**
 * Blocks' "Block time" panel (`YY3BAmH_lR`), over the page's blocks (from
 * their timestamps: average, slowest, fastest and a bar per block), the
 * span between the last two daily head reads (named by its length), or
 * every span of the last
 * 30 days (blocks over the real seconds between the reads' head blocks,
 * block-days; each figure says the span it covers). The period is a
 * search param (`?window=24h|30d`). Online validators and missed proposals have no
 * source yet and are left out. Hovering, touching or focusing a bar shows
 * its time in the figure, the arrow keys move between bars.
 */

type Bar = {
  key: string
  label: string
  text: string
  size: number
  slow: boolean
}

const windowNames: Record<
  BlockWindow,
  (counted: number, days: BlockDays | null) => string
> = {
  blocks: (counted) => `${counted} ${counted === 1 ? "block" : "blocks"}`,
  // The last span by what it really is: "Last day", or "Last 47.9h"
  // after a missed read.
  "24h": (_counted, days) => days?.latest.name ?? "Last day",
  "30d": () => "30 days",
}

function WindowLinks({
  value,
  counted,
  days,
}: {
  value: BlockWindow
  counted: number
  days: BlockDays | null
}): ReactNode {
  return (
    <nav aria-label="Block time period" className="flex gap-3 text-[14px]">
      {blockWindows
        .filter((window) => window === "blocks" || days !== null)
        .map((window) => (
          <Link
            key={window}
            to="/network/blocks"
            search={window === "blocks" ? {} : { window }}
            resetScroll={false}
            activeOptions={{ exact: true, includeSearch: true }}
            activeProps={{}}
            aria-current={window === value ? "true" : undefined}
            className="rounded-sm text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&[aria-current]]:font-semibold [&[aria-current]]:text-ink"
          >
            {windowNames[window](counted, days)}
          </Link>
        ))}
    </nav>
  )
}

export function BlockTimePanel({
  times,
  days,
  window,
}: {
  times: BlockTimes | null
  days: BlockDays | null
  window: BlockWindow
}): ReactNode {
  const shown: BlockWindow =
    days === null
      ? "blocks"
      : times === null && window === "blocks"
        ? "24h"
        : window
  const bars: Bar[] =
    shown === "blocks"
      ? (times?.bars ?? []).map((bar) => ({
          key: String(bar.height),
          label: `Block ${bar.height}`,
          text: `${bar.seconds}s`,
          size: bar.seconds,
          slow: bar.slow,
        }))
      : (days?.bars ?? []).map((bar) => ({
          key: bar.day,
          label: bar.label,
          text: bar.text,
          size: bar.tenths,
          slow: bar.slow,
        }))
  Inspect.useInspect(bars.length > 0)
  if (times === null && days === null) return null
  const most = Math.max(...bars.map((bar) => bar.size), 1)
  const daysText = (value: string) =>
    value === "1" ? "1 day" : `${value} days`
  const figure =
    shown === "blocks"
      ? { value: times?.average ?? "", note: "average" }
      : shown === "24h"
        ? {
            value: days?.latest.average ?? "",
            note: `average, ${days?.latest.hours}h, ${days?.latest.label}`,
          }
        : {
            value: days?.span.average ?? "",
            note: `average, ${daysText(days?.span.days ?? "")}`,
          }
  const stats: StatView[] = [
    ...(shown === "blocks" && times !== null
      ? [
          {
            label: `Slowest ${times.slowest.height}`,
            value: times.slowest.took,
          },
          {
            label: `Fastest ${times.fastest.height}`,
            value: times.fastest.took,
          },
        ]
      : []),
    ...(days === null
      ? []
      : [
          {
            label: `Blocks, ${days.latest.hours}h`,
            value: days.latest.blocks,
          },
          ...(shown === "blocks"
            ? []
            : [
                {
                  label: `Blocks, ${daysText(days.span.days)}`,
                  value: days.span.blocks,
                },
                shown === "24h"
                  ? {
                      label: `${days.span.days}-day average`,
                      value: days.span.average,
                    }
                  : {
                      label: `${days.latest.hours}h average`,
                      value: days.latest.average,
                    },
              ]),
        ]),
  ]
  const unit = shown === "blocks" ? "blocks" : "days"
  return (
    <Panel
      label="Block time"
      aside={
        <WindowLinks value={shown} counted={times?.counted ?? 0} days={days} />
      }
      className="mt-8"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <Figure
            value={figure.value}
            note={figure.note}
            reserve={{
              value: Inspect.widest([
                figure.value,
                ...bars.map((bar) => bar.text),
              ]),
              note: Inspect.widest([
                figure.note,
                Inspect.noteReserve(bars, false),
              ]),
            }}
          />
          <Stats stats={stats} />
        </div>
        <figure className="flex min-w-0 flex-col justify-end">
          <div
            role="img"
            aria-label={`Block times, ${bars.length} ${unit}, average ${figure.value}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys read each bar's time
            tabIndex={0}
            className="flex h-24 items-end gap-px rounded-[2px] border-b border-line outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            {...Inspect.root("x", "figure", false)}
          >
            {bars.map((bar) => (
              <span
                key={bar.key}
                className={`min-w-px flex-1 rounded-t-[1px] ${shown === "blocks" ? "" : "max-w-6"} ${bar.slow ? "bg-acc" : "bg-ink/25"}`}
                {...Inspect.point({ label: bar.label, value: bar.text })}
                style={{
                  height: `${Math.max(4, (bar.size / most) * 100)}%`,
                }}
              />
            ))}
          </div>
          <figcaption className="mt-2 flex flex-wrap gap-x-4 text-[14px] text-sec">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px] bg-ink/25" />
              {shown === "blocks" ? "Block time" : "Block time by day"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px] bg-acc" />
              Over {slowAfter}s
            </span>
          </figcaption>
        </figure>
      </div>
    </Panel>
  )
}
