import { shortAddress } from "@matchbox/domain/format"
import { TokenIcon } from "@matchbox/token-icons"
import * as Avatar from "@matchbox/ui/avatar"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as Inspect from "@matchbox/ui/inspect"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Entity } from "../../data/explorer"
import type {
  GaugeIdentity,
  GaugeKind,
  GaugePictureView,
} from "../../data/scan/voting-views"
import { sectionStateText } from "../section-text"
import { type PeriodView, ranges } from "./range"

/**
 * Pieces the Voting and Locks pages share (matchbox-v3, Matchscan topic
 * pages): captioned panels (radius 24, label left, period toggle right,
 * one figure, up to four stats, one chart), gauge identities with their
 * type icon, epoch bars and the actions that point to Matchbox. Gauge
 * names are chain or profile supplied: untrusted text.
 *
 * The charts are inspectable (`@matchbox/ui/inspect`): hovering, touching
 * or focusing an epoch's bar or a gauge's row shows its value in the
 * panel's figure (in place, the latest back on leave) or a small tooltip.
 */

// -- gauge types --------------------------------------------------------------

export const kindNames: Record<GaugeKind, string> = {
  vebtc: "veBTC gauge",
  mezo: "MEZO gauge",
  validator: "Validator gauge",
  pool: "Pool gauge",
}

const kindShapes: Record<GaugeKind, GlyphShape> = {
  vebtc: shapes.lock,
  mezo: shapes.globe,
  validator: shapes.server,
  pool: shapes.droplets,
}

/** The gauge type as an icon with its name as the tooltip. */
export function KindIcon({
  kind,
  size = 17,
}: {
  kind: GaugeKind | null
  size?: number
}): ReactNode {
  if (kind === null) return null
  return (
    <span
      role="img"
      aria-label={kindNames[kind]}
      title={kindNames[kind]}
      className="inline-flex flex-none text-sec"
    >
      <Glyph shape={kindShapes[kind]} size={size} strokeWidth={1.75} />
    </span>
  )
}

export function GaugePicture({
  picture,
  size = 40,
  priority = false,
}: {
  picture: GaugePictureView
  size?: number
  /**
   * The page's own picture (a gauge's header): loaded and decoded at once,
   * so arriving from a list that already showed it draws it in the first
   * frame instead of a blank square.
   */
  priority?: boolean
}): ReactNode {
  if (picture.kind === "pair") {
    const coin = Math.round(size * 0.7)
    return (
      <span
        aria-hidden="true"
        className="relative flex flex-none items-center"
        style={{ width: size, height: size }}
      >
        <TokenIcon ticker={picture.tickers[0]} size={coin} />
        <TokenIcon
          ticker={picture.tickers[1]}
          size={coin}
          className="-ml-[40%] ring-2 ring-bg"
        />
      </span>
    )
  }
  if (picture.kind === "image") {
    return (
      <img
        src={picture.url}
        alt=""
        width={size}
        height={size}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : "auto"}
        // Profile images come from any https host the gauge's owner named:
        // they learn nothing of the page that shows them.
        referrerPolicy="no-referrer"
        className="block flex-none rounded-[30%] object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span aria-hidden="true" className="flex-none">
      <Avatar.Root initials={picture.initials} hue={picture.hue} size={size} />
    </span>
  )
}

/** A gauge's name (untrusted), else its short address. */
export function GaugeName({
  gauge,
  limit = 40,
}: {
  gauge: GaugeIdentity
  limit?: number
}): ReactNode {
  const name =
    gauge.name === null ? (
      <span className="font-mono">{shortAddress(gauge.address)}</span>
    ) : (
      <UntrustedText.Root value={gauge.name} limit={limit} />
    )
  // Pools that share a pair ("BTC/MUSD") differ by type: "BTC/MUSD CL200".
  if (gauge.poolLabel === null || gauge.name?.endsWith(` ${gauge.poolLabel}`)) {
    return name
  }
  // The pair gives way first: the type is what tells the pools apart.
  return (
    <span className="inline-flex max-w-full min-w-0 items-baseline gap-[0.3em] align-bottom">
      <span className="min-w-0 truncate">{name}</span>{" "}
      <span className="flex-none font-medium text-sec">{gauge.poolLabel}</span>
    </span>
  )
}

/** A gauge's name as plain text, for a chart's readout: "BTC/MUSD CL200". */
export function gaugeText(gauge: GaugeIdentity, limit = 40): string {
  const raw = gauge.name ?? shortAddress(gauge.address)
  const name = raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw
  if (gauge.poolLabel === null || gauge.name?.endsWith(` ${gauge.poolLabel}`))
    return name
  return `${name} ${gauge.poolLabel}`
}

const nameLink =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

