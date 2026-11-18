import { TokenIcon } from "@matchbox/token-icons"
import { BarChart } from "@matchbox/ui/chart"
import * as CoinStack from "@matchbox/ui/coin-stack"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import * as PropertyIcon from "@matchbox/ui/property-icon"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CoinMarks } from "../../components/coins"
import { loadProApi } from "../../data/queries"
import type { Protocol, ProtocolEvent } from "../../data/view-models"
import { formatAgo, formatUsd } from "../../lib/format"
import { useIsPhone } from "../../lib/phone"
import { SectionHeading, underlineLink } from "../../shell/page"
import { usdToMicro } from "../vote/ballot"
import {
  canShift,
  type EpochWindow,
  shiftWindow,
  windowFor,
  windowLabel,
  windowSizes,
} from "./epoch-window"
import {
  categoryFor,
  countLine,
  type EventFilter,
  eventFilters,
  type Feed,
  firstCursor,
  mergeById,
  parseEventFilter,
  shown,
} from "./protocol-feed"

/** Rows read after the painted ones, for one view (feed and filter). */
type Later = {
  key: string
  events: ProtocolEvent[]
  /** Where the next page starts; null once the last page was read. */
  cursor: string | null
  /** False until a page was read: then `cursor` is the painted rows'. */
  read: boolean
}

/** The protocol document's own rows: a full page means there may be more. */
const paintedRows = 20

/** Protocol below the fold: incentives by epoch, funded gauges, live activity. */

type Series = "all" | "vebtc" | "validators" | "pools"

const seriesLabels: Record<Series, string> = {
  all: "All",
  vebtc: "veBTC",
  validators: "Validators",
  pools: "Pools",
}

const actionLabels: Record<
  ProtocolEvent["action"],
  { label: string; icon: GlyphShape }
> = {
  "lock-create": { label: "Locked", icon: shapes.lock },
  "lock-add": { label: "Added to lock", icon: shapes.plus },
  "lock-extend": { label: "Extended lock", icon: shapes.clock },
  "lock-merge": { label: "Merged locks", icon: shapes.lock },
  "lock-withdraw": { label: "Withdrew", icon: shapes.arrowUpRight },
  vote: { label: "Voted", icon: shapes.vote },
  incentive: { label: "Added incentives", icon: shapes.plus },
  boost: { label: "Boosted", icon: shapes.arrowUp },
  claim: { label: "Claimed rewards", icon: shapes.gift },
  "boost-refresh": { label: "Boost refresh", icon: shapes.rotateCw },
}

/** Whole cents as a number, for bar heights only. */
function centsForChart(usd: string): number {
  return Number(usdToMicro(usd) / 10_000n)
}

function csv(events: readonly ProtocolEvent[], now: number): string {
  const rows = events.map((event) =>
    [
      actionLabels[event.action].label,
      event.actor.label,
      event.amount,
      event.where.label,
      `${formatAgo(now - event.at)} ago`,
    ]
      .map((cell) => `"${cell.replaceAll('"', '""')}"`)
      .join(","),
  )
  return ["Action,Actor,Amount,Where,Time", ...rows].join("\n")
}

