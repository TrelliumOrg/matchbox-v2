import { epochStartForIndex } from "@matchbox/domain/epoch"
import { formatUsd } from "@matchbox/domain/format"
import * as Inspect from "@matchbox/ui/inspect"
import { Link, useSearch } from "@tanstack/react-router"
import type { ReactNode } from "react"
import {
  barsSince,
  type RewardBar,
  type RewardCoin,
  rewardCoins,
  type WalletView,
} from "../../data/wallet-views"
import { CustomPeriod } from "../voting/custom-period"
import { Figure, Panel, PanelEmpty, reserveOf } from "../voting/parts"
import { type PeriodView, type Span, spanOf } from "../voting/range"
import { isDay, spanText } from "../voting/span-text"
import { type RewardsRange, rewardsRanges } from "./rewards-range"

/**
 * Rewards by epoch (`eSwId--0MF`, `ap-rewards`): what the wallet claimed
 * for each epoch's votes, stacked by coin at the USD the API recorded,
 * then the current epoch's projected rewards as an outline. The period is
 * All, 90d or 30d (`?range=`, All by default as in the design), or a
 * custom span (`?from=&to=`: the epochs it touches). Hovering,
 * a touch or focus on an epoch reads its total into the figure.
 */

/** Epochs each period shows, the current one included. */
const rangeEpochs: Record<RewardsRange, number | null> = {
  All: null,
  "90d": 13,
  "30d": 5,
}

const coinTone: Record<RewardCoin, string> = {
  MEZO: "bg-mezo",
  MUSD: "bg-ink",
  BTC: "bg-acc",
  Other: "bg-mut",
}

/** Gridlines at a round step, about three above zero, the top one over the tallest bar. */
export function ticks(maxCents: number): number[] {
  if (maxCents <= 0) return [0]
  const rough = maxCents / 3
  const power = 10 ** Math.floor(Math.log10(rough))
  const step =
    [1, 2, 2.5, 5, 10]
      .map((each) => each * power)
      .find((each) => each >= rough) ?? power * 10
  const out = [0]
  while ((out.at(-1) ?? 0) < maxCents) out.push(out.length * step)
  return out
}

