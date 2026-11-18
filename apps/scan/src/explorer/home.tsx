import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as Inspect from "@matchbox/ui/inspect"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../data/explorer"
import type { HomeGauge, HomeTile } from "../data/home"
import { SectionHeading, SectionState } from "./parts"
import { GaugeTitle, MatchboxAction, proOrigin } from "./voting/parts"

/**
 * Home's live sections (`cP_-xnZA8I`): the tiles that have data, and the
 * current epoch's gauges with the most incentives. A tile without data is
 * not drawn (home.server lists what is left out and why).
 */

const tileIcons: Record<HomeTile["id"], GlyphShape> = {
  borrowed: shapes.creditCard,
  collateral: shapes.coins,
  positions: shapes.creditCard,
  vebtc: shapes.lock,
  validators: shapes.shieldCheck,
  incentives: shapes.squareCheck,
}

const linkClass =
  "rounded-sm font-semibold text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"

/**
 * A filled line under a tile's figures. With its days (`days`), hovering,
 * touching or focusing it reads a day's value into the tile's figure, the
 * arrow keys move between days.
 */
export function Sparkline({
  values,
  days = null,
  label,
}: {
  values: readonly (number | null)[]
  days?: readonly ({ label: string; text: string } | null)[] | null
  /** The chart's name: "Borrowed, last 30 days". */
  label: string
}): ReactNode {
  const width = 300
  const height = 48
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points: string[] = []
  const coords: [number, number][] = []
  const read: Inspect.InspectPoint[] = []
  const numbers: number[] = []
  values.forEach((value, index) => {
    if (value === null) return
    const x = Math.round(index * step * 10) / 10
    const y = Math.round((4 + (1 - value) * (height - 8)) * 10) / 10
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    const day = days?.[index]
    if (day === null || day === undefined) return
    coords.push([x, y])
    read.push({ label: day.label, value: day.text })
    numbers.push(value)
  })
  const live = points.length > 1 && read.length > 1
  Inspect.useInspect(live)
  if (points.length < 2) return null
  const first = points[0]?.split(",")[0] ?? "0"
  const last = points.at(-1)?.split(",")[0] ?? String(width)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      aria-hidden={live ? undefined : true}
      className="mt-4 block h-12 w-full text-ink2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      {...(live ? { tabIndex: 0, ...Inspect.root("x", "figure", false) } : {})}
    >
      <polygon
        points={`${first},${height} ${points.join(" ")} ${last},${height}`}
        className="fill-current opacity-10"
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {live ? (
        <Inspect.LinePoints
          coords={coords}
          points={read}
          values={numbers}
          top={0}
          bottom={height}
          dot={false}
        />
      ) : null}
    </svg>
  )
}

export function HomeTiles({
  tiles,
}: {
  tiles: readonly HomeTile[]
}): ReactNode {
  if (tiles.length === 0) return null
  return (
    <section aria-label="Mezo at a glance" className="mt-10">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <li
            key={tile.id}
            className="flex flex-col overflow-hidden rounded-[24px] bg-soft p-6 pb-0"
            {...Inspect.scope}
          >
            <p className="flex items-center gap-2.5 text-[15px] text-sec">
              <span className="grid size-7 place-items-center rounded-full bg-raised text-ink2">
                <Glyph shape={tileIcons[tile.id]} size={15} strokeWidth={1.8} />
              </span>
              {tile.label}
            </p>
            <p className="mt-3 text-[30px] leading-tight font-[650] tabular-nums">
              <Inspect.Value
                reserve={Inspect.widest([
                  tile.value,
                  ...(tile.sparkDays ?? []).map((day) => day?.text ?? ""),
                ])}
              >
                {tile.value}
              </Inspect.Value>
            </p>
            <p className="mt-1 flex flex-wrap justify-between gap-x-4 text-[15px] text-sec">
              <span>
                <Inspect.Note
                  reserve={Inspect.noteReserve(
                    (tile.sparkDays ?? []).map((day) => ({
                      label: day?.label ?? "",
                    })),
                    false,
                  )}
                >
                  {tile.detail}
                </Inspect.Note>
              </span>
              {tile.aside === null ? null : (
                <span>
                  {tile.aside.label}{" "}
                  <span className="font-semibold text-ink tabular-nums">
                    {tile.aside.value}
                  </span>
                </span>
              )}
              {tile.id === "incentives" ? (
                <a href={`${proOrigin}/vote`} className={linkClass}>
                  Vote on Matchbox
                </a>
              ) : null}
            </p>
            {tile.spark === null ? (
              <span className="pb-6" />
            ) : (
              <Sparkline
                values={tile.spark}
                days={tile.sparkDays}
                label={`${tile.label}, last ${tile.spark.length} days`}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function EpochGauges({
  gauges,
}: {
  gauges: Section<{ epoch: number; rows: HomeGauge[] }>
}): ReactNode {
  return (
    <section aria-labelledby="epoch-gauges">
      <SectionHeading
        id="epoch-gauges"
        aside={
          <span className="flex items-center gap-5">
            <span className="text-sec">Most incentives</span>
            <Link to="/gauges" className={linkClass}>
              All gauges
            </Link>
          </span>
        }
      >
        {gauges.status === "ok"
          ? `Epoch ${gauges.data.epoch} gauges`
          : "Gauges"}
      </SectionHeading>
      {gauges.status !== "ok" ? (
        <SectionState section={gauges} />
      ) : gauges.data.rows.length === 0 ? (
        <p className="py-6 text-sec">No incentives yet</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {gauges.data.rows.map((row) => (
              <li
                key={row.gauge.address}
                className="flex min-h-[66px] items-center justify-between gap-4 border-b border-line py-2"
              >
                <GaugeTitle gauge={row.gauge} subline={row.votes} />
                <span className="flex flex-col items-end text-right">
                  <span className="font-semibold tabular-nums">
                    {row.incentives}
                  </span>
                  {row.apy === null ? null : (
                    <span className="text-[14.5px] text-sec">{row.apy}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-5 flex">
            <MatchboxAction href={`${proOrigin}/vote`} tone="neutral">
              Vote on Matchbox
            </MatchboxAction>
          </p>
        </>
      )}
    </section>
  )
}