/** Picture, linked name with its "#id", and the type icon. */
export function GaugeTitle({
  gauge,
  subline,
  size = 40,
}: {
  gauge: GaugeIdentity
  subline?: ReactNode
  size?: number
}): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <GaugePicture picture={gauge.picture} size={size} />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            to="/gauges/$gauge"
            params={{ gauge: gauge.address }}
            className={`truncate font-semibold ${nameLink}`}
          >
            <GaugeName gauge={gauge} />
          </Link>
          {gauge.tokenId === null ? null : (
            <span className="text-sec">#{gauge.tokenId}</span>
          )}
        </span>
        {subline === undefined || subline === null ? null : (
          <span className="truncate text-[14.5px] text-sec">{subline}</span>
        )}
      </span>
    </span>
  )
}

// -- actions ------------------------------------------------------------------

const pill =
  "inline-flex h-11 flex-none items-center justify-center gap-2 rounded-[22px] px-5 font-semibold whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

/** An action that Matchbox does, opened there. */
export function MatchboxAction({
  href,
  children,
  tone = "primary",
}: {
  href: string
  children: ReactNode
  tone?: "primary" | "neutral"
}): ReactNode {
  return (
    <a
      href={href}
      className={`${pill} ${tone === "primary" ? "bg-acc text-on-acc" : "bg-soft text-ink hover:bg-soft2"}`}
    >
      {children}
      <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
    </a>
  )
}

/** Matchbox Pro, where votes, claims and locks happen. */
export { proOrigin } from "../../data/pro-links"

// -- topic pages ----------------------------------------------------------------

/** A sub-tab's grey count (matchbox-v3 topic pages, `@matchbox/ui/sub-tabs`). */
export function TabCount({ value }: { value: number | null }): ReactNode {
  return value === null ? null : (
    <span className="text-[14px] font-normal text-sec tabular-nums">
      {value.toLocaleString("en-US")}
    </span>
  )
}

// -- captioned panels ---------------------------------------------------------

export function Panel({
  label,
  aside,
  children,
  className,
}: {
  label: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <section
      aria-label={label}
      className={`flex min-w-0 flex-col rounded-[24px] bg-soft p-6 max-md:p-5 ${className ?? ""}`}
      {...Inspect.scope}
    >
      <div className="flex min-h-6 items-center gap-4">
        <h2 className="text-[15px] text-ink2">{label}</h2>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  )
}

/** A failed read inside its panel: one line, the panel still stands. */
export function PanelState({
  section,
}: {
  section: Exclude<Entity<unknown>, { status: "ok" }>
}): ReactNode {
  return (
    <p
      role="status"
      className="flex min-h-[140px] items-center justify-center text-center text-[15px] font-semibold text-ink2"
    >
      {sectionStateText[section.status]}
    </p>
  )
}

/** A panel's one-line empty state. */
export function PanelEmpty({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="flex min-h-[140px] items-center justify-center text-center text-[15px] text-sec">
      {children}
    </p>
  )
}

/**
 * The panel's one figure. Its number and note are the slots an inspected
 * chart in the panel reads into; `reserve` (the widest value the chart can
 * show) holds the number's width, so nothing moves while it reads.
 */
export function Figure({
  value,
  note,
  icon,
  reserve,
}: {
  value: string
  note?: ReactNode
  icon?: ReactNode
  reserve?: Reserve
}): ReactNode {
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      {icon === undefined ? null : <span className="self-center">{icon}</span>}
      <span className="text-[34px] leading-tight font-[650] tracking-[-0.02em] tabular-nums max-md:text-[28px]">
        <Inspect.Value reserve={reserve?.value}>{value}</Inspect.Value>
      </span>
      {(note === undefined || note === null) && reserve === undefined ? null : (
        <span className="min-w-0 text-[15px] text-sec">
          <Inspect.Note reserve={reserve?.note}>{note}</Inspect.Note>
        </span>
      )}
    </p>
  )
}

/** The widest value and note a chart can write into its panel's figure. */
export type Reserve = { value: string; note: string }

/** What a chart's points can write into the figure, as `Figure` reserves it. */
export function reserveOf(
  points: readonly {
    label: string
    text: string
    n?: number
    partial?: boolean
  }[],
  withChange: boolean,
): Reserve {
  return {
    value: Inspect.widest(points.map((each) => each.text)),
    note: Inspect.noteReserve(points, withChange),
  }
}

/**
 * The current epoch's bar when it is the last: still filling, so its
 * change from a whole epoch would mislead and none is shown.
 */
function filling(
  bar: EpochBarView,
  index: number,
  bars: readonly EpochBarView[],
): boolean {
  return bar.current && index === bars.length - 1
}

/**
 * "Epoch 48": the epoch a figure without its own note shows, the current
 * bar's (else the last), so the note's line is never empty.
 */