function tickText(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${dollars / 1_000_000}M`
  if (dollars >= 1_000) return `$${dollars / 1_000}k`
  return `$${dollars}`
}

function Bar({ bar, scale }: { bar: RewardBar; scale: number }): ReactNode {
  const height = `${Math.max(bar.cents > 0 ? 1.5 : 0, (bar.cents / scale) * 100)}%`
  const label = bar.projected
    ? `Epoch ${bar.epoch}, projected ${bar.text}`
    : `Epoch ${bar.epoch}, ${bar.text}`
  return (
    <li className="flex h-full min-w-0 flex-1 items-end justify-center">
      <Link
        to="/epochs/$epoch"
        params={{ epoch: String(bar.epoch) }}
        aria-label={label}
        className="flex h-full w-full max-w-12 flex-col justify-end outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
        {...Inspect.point(
          {
            label: bar.projected
              ? `Epoch ${bar.epoch} projected`
              : `Epoch ${bar.epoch}`,
            value: bar.text,
          },
          bar.cents,
          { partial: bar.projected },
        )}
      >
        {bar.projected ? (
          <span
            className="block w-full rounded-[4px] border-[1.5px] border-dashed border-mut bg-bg"
            style={{ height }}
          />
        ) : (
          <span
            className="flex w-full origin-bottom animate-[mbx-grow_420ms_var(--ease-roll)_backwards] flex-col-reverse overflow-hidden rounded-t-[4px]"
            data-mbx-motion=""
            style={{ height }}
          >
            {bar.parts.map((part) => (
              <span
                key={part.coin}
                className={`block w-full ${coinTone[part.coin]}`}
                style={{ height: `${(part.cents / bar.cents) * 100}%` }}
              />
            ))}
          </span>
        )}
      </Link>
    </li>
  )
}

export function RewardsChart({
  bars,
  height = 200,
}: {
  bars: readonly RewardBar[]
  height?: number
}): ReactNode {
  Inspect.useInspect(bars.length > 0)
  if (bars.length === 0) return null
  const max = Math.max(...bars.map((bar) => bar.cents), 0)
  const lines = ticks(max)
  const scale = lines.at(-1) || 1
  const coins = rewardCoins.filter((coin) =>
    bars.some((bar) =>
      bar.parts.some((part) => part.coin === coin && !bar.projected),
    ),
  )
  const projected = bars.some((bar) => bar.projected)
  return (
    <figure className="mt-4 flex flex-col gap-2">
      <ul
        aria-label="Legend"
        className="flex flex-wrap gap-x-[18px] gap-y-1 text-[14px] text-sec"
      >
        {coins.map((coin) => (
          <li key={coin} className="flex items-center gap-[7px]">
            <i className={`size-2.5 rounded-[3px] ${coinTone[coin]}`} />
            {coin}
          </li>
        ))}
        {projected ? (
          <li className="flex items-center gap-[7px]">
            <i className="size-2.5 rounded-[3px] border-[1.5px] border-mut bg-bg" />
            Projected
          </li>
        ) : null}
      </ul>
      <div className="mt-3 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <ol
          aria-hidden="true"
          className="relative font-mono text-[11.5px] text-mut"
          style={{ height }}
        >
          {lines.map((value) => (
            <li
              key={value}
              className="absolute right-0 translate-y-1/2 whitespace-nowrap"
              style={{ bottom: `${(value / scale) * 100}%` }}
            >
              {tickText(value)}
            </li>
          ))}
        </ol>
        <div className="relative" style={{ height }}>
          {lines.map((value) => (
            <span
              key={value}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-line"
              style={{ bottom: `${(value / scale) * 100}%` }}
            />
          ))}
          <ul
            aria-label="Rewards by epoch"
            className="relative flex h-full items-end gap-[6px]"
            {...Inspect.root("x", "figure", false)}
          >
            {bars.map((bar) => (
              <Bar key={bar.epoch} bar={bar} scale={scale} />
            ))}
          </ul>
        </div>
        <span aria-hidden="true" />
        <figcaption
          aria-hidden="true"
          className="flex justify-between font-mono text-xs text-sec"
        >
          <span>Epoch {bars[0]?.epoch}</span>
          <span>Epoch {bars.at(-1)?.epoch}</span>
        </figcaption>
      </div>
    </figure>
  )
}

const dayOf = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

/** An epoch's first and last days. */
function epochDays(epoch: number): { first: string; last: string } {
  return {
    first: dayOf(epochStartForIndex(epoch)),
    last: dayOf(epochStartForIndex(epoch + 1) - 86_400),
  }
}

/**
 * The period's bars and its toggle's view: a range's last epochs, or the
 * epochs a custom span touches (its days put in order and kept between
 * the first epoch's start and the current epoch's end).
 */
export function rewardsPeriod(
  all: readonly RewardBar[],
  current: number,
  range: RewardsRange,
  span: Span | undefined,
): { bars: RewardBar[]; view: PeriodView } {
  const min = epochDays(Math.min(all[0]?.epoch ?? current, current)).first
  const max = epochDays(current).last
  if (span !== undefined && isDay(span.from) && isDay(span.to)) {
    const within = (day: string) => (day < min ? min : day > max ? max : day)
    const [low, high] =
      span.from <= span.to ? [span.from, span.to] : [span.to, span.from]
    const from = within(low)
    const to = within(high)
    return {
      bars: all.filter((bar) => {
        const days = epochDays(bar.epoch)
        return days.last >= from && days.first <= to
      }),
      view: { range: null, from, to, min, max, text: spanText(from, to, max) },
    }
  }
  const bars = barsSince(all, current, rangeEpochs[range])
  const from = epochDays(bars[0]?.epoch ?? current).first
  return { bars, view: { range, from, to: max, min, max, text: range } }
}

/** The period toggle: links that keep the page and change `range`. */
function RangeLinks({ period }: { period: PeriodView }): ReactNode {
  return (
    <nav
      aria-label="Rewards period"
      className="flex items-center gap-3 text-[14px]"
    >
      {rewardsRanges.map((range) => (
        <Link
          key={range}
          to="."
          search={(prev: Record<string, unknown>) => ({
            ...prev,
            range: range === "All" ? undefined : range,
            from: undefined,
            to: undefined,
          })}
          resetScroll={false}
          activeOptions={{ exact: true, includeSearch: true }}
          activeProps={{}}
          aria-current={range === period.range ? "true" : undefined}
          className="rounded-sm text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&[aria-current]]:font-semibold [&[aria-current]]:text-ink"
        >
          {range}
        </Link>
      ))}
      <CustomPeriod period={period} search={{}} />
    </nav>
  )
}

/** The panel: total and epochs claimed in the period, projected, chart. */
export function RewardsPanel({
  wallet,
  range,
  current,
}: {
  wallet: WalletView
  range: RewardsRange
  current: number
}): ReactNode {
  const span = spanOf(useSearch({ strict: false }))
  const { bars, view } = rewardsPeriod(wallet.bars, current, range, span)
  const claimed = bars.filter((bar) => !bar.projected && bar.cents > 0)
  const total = claimed.reduce((sum, bar) => sum + BigInt(bar.cents), 0n)
  const totalText = formatUsd(
    `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`,
    "cents",
  )
  const reserve = reserveOf(
    bars.map((bar) => ({
      label: bar.projected
        ? `Epoch ${bar.epoch} projected`
        : `Epoch ${bar.epoch}`,
      text: bar.text,
    })),
    false,
  )
  return (
    <Panel
      label="Rewards by epoch"
      aside={<RangeLinks period={view} />}
      className="mt-12 min-h-[420px]"
    >
      {bars.length === 0 ? (
        <PanelEmpty>No rewards claimed</PanelEmpty>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <Figure
              value={totalText}
              note={
                claimed.length === 1 ? "1 epoch" : `${claimed.length} epochs`
              }
              reserve={reserve}
            />
            {wallet.projected === null ? null : (
              <p className="text-[14.5px] text-sec">
                Projected{" "}
                <span className="font-semibold text-ink tabular-nums">
                  {wallet.projected.usd}
                </span>
              </p>
            )}
          </div>
          <RewardsChart bars={bars} />
        </>
      )}
    </Panel>
  )
}
