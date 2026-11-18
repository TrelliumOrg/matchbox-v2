import * as Inspect from "@matchbox/ui/inspect"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import {
  type ColumnView,
  type LockDistributionView,
  type LockPanelView,
  type LockShareView,
  locksText,
  type VoterEscrow,
} from "../../data/scan/governance-views"
import {
  type FigureWire,
  figureWireIn,
  type LockDistributionWire,
  lockWireIn,
} from "../../data/scan/lock-wire"
import {
  EpochBars,
  Figure,
  Panel,
  PanelEmpty,
  PanelState,
  reserveFor,
  ShareBar,
  Stats,
} from "./parts"

/**
 * Matchscan's governance panels, one module (one chunk) for every page
 * that shows them. The Locks panels read from the chain once a day (`uNyejMCnPb`): lock
 * length, permanent against timed, the unlock calendar and lock size,
 * each from the same block. Server-rendered markup; hovering, touching or
 * focusing a column reads it out.
 */

const tones = { acc: "bg-acc", ink: "bg-ink", soft: "bg-mut" } as const

/** Labelled columns with their amount above; each is a focusable point. */
export function ColumnBars({
  columns,
  label,
  height = 130,
}: {
  columns: readonly ColumnView[]
  label: string
  height?: number
}): ReactNode {
  Inspect.useInspect(columns.length > 0)
  if (columns.length === 0) return null
  const max = Math.max(...columns.map((column) => column.value), 0) || 1
  // More than four amounts do not fit side by side on a phone, nor more
  // than six on a desktop panel: there each column reads out on a hover,
  // touch or focus instead.
  const crowded = columns.length > 4
  const dense = columns.length > 6
  return (
    <figure className="mt-6">
      <ul
        aria-label={label}
        className="flex items-end gap-2"
        {...Inspect.root("items", "tip", false)}
      >
        {columns.map((column) => (
          <li
            key={column.label}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a chart point the keyboard steps through
            tabIndex={0}
            aria-label={`${column.label}: ${column.text}, ${locksText(column.count)}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            {...Inspect.point({
              label: `${column.label}, ${locksText(column.count)}`,
              value: column.text,
            })}
          >
            <span
              aria-hidden="true"
              className={`max-w-full truncate text-[13px] font-semibold tabular-nums max-md:text-[12px] ${dense ? "hidden" : crowded ? "max-md:hidden" : ""}`}
            >
              {column.short}
            </span>
            <span
              aria-hidden="true"
              className="flex w-full items-end"
              style={{ height }}
            >
              <span
                data-inspect-anchor=""
                className={`block w-full rounded-t-[6px] ${tones[column.tone]}`}
                style={{
                  height: `${Math.max(2, (column.value / max) * 100)}%`,
                }}
              />
            </span>
            <span
              aria-hidden="true"
              className={`text-center text-[13px] whitespace-nowrap text-sec max-md:text-[11px] ${crowded ? "max-md:text-[10px] max-md:tracking-tight" : ""}`}
            >
              {column.label}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

function ColumnsPanel({
  label,
  view,
}: {
  label: string
  view: LockPanelView
}): ReactNode {
  return (
    <>
      <Figure value={view.figure} note={view.note} />
      <Stats stats={view.stats} />
      <ColumnBars columns={view.columns} label={label} />
    </>
  )
}

function SharePanel({ view }: { view: LockShareView }): ReactNode {
  return (
    <>
      <Figure value={view.figure} note={view.note} />
      <Stats stats={view.stats} />
      <p className="mt-5 text-[14px] font-semibold">Amount locked</p>
      <ShareBar segments={view.amount} label="Amount locked" />
      <p className="mt-5 text-[14px] font-semibold">Voting power</p>
      <ShareBar segments={view.power} label="Voting power" />
    </>
  )
}

type Slot = "length" | "permanence" | "calendar" | "size"

const titles: Record<Slot, string> = {
  length: "Lock length",
  permanence: "Permanent vs timed",
  calendar: "Unlock calendar",
  size: "Lock size",
}

/** One distribution panel, with its read's state when it has no data. */
function LockDistributionPanel({
  slot,
  distribution,
  data,
}: {
  slot: Slot
  distribution: Section<unknown>
  data: LockDistributionView | null
}): ReactNode {
  const label = titles[slot]
  return (
    <Panel
      label={label}
      aside={
        data === null ? null : data.stale ? (
          <span role="status" className="text-[14px] font-semibold text-ink2">
            {data.asOf}
          </span>
        ) : (
          <span className="text-[14px] text-sec">{data.asOf}</span>
        )
      }
    >
      {distribution.status !== "ok" ? (
        <PanelState section={distribution} />
      ) : data === null ? (
        <PanelEmpty>Not read yet</PanelEmpty>
      ) : slot === "permanence" ? (
        <SharePanel view={data.permanence} />
      ) : (
        <ColumnsPanel label={label} view={data[slot]} />
      )}
    </Panel>
  )
}

/** The four panels in the page's grid order. */
export function LockDistributionPanels({
  distribution,
  escrow,
}: {
  distribution: Section<LockDistributionWire | null>
  escrow: VoterEscrow
}): ReactNode {
  const data =
    distribution.status === "ok" && distribution.data !== null
      ? lockWireIn(distribution.data, escrow)
      : null
  return (
    <>
      {(["length", "permanence", "size", "calendar"] as const).map((slot) => (
        <LockDistributionPanel
          key={slot}
          slot={slot}
          distribution={distribution}
          data={data}
        />
      ))}
    </>
  )
}

/**
 * A panel of one figure, its stats and a bar per epoch: a gauge's votes
 * and APY history, voting APR, a validator's emissions. One module, so a
 * page showing several carries its code once.
 */
export function EpochFigurePanel({
  label,
  section,
  empty,
}: {
  label: string
  section: Section<FigureWire | null>
  empty: string
}): ReactNode {
  const data =
    section.status === "ok" && section.data !== null
      ? figureWireIn(section.data)
      : null
  return (
    <Panel label={label}>
      {section.status !== "ok" ? (
        <PanelState section={section} />
      ) : data === null ? (
        <PanelEmpty>{empty}</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.figure}
            note={data.note}
            reserve={reserveFor(data.bars)}
          />
          <Stats stats={data.stats} />
          <EpochBars bars={data.bars} label={label} />
        </>
      )}
    </Panel>
  )
}
