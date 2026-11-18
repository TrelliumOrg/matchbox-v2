import * as AllocationMark from "@matchbox/ui/allocation-mark"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import type { ReactNode } from "react"
import type { ActivityEvent } from "../data/view-models"
import {
  formatCompact,
  formatDate,
  formatDay,
  formatDayTime,
  formatSignedUsd,
  formatTime,
  formatTokenWithSymbol,
  formatVeBtc,
  formatWeekday,
} from "../lib/format"
import { gaugeName } from "../lib/gauge-name"
import { allocationOf } from "./allocation-of"
import { Coins } from "./coins"

/**
 * One activity event as a plain two-line row. "summary" rows (Overview,
 * Rewards) carry the date in the subline; "dated" rows sit under a date
 * heading and carry the time.
 */

export type RowContext = "summary" | "dated"

function lockLabel(lock: { tokenId: string }): string {
  return `#${lock.tokenId}`
}

type RowParts = {
  icon: GlyphShape
  pending: boolean
  title: string
  subline: string
  subTone: "default" | "attention"
  main: ReactNode
  mainTone: "default" | "positive"
  sub: ReactNode
  struck: boolean
}

function when(
  event: ActivityEvent,
  context: RowContext,
  prefix: string,
): string {
  if (context === "dated") return `${prefix}, ${formatTime(event.at)}`
  return `${prefix}, ${formatDay(event.at)}`
}

export function describeEvent(
  event: ActivityEvent,
  context: RowContext,
): RowParts {
  const detail = event.detail
  const confirming = event.status === "confirming"
  const reverted = event.status === "reverted"
  const base = {
    pending: confirming,
    subTone: confirming ? ("attention" as const) : ("default" as const),
    mainTone: "default" as const,
    struck: false,
  }
  switch (detail.kind) {
    case "vote": {
      // Votes carry the escrow's unit, never "votes" (C4).
      const votes =
        detail.lock.kind === "vemezo"
          ? `${formatCompact(detail.votes.split(".")[0] ?? "0")} veMEZO`
          : formatVeBtc(detail.votes)
      return {
        ...base,
        icon: confirming ? shapes.clock : shapes.vote,
        title: `${confirming ? "Vote" : "Voted"} with ${lockLabel(detail.lock)}`,
        subline: confirming
          ? "Confirming"
          : context === "summary"
            ? `Epoch ${event.epoch}, ${formatWeekday(event.at)}`
            : `Epoch ${event.epoch}, ${formatTime(event.at)}`,
        main: votes,
        sub: (
          <AllocationMark.Root allocations={allocationOf(detail.allocation)} />
        ),
      }
    }
    case "claim":
      return {
        ...base,
        icon: shapes.gift,
        title: "Claimed rewards",
        subline: confirming
          ? "Confirming"
          : context === "summary"
            ? `Epoch ${event.epoch}, ${formatDay(event.at)}`
            : `Epoch ${event.epoch}, ${formatTime(event.at)}`,
        main: formatSignedUsd(detail.usd, "cents"),
        mainTone: "positive",
        sub: <Coins tokens={detail.tokens} label="Claimed tokens" />,
      }
    case "lock": {
      const verb = {
        create: "Locked",
        increase: "Added to",
        extend: "Extended",
        merge: "Merged into",
        withdraw: "Withdrew",
      }[detail.action]
      const kind = detail.lock.kind === "vebtc" ? "veBTC" : "veMEZO"
      return {
        ...base,
        icon: detail.action === "extend" ? shapes.clock : shapes.plus,
        title: `${verb} ${lockLabel(detail.lock)}`,
        subline:
          context === "summary"
            ? formatDay(event.at)
            : when(event, context, kind),
        main: `${detail.action === "withdraw" ? "-" : "+"}${formatTokenWithSymbol(
          detail.amount.amount,
          detail.amount.symbol,
        )}`,
        sub:
          // 0 is how the chain writes "no unlock date": an auto-max lock.
          detail.unlocksAt === null
            ? null
            : detail.unlocksAt === 0
              ? "Auto max"
              : `Unlocks ${formatDate(detail.unlocksAt)}`,
      }
    }
    case "own":
      // Sent from this browser, not indexed yet: the step's own label.
      return {
        ...base,
        icon: reverted ? shapes.x : confirming ? shapes.clock : shapes.check,
        title: detail.label,
        subline: reverted
          ? `Reverted, ${formatTime(event.at)}`
          : confirming
            ? "Confirming"
            : context === "summary"
              ? formatDayTime(event.at)
              : `Epoch ${event.epoch}, ${formatTime(event.at)}`,
        main: null,
        sub: reverted ? "Not sent" : null,
      }
    case "incentive":
      return {
        ...base,
        icon: reverted ? shapes.x : shapes.plus,
        title: `Incentive to ${gaugeName(detail.gauge)}`,
        subline: reverted
          ? `Reverted, ${formatTime(event.at)}`
          : context === "summary"
            ? formatDayTime(event.at)
            : `Epoch ${event.epoch}, ${formatTime(event.at)}`,
        main: formatTokenWithSymbol(detail.amount.amount, detail.amount.symbol),
        sub: reverted ? "Not sent" : null,
        struck: reverted,
      }
  }
}

export function ActivityRow({
  event,
  context,
  onOpen,
  flip,
}: {
  event: ActivityEvent
  context: RowContext
  /** Opens the transaction sheet; the row becomes a button. */
  onOpen?: () => void
  /** Key for a list that animates (useFlip). */
  flip?: string
}): ReactNode {
  const parts = describeEvent(event, context)
  const title =
    onOpen === undefined ? (
      parts.title
    ) : (
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer rounded-sm text-left outline-none before:absolute before:inset-0 before:rounded-[20px] before:content-[''] focus-visible:before:outline-2 focus-visible:before:outline-ink"
      >
        {parts.title}
      </button>
    )
  return (
    <ListRow.Root
      data-flip={flip}
      className={
        onOpen === undefined
          ? ""
          : "relative -mx-3 rounded-[20px] px-3 hover:bg-soft"
      }
    >
      <ListRow.Icon tone={parts.pending ? "pending" : "default"}>
        <Glyph shape={parts.icon} size={20} strokeWidth={1.8} />
      </ListRow.Icon>
      <ListRow.Text>
        <ListRow.Title>{title}</ListRow.Title>
        <ListRow.Subline tone={parts.subTone}>{parts.subline}</ListRow.Subline>
      </ListRow.Text>
      <ListRow.Value>
        <ListRow.Main
          tone={parts.mainTone}
          className={parts.struck ? "font-medium text-mut line-through" : ""}
        >
          {parts.main}
        </ListRow.Main>
        {parts.sub === null ? null : (
          <ListRow.Sub className="relative z-10 flex justify-end">
            {parts.sub}
          </ListRow.Sub>
        )}
      </ListRow.Value>
    </ListRow.Root>
  )
}