function exportCsv(
  events: readonly ProtocolEvent[],
  now: number,
  epoch: number,
): void {
  const url = URL.createObjectURL(
    new Blob([csv(events, now)], { type: "text/csv" }),
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `matchbox-epoch-${epoch}-activity.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export function ProtocolDetails({
  data,
  now,
  onEpoch,
}: {
  data: Protocol
  now: number
  onEpoch: (epoch: number) => void
}): ReactNode {
  const [series, setSeries] = useState<Series>("all")
  const [feed, setFeed] = useState<Feed>("activity")
  const [filter, setFilter] = useState<EventFilter>("all")
  const [stored, setStored] = useState<Later | null>(null)
  const [loading, setLoading] = useState<"idle" | "loading" | "failed">("idle")
  const bars = data.incentivesByEpoch.map((entry) => ({
    label: `Epoch ${entry.epoch}`,
    value: centsForChart(entry[series]),
    text: formatUsd(entry[series], "whole"),
  }))
  // Pages after the painted rows, for this view only. A new view starts
  // from the painted rows again.
  const key = `${feed}:${filter}`
  const later: Later =
    stored !== null && stored.key === key
      ? stored
      : {
          key,
          events: [],
          cursor: firstCursor(data.events, feed, filter),
          read: false,
        }
  const events = shown(mergeById(data.events, later.events), feed, filter)
  // Before a page was read: more when the document was full or the epoch
  // counts more events than it holds. After: what the API said.
  const hasMore = later.read
    ? later.cursor !== null
    : data.events.length >= paintedRows || data.eventsTotal > data.events.length
  // The total counts this epoch's events; early in an epoch the latest
  // rows reach back before it, and "20 of 3" would be nonsense.
  const ofTotal =
    feed === "activity" && filter === "all" && data.eventsTotal >= events.length

  async function more(): Promise<void> {
    setLoading("loading")
    try {
      const page = await (await loadProApi()).getProtocolActivity({
        data: { category: categoryFor(feed, filter), cursor: later.cursor },
      })
      setStored({
        key,
        events: mergeById(later.events, page.events),
        cursor: page.nextCursor,
        read: true,
      })
      setLoading("idle")
    } catch {
      setLoading("failed")
    }
  }

  return (
    <>
      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-2xl font-[650] tracking-[-0.015em]">
            Incentives by epoch
          </h2>
          <SegmentedControl.Root
            aria-label="Gauge type"
            size="sm"
            value={series}
            onValueChange={(value) => {
              if (
                value === "all" ||
                value === "vebtc" ||
                value === "validators" ||
                value === "pools"
              ) {
                setSeries(value)
              }
            }}
          >
            {(Object.keys(seriesLabels) as Series[]).map((key) => (
              <SegmentedControl.Item key={key} value={key}>
                {seriesLabels[key]}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </div>
        <EpochChart data={data} series={series} bars={bars} onEpoch={onEpoch} />
      </section>

      <section className="mt-12">
        <SectionHeading
          action={
            <Link
              to="/vote"
              search={{ tab: "funded" }}
              className={underlineLink}
            >
              See all {data.fundedTotal}
            </Link>
          }
        >
          Funded this epoch
        </SectionHeading>
        <ListRow.List className="mt-3">
          {data.funded.map((entry) => (
            <ListRow.Root key={entry.id}>
              {entry.picture.kind === "pair" ? (
                <span
                  className="relative block size-12 flex-none"
                  aria-hidden="true"
                >
                  <span className="absolute top-0 left-0 block">
                    <TokenIcon
                      ticker={entry.picture.tokens[0] ?? "BTC"}
                      size={30}
                    />
                  </span>
                  <span className="absolute right-0 bottom-0 block rounded-full shadow-[0_0_0_2px_var(--bg)]">
                    <TokenIcon
                      ticker={entry.picture.tokens[1] ?? "MUSD"}
                      size={30}
                    />
                  </span>
                </span>
              ) : (
                <GaugeCard.Picture picture={entry.picture} size={48} />
              )}
              <ListRow.Text>
                <ListRow.Title>
                  {entry.gauge === null ? (
                    entry.name
                  ) : (
                    <Link
                      to="/gauges/$address"
                      params={{ address: entry.gauge }}
                      className="rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      {entry.name}
                    </Link>
                  )}
                </ListRow.Title>
                <ListRow.Subline>
                  {entry.kind === "pool" ? (
                    <PropertyIcon.Root
                      name="pool-gauge"
                      label={entry.subline}
                      size={16}
                    />
                  ) : (
                    entry.subline
                  )}
                </ListRow.Subline>
              </ListRow.Text>
              <ListRow.Value>
                <ListRow.Main>{formatUsd(entry.usd, "cents")}</ListRow.Main>
                <ListRow.Sub className="flex items-center justify-end gap-1.5">
                  <CoinMarks symbols={entry.tokens} />
                  {entry.deposits === null
                    ? null
                    : `${entry.deposits} ${entry.deposits === 1 ? "deposit" : "deposits"}`}
                </ListRow.Sub>
              </ListRow.Value>
            </ListRow.Root>
          ))}
        </ListRow.List>
      </section>

      {/* Live activity belongs to the current epoch only. */}
      <section className="mt-12" hidden={data.epoch !== data.latestEpoch}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-2xl font-[650] tracking-[-0.015em]">
            Live activity
          </h2>
          <SegmentedControl.Root
            aria-label="Activity source"
            size="sm"
            value={feed}
            onValueChange={(value) => {
              if (value === "activity" || value === "system") {
                setFeed(value)
                setLoading("idle")
              }
            }}
          >
            <SegmentedControl.Item value="activity">
              Activity
            </SegmentedControl.Item>
            <SegmentedControl.Item value="system">System</SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>
        <div className="mt-5 flex items-center justify-between gap-4">
          {feed === "system" ? (
            <span />
          ) : (
            <label className="flex h-11 items-center rounded-full bg-soft pr-3 pl-1 focus-within:outline-2 focus-within:outline-ink">
              <span className="sr-only">Events</span>
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(parseEventFilter(event.target.value))
                  setLoading("idle")
                }}
                className="h-11 cursor-pointer rounded-full bg-transparent pr-1 pl-3 text-[15px] font-medium text-ink2 outline-none"
              >
                {eventFilters.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => exportCsv(events, now, data.epoch)}
            className={`cursor-pointer ${underlineLink}`}
          >
            Export CSV
          </button>
        </div>
        <table className="mt-3 w-full border-collapse text-left text-[15px] tabular-nums">
          <thead>
            <tr className="border-b border-line text-[14.5px] text-sec">
              <th scope="col" className="pb-3 font-normal">
                Action
              </th>
              <th scope="col" className="pb-3 font-normal max-md:hidden">
                Amount
              </th>
              <th scope="col" className="pb-3 font-normal max-lg:hidden">
                Where
              </th>
              <th scope="col" className="pb-3 text-right font-normal">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const action = actionLabels[event.action]
              return (
                <tr key={event.id}>
                  <td className="py-3">
                    <span className="flex items-center gap-3.5">
                      <span
                        className={`grid size-11 flex-none place-items-center rounded-full ${event.actor.kind === "system" ? "border border-dashed border-dash" : "bg-soft"}`}
                      >
                        <Glyph
                          shape={action.icon}
                          size={18}
                          strokeWidth={1.8}
                        />
                      </span>
                      <span>
                        <span className="block font-semibold">
                          {action.label}
                        </span>
                        <span className="flex items-center gap-1.5 text-[13.5px] text-sec">
                          {event.actor.kind === "vemezo" ||
                          event.actor.kind === "vebtc" ? (
                            <TokenIcon
                              ticker={
                                event.actor.kind === "vebtc" ? "BTC" : "MEZO"
                              }
                              size={14}
                            />
                          ) : null}
                          {event.actor.label}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="py-3 font-semibold max-md:hidden">
                    <span className="flex items-center gap-2">
                      {event.amountTokens.length === 0 ? null : (
                        <CoinStack.Root
                          coins={event.amountTokens.map((ticker) => ({
                            ticker,
                          }))}
                          size={18}
                          decorative
                        />
                      )}
                      {event.amount}
                    </span>
                  </td>
                  <td className="py-3 max-lg:hidden">
                    {event.where.gauge === null ? (
                      <span className="text-sec">{event.where.label}</span>
                    ) : (
                      <span className="flex items-center gap-2.5">
                        <GaugeCard.Picture
                          picture={event.where.gauge.picture}
                          size={24}
                        />
                        {event.where.label}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right text-sec">
                    {formatAgo(now - event.at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {events.length === 0 ? (
          <p className="mt-6 text-[15px] text-sec">
            {hasMore ? "None in the latest events." : "None yet."}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-between gap-4 text-[15px] text-sec">
          <p role="status" data-feed-count="">
            {countLine(
              events.length,
              ofTotal ? data.eventsTotal : null,
              hasMore,
            )}
          </p>
          {hasMore ? (
            <button
              type="button"
              disabled={loading === "loading"}
              onClick={() => void more()}
              className={`cursor-pointer disabled:cursor-default disabled:opacity-60 ${underlineLink}`}
            >
              {loading === "loading"
                ? "Loading"
                : loading === "failed"
                  ? "Try again"
                  : "Load more"}
            </button>
          ) : null}
        </div>
      </section>
    </>
  )
}

/**
 * Incentives by epoch, a page at a time (decided 9 Nov): 12 epochs, 6 on
 * phones, the selected epoch's page by default. Arrows, PageUp and
 * PageDown and a swipe move the page; Left and Right move the selection,
 * across pages too. Only the selected bar carries its value; hovering,
 * touching or focusing any bar shows its epoch, value and change in a
 * tooltip (`@matchbox/ui/inspect`).
 */
/** The page of bars last shown (client only), so only a new page grows in. */
let shownPage: string | null = null

function EpochChart({
  data,
  series,
  bars,
  onEpoch,
}: {
  data: Protocol
  series: Series
  bars: readonly { label: string; value: number; text: string }[]
  onEpoch: (epoch: number) => void
}): ReactNode {
  const phone = useIsPhone()
  const size = phone ? windowSizes.phone : windowSizes.wide
  const epochs = data.incentivesByEpoch.map((entry) => entry.epoch)
  const count = epochs.length
  const selectedIndex = epochs.indexOf(data.epoch)
  const [page, setPage] = useState<EpochWindow>(() =>
    windowFor(selectedIndex, count, size),
  )
  // The page follows the selection (the URL) and the screen size.
  useEffect(() => {
    setPage(windowFor(selectedIndex, count, size))
  }, [selectedIndex, count, size])
  const refocus = useRef(false)
  const chart = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    chart.current
      ?.querySelector<HTMLElement>('fieldset button[tabindex="0"]')
      ?.focus()
  })
  const swipe = useRef<number | null>(null)

  const move = (pages: number, focus = false) => {
    if (!canShift(page, pages, count)) return
    refocus.current = focus
    setPage(shiftWindow(page, pages, count, size))
  }
  const selectAt = (index: number) => {
    const epoch = epochs[index]
    if (epoch === undefined || !data.browsableEpochs.includes(epoch)) return
    refocus.current = true
    onEpoch(epoch)
  }

  const visible = data.incentivesByEpoch.slice(page.start, page.end + 1)
  const selected =
    selectedIndex >= page.start && selectedIndex <= page.end
      ? selectedIndex - page.start
      : -1
  const current = data.incentivesByEpoch[selectedIndex]
  const pageKey = `${page.start}-${page.end}`
  // The first page grows when first seen; a new page grows as it mounts; the
  // same page after a remount (another epoch's route) morphs instead.
  const newPage = shownPage !== null && shownPage !== pageKey
  useEffect(() => {
    shownPage = pageKey
  }, [pageKey])
  const fade = "motion-safe:animate-[mbx-fade-in_240ms_ease-out_both]"

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: PageUp and PageDown bubble up from the bar buttons; the swipe is a touch shortcut for the page buttons
    <div
      ref={chart}
      className="touch-pan-y"
      onKeyDown={(event) => {
        if (event.key !== "PageUp" && event.key !== "PageDown") return
        event.preventDefault()
        move(event.key === "PageUp" ? -1 : 1, true)
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") swipe.current = event.clientX
      }}
      onPointerUp={(event) => {
        const from = swipe.current
        swipe.current = null
        if (from === null) return
        const dx = event.clientX - from
        // Swiping left shows later epochs, right earlier ones.
        if (Math.abs(dx) > 40) move(dx < 0 ? 1 : -1)
      }}
      onPointerCancel={() => {
        swipe.current = null
      }}
    >
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[14.5px] text-sec tabular-nums">
          {windowLabel(epochs, page)}
        </span>
        <div className="flex gap-1">
          <PageButton
            label="Earlier epochs"
            shape={shapes.chevronLeft}
            disabled={!canShift(page, -1, count)}
            onClick={() => move(-1)}
          />
          <PageButton
            label="Later epochs"
            shape={shapes.chevronRight}
            disabled={!canShift(page, 1, count)}
            onClick={() => move(1)}
          />
        </div>
      </div>
      <div
        key={`values-${pageKey}`}
        className={`mt-3 flex gap-1.5 text-[13.5px] tabular-nums ${fade}`}
      >
        {visible.map((entry, index) => (
          // Flex centring overflows both ways (text-align would spill
          // right); the edge labels stay inside the chart.
          <span
            key={entry.epoch}
            className="flex min-w-0 flex-1 justify-center whitespace-nowrap first:justify-start last:justify-end"
          >
            {index === selected ? (
              <b className="font-semibold text-ink">
                {formatUsd(entry[series], "whole")}
              </b>
            ) : null}
          </span>
        ))}
      </div>
      <BarChart
        key={`bars-${pageKey}`}
        className="mt-2"
        label={`Incentives by epoch, ${windowLabel(epochs, page)}${current === undefined ? "" : `, Epoch ${current.epoch} ${formatUsd(current[series], "whole")}`}`}
        bars={bars.slice(page.start, page.end + 1)}
        // The first bar of a page shows its change from the epoch before.
        before={bars[page.start - 1]?.value}
        selected={selected}
        id="protocol-incentives-by-epoch"
        growIn={newPage}
        {...(data.browsableEpochs.length > 1
          ? {
              onSelect: (index: number) => selectAt(page.start + index),
              onEdge: (direction: -1 | 1) => {
                const next = direction < 0 ? page.start - 1 : page.end + 1
                if (next >= 0 && next < count) selectAt(next)
              },
            }
          : {})}
        showLabels={false}
        height={190}
      />
      {/* The bars are the keyboard path; the numbers are pointer targets too. */}
      <div
        key={`numbers-${pageKey}`}
        aria-hidden="true"
        className={`mt-2.5 flex gap-1.5 text-[13px] text-sec tabular-nums ${fade}`}
      >
        {visible.map((entry, index) => (
          <button
            key={entry.epoch}
            type="button"
            tabIndex={-1}
            disabled={!data.browsableEpochs.includes(entry.epoch)}
            onClick={() => onEpoch(entry.epoch)}
            className={`min-w-0 flex-1 cursor-pointer rounded-md text-center hover:text-ink disabled:cursor-default ${index === selected ? "font-semibold text-ink" : ""}`}
          >
            {entry.epoch}
          </button>
        ))}
      </div>
    </div>
  )
}

function PageButton({
  label,
  shape,
  disabled,
  onClick,
}: {
  label: string
  shape: GlyphShape
  disabled: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-tap=""
      className="grid size-8 cursor-pointer place-items-center rounded-full bg-soft text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-default disabled:bg-transparent disabled:text-mut"
    >
      <Glyph shape={shape} size={16} />
    </button>
  )
}