export function epochNote(bars: readonly EpochBarView[]): string | undefined {
  const bar = bars.find((each) => each.current) ?? bars.at(-1)
  return bar === undefined ? undefined : `Epoch ${bar.epoch}`
}

/** Epoch bars' reserve: each epoch's value, and its change. */
export function reserveFor(bars: readonly EpochBarView[]): Reserve {
  return reserveOf(
    bars.map((bar, index) => ({
      label: `Epoch ${bar.epoch}`,
      text: bar.text,
      n: bar.value,
      partial: filling(bar, index, bars),
    })),
    true,
  )
}

/** Gauge rows' reserve: each gauge's value, named. */
export function rowsReserve(rows: readonly GaugeBarView[]): Reserve {
  return reserveOf(
    rows.map((row) => ({ label: gaugeText(row.gauge), text: row.value })),
    false,
  )
}

export type StatView = {
  label: string
  value: string
  tone?: "pos" | "neg"
  /** A quieter second line under the value ("$350.2k", "Epoch 46 $6,240"). */
  note?: string
}

const toneClass = { pos: "text-pos", neg: "text-neg" } as const

export function Stats({ stats }: { stats: readonly StatView[] }): ReactNode {
  if (stats.length === 0) return null
  return (
    <dl className="mt-4 grid grid-cols-4 gap-x-4 gap-y-3 max-md:grid-cols-2">
      {stats.slice(0, 4).map((stat) => (
        <div key={stat.label} className="min-w-0">
          <dt className="truncate text-[14px] text-sec">{stat.label}</dt>
          <dd
            className={`mt-0.5 text-[15px] font-semibold tabular-nums [overflow-wrap:anywhere] ${stat.tone === undefined ? "" : toneClass[stat.tone]}`}
          >
            {stat.value}
          </dd>
          {stat.note === undefined ? null : (
            <dd className="mt-0.5 text-[14px] text-sec tabular-nums [overflow-wrap:anywhere]">
              {stat.note}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

/**
 * 30d, 90d, All as links (the panel rule's period toggle, right), then
 * `children`: the custom span's calendar button (custom-period.tsx, which
 * each page loads off its first paint). A range link drops a custom span.
 */
export function RangeToggle({
  period,
  to,
  params,
  search,
  label = "Period",
  children,
}: {
  period: PeriodView
  to: string
  params?: Record<string, string>
  search: Record<string, string | undefined>
  /** The nav's name; a page with two toggles names each by its panel. */
  label?: string
  children?: ReactNode
}): ReactNode {
  return (
    <nav aria-label={label} className="flex items-center gap-3 text-[14px]">
      {ranges.map((range) => (
        <Link
          key={range}
          to={to}
          params={params ?? {}}
          search={{ ...search, range: range === "30d" ? undefined : range }}
          resetScroll={false}
          aria-current={range === period.range ? "true" : undefined}
          activeOptions={{ exact: true, includeSearch: true }}
          activeProps={{}}
          className="rounded-sm text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&[aria-current]]:font-semibold [&[aria-current]]:text-ink"
        >
          {range}
        </Link>
      ))}
      {children}
    </nav>
  )
}

export type EpochBarView = {
  epoch: number
  value: number
  text: string
  current: boolean
}

/**
 * One bar per epoch, grey, the current one orange; each opens its epoch.
 * Hover, a touch or focus shows the epoch's value and its change in the
 * panel's figure (give the `Figure` `reserveFor(bars)`).
 */
export function EpochBars({
  bars,
  label,
  height = 140,
  readout = "figure",
}: {
  bars: readonly EpochBarView[]
  label: string
  height?: number
  readout?: Inspect.Readout
}): ReactNode {
  Inspect.useInspect(bars.length > 0)
  if (bars.length === 0) return null
  const max = Math.max(...bars.map((bar) => Math.abs(bar.value)), 0) || 1
  const first = bars[0]
  const last = bars.at(-1)
  return (
    <figure className="mt-6 flex flex-col gap-2">
      <ul
        aria-label={label}
        className="flex items-end gap-[3px]"
        style={{ height }}
        {...Inspect.root("x", readout, true)}
      >
        {bars.map((bar, index) => (
          <li key={bar.epoch} className="flex h-full min-w-0 flex-1 items-end">
            <Link
              to="/epochs/$epoch"
              params={{ epoch: String(bar.epoch) }}
              aria-label={`Epoch ${bar.epoch}, ${bar.text}`}
              className={`block w-full origin-bottom animate-[mbx-grow_420ms_var(--ease-roll)_backwards] rounded-t-[4px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${bar.current ? "bg-acc" : "bg-mut"}`}
              data-mbx-motion=""
              {...Inspect.point(
                { label: `Epoch ${bar.epoch}`, value: bar.text },
                bar.value,
                { partial: filling(bar, index, bars) },
              )}
              style={{
                height: `${Math.max(2, (Math.abs(bar.value) / max) * 100)}%`,
              }}
            />
          </li>
        ))}
      </ul>
      <figcaption
        aria-hidden="true"
        className="flex justify-between font-mono text-xs text-sec"
      >
        <span>Epoch {first?.epoch}</span>
        <span>Epoch {last?.epoch}</span>
      </figcaption>
    </figure>
  )
}

export type StackedBarView = {
  epoch: number
  current: boolean
  /** Display height of the whole bar. */
  value: number
  /** Display heights per series, bottom first. */
  parts: readonly number[]
  text: string
  /** The parts in words, for screen readers. */
  detail: string
}

/**
 * "Epoch 46: MEZO $5,100, Dollar tokens $2,232": a bar's readout label;
 * "Epoch 48 so far: …" for a bar still filling.
 */
export function barLabel(bar: StackedBarView, soFar = false): string {
  const name = `Epoch ${bar.epoch}${soFar ? " so far" : ""}`
  return bar.detail === "" ? name : `${name}: ${bar.detail}`
}

/** Stacked bars' reserve: each epoch's total, and its change. */
export function stackedReserve(bars: readonly StackedBarView[]): Reserve {
  return reserveOf(
    bars.map((bar) => ({
      label: barLabel(bar),
      text: bar.text,
      n: bar.value,
      partial: bar.current,
    })),
    true,
  )
}

export type GaugeBarView = {
  gauge: GaugeIdentity
  value: string
  bps: number
}

/**
 * Gauges with a bar against the largest, value right. Where the panel's
 * figure is the same measure (`figure`: APY, vote share), hover, a touch
 * or focus on a row shows its gauge and value there; elsewhere the row
 * already says all a tooltip would.
 */
export function GaugeBars({
  rows,
  label,
  figure = false,
}: {
  rows: readonly GaugeBarView[]
  label: string
  figure?: boolean
}): ReactNode {
  const live = figure && rows.length > 0
  Inspect.useInspect(live)
  return (
    <ul
      aria-label={label}
      className="mt-5 flex flex-col gap-3"
      {...(live ? Inspect.root("items", "figure", false) : {})}
    >
      {rows.map((row) => (
        <li
          key={row.gauge.address}
          className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-4 max-md:grid-cols-[minmax(0,1fr)_auto]"
          {...(live
            ? Inspect.point({ label: gaugeText(row.gauge), value: row.value })
            : {})}
        >
          <GaugeTitle gauge={row.gauge} size={22} />
          <span
            aria-hidden="true"
            data-inspect-anchor=""
            className="h-2 overflow-hidden rounded-full bg-soft2 max-md:hidden"
          >
            <span
              className="block h-full rounded-full bg-acc"
              style={{ width: `${Math.max(2, row.bps / 100)}%` }}
            />
          </span>
          <span className="text-right text-[15px] font-semibold tabular-nums">
            {row.value}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A bar split into labelled parts (validators and pools, top and others).
 * Hover or a touch on a part shows its label, value and share; the legend
 * under it says the same for the keyboard and screen readers.
 */
export function ShareBar({
  segments,
  label,
}: {
  segments: readonly { label: string; value: string; bps: number }[]
  label: string
}): ReactNode {
  Inspect.useInspect(segments.some((part) => part.bps > 0))
  // Five tones that stay apart in light and dark.
  const tones = ["bg-ink", "bg-acc", "bg-mut", "bg-mezo", "bg-pos"]
  return (
    <div className="mt-5">
      <p
        aria-hidden="true"
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        {...Inspect.root("items", "tip", false)}
      >
        {segments.map((part, index) =>
          part.bps <= 0 ? null : (
            <span
              key={part.label}
              className={tones[index % tones.length]}
              style={{ flexGrow: part.bps, flexBasis: 0 }}
              {...Inspect.point({
                label: part.label,
                value: shareValue(part),
              })}
            />
          ),
        )}
      </p>
      <dl aria-label={label} className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {segments.map((part, index) => (
          <div key={part.label} className="flex items-center gap-2 text-[14px]">
            <dt className="flex items-center gap-2 text-sec">
              <span
                aria-hidden="true"
                className={`size-2.5 flex-none rounded-full ${tones[index % tones.length]}`}
              />
              {part.label}
            </dt>
            <dd className="font-semibold tabular-nums">{part.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** "1,040.1244 veBTC, 39.8%"; a value that is a share already stays as is. */
export function shareValue(part: { value: string; bps: number }): string {
  if (part.value.endsWith("%")) return part.value
  return `${part.value}, ${(Math.round(part.bps / 10) / 10).toFixed(1)}%`
}
